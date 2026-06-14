# Kubernetes + CI/CD — architektura, manifesty i weryfikacja

Aplikacja wieloserwisowa w Kubernetes (Kustomize: `base` + `overlays/dev|prod`) z wdrożeniem
przez GitHub Actions. Manifesty w katalogu [k8s/](../k8s). Da się sprawdzić w ~20 minut na
lokalnym klastrze (**kind**, **minikube** lub **k3d**).

> Ostatni udany workflow: https://github.com/pbaglaj/social-api-polyglot/actions/runs/26750906909

## 1. Architektura w klastrze

```
            Internet / kubectl port-forward
                         │
                 ┌───────▼────────┐
                 │    Ingress      │  ingressClassName: nginx, host: social.local
                 └───────┬─────────┘
                         │  Service api-gateway (ClusterIP :80)
               ┌─────────▼───────────┐
               │  api-gateway (nginx) │  Deployment ×N, non-root (uid 101)
               └───┬─────────────┬────┘
    /api/posts...  │             │  /api/feed, /api/analytics
         ┌─────────▼──────┐ ┌────▼──────────────┐
         │   pg-service   │ │   mongo-service   │  Deployment, RollingUpdate,
         │  +PDB +/metrics│ │   +PDB +/metrics  │  PDB, probes, limity, non-root
         └──┬────────┬────┘ └─────────┬─────────┘
   Service  │        │ Service        │ Service
   ┌────────▼┐  ┌────▼─────┐    ┌─────▼──────────┐
   │postgres │  │  redis   │    │   mongodb      │
   │StatefulS│  │ Deploy   │    │  StatefulSet   │
   │+PVC     │  │ (cache)  │    │  +PVC          │
   └─────────┘  └──────────┘    └────────────────┘

  Namespace: social-dev (dev) / social (prod)
  Secret: db-credentials   ConfigMap: app-config + nginx-config
  Job: pg-migrate (Prisma+Knex+seed), mongo-seed (idempotentny)
  NetworkPolicy: default-deny + reguły (gateway→serwisy, serwisy→ich bazy)
```

Pełna ścieżka ruchu: `Internet → Ingress → api-gateway → pg-service/mongo-service → bazy`.
Jedyne wejście z zewnątrz to Ingress; bazy/cache to ClusterIP (headless dla baz).

## 2. Struktura katalogu `k8s/`

Wzorzec **Kustomize**: `base/` to kompletny, neutralny zestaw zasobów; nakładki tylko go
modyfikują (namespace, repliki, obrazy, limity), nie duplikując manifestów.

```
k8s/
├── base/
│   ├── kustomization.yaml          # resources + labels (part-of) + images (punkt podmiany)
│   ├── namespace.yaml              # Namespace social (nadpisywany przez overlay)
│   ├── configmap-app.yaml          # app-config: NODE_ENV, porty, REDIS_URL, CACHE_TTL (niepoufne)
│   ├── configmap-nginx.yaml        # nginx-config: routing + lokalny /health (statyczny 200)
│   ├── secret.yaml                 # db-credentials: hasła + URL-e (placeholdery dev)
│   ├── postgres-statefulset.yaml + postgres-service.yaml   # PVC pgdata, fsGroup 70, pg_isready
│   ├── mongodb-statefulset.yaml  + mongodb-service.yaml    # PVC mongodata, fsGroup 999, mongosh ping
│   ├── redis-deployment.yaml     + redis-service.yaml      # cache, emptyDir, readOnlyRootFS, drop ALL
│   ├── job-migrate.yaml           # pg-migrate: Prisma+Knex+seed, initContainer wait-for-postgres
│   ├── job-mongo-seed.yaml        # idempotentny seed feedu/rich (deleteMany+insertMany)
│   ├── pg-service-deployment.yaml    + pg-service-service.yaml
│   ├── mongo-service-deployment.yaml + mongo-service-service.yaml
│   ├── gateway-deployment.yaml       + gateway-service.yaml
│   ├── ingress.yaml                # social-ingress, host social.local, / → api-gateway
│   ├── networkpolicy.yaml          # default-deny + 6 reguł pod↔pod
│   └── pdb.yaml                    # PodDisruptionBudget backendów (minAvailable: 1)
└── overlays/
    ├── dev/   # namespace social-dev, replicas 1, obrazy lokalne :dev, annotation env=dev
    └── prod/  # namespace social, replicas 2, obrazy GHCR :stable, większe limity, env=prod
```

Uwagi projektowe:
- Backendy: `RollingUpdate` `maxSurge:1 / maxUnavailable:0` (zero przerwy), `runAsNonRoot` (uid 1000),
  `drop: ALL`, adnotacje Prometheusa, probes HTTP `/health`, `terminationGracePeriodSeconds: 30`.
- Gateway jest `Ready` zanim wstaną bazy — celowo: `readinessProbe /health` zwraca **statyczny 200**
  z nginx (nie dotyka backendów); zanim backendy wstaną, `/api/...` zwróci 502, ale `/health` działa.
- StatefulSety i redis pozostają przy 1 replice w obu środowiskach — skalowane są tylko bezstanowe backendy.

## 3. Uruchomienie od zera (kind)

```bash
kind create cluster --name social

# build + wgranie obrazów (kind nie pobiera ich z rejestru)
docker build -t pg-service:dev    apps/backend/pg-service
docker build -t mongo-service:dev apps/backend/mongo-service
kind load docker-image pg-service:dev mongo-service:dev --name social

# (zalecane) pre-load obrazów bazowych — eliminuje losowe ImagePullBackOff
for img in redis:7-alpine postgres:15-alpine mongo:6 busybox:1.36 nginxinc/nginx-unprivileged:alpine; do
  docker pull "$img" && kind load docker-image "$img" --name social
done

kubectl apply -k k8s/overlays/dev      # overlay dev → namespace social-dev
```

> **minikube:** `minikube image load pg-service:dev` (i mongo). **k3d:** `k3d image import …`.

Czekaj na gotowość i sprawdź status:
```bash
kubectl -n social-dev rollout status statefulset/postgres
kubectl -n social-dev wait --for=condition=complete job/pg-migrate --timeout=180s
kubectl -n social-dev wait --for=condition=complete job/mongo-seed --timeout=180s
kubectl -n social-dev rollout status deployment/pg-service
kubectl -n social-dev get pods,svc,statefulset,deploy,job,pvc
```

## 4. Komendy testowe

```bash
kubectl -n social-dev port-forward svc/api-gateway 8080:80   # baza: http://localhost:8080
```
> Alternatywa przez Ingress: zainstaluj ingress-nginx, dodaj `127.0.0.1 social.local` do hosts,
> wołaj `curl -H "Host: social.local" http://localhost/...`.

```bash
# health / add / read + cache
curl -s http://localhost:8080/health/pg
curl -s -X POST http://localhost:8080/api/posts -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"Hello from k8s"}'
curl -i http://localhost:8080/api/posts | grep -i "x-cache"   # MISS, potem HIT
curl -s "http://localhost:8080/api/feed/1?limit=3"            # feed z mongo-service
```

**Trwałość po restarcie poda bazy** (StatefulSet odtwarza pod z tym samym PVC):
```bash
curl -s -X POST http://localhost:8080/api/posts -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"persistence-test"}'
kubectl -n social-dev delete pod postgres-0
kubectl -n social-dev rollout status statefulset/postgres
curl -s http://localhost:8080/api/posts | grep "persistence-test"   # nadal istnieje
kubectl -n social-dev get pvc   # pgdata-postgres-0, mongodata-mongodb-0 — Bound
```

**Izolacja / NetworkPolicy:**
```bash
kubectl -n social-dev get svc            # postgres/mongodb: ClusterIP None; brak NodePort/LoadBalancer
kubectl -n social-dev get networkpolicy  # default-deny + reguły
```
> Domyślny CNI kind (`kindnet`) **nie egzekwuje** NetworkPolicy — manifesty są poprawne, ale do
> realnego testu blokowania użyj Calico/Cilium (np. minikube `--cni=calico`).

**Sondy / securityContext / migracje / rolling update / PDB / metryki:**
```bash
kubectl -n social-dev describe deploy pg-service | grep -A2 -E "Liveness|Readiness|Limits|Requests"
kubectl -n social-dev get pod -l app=pg-service -o jsonpath='{.items[0].spec.containers[0].securityContext}'
# allowPrivilegeEscalation:false, capabilities drop ALL, runAsNonRoot:true, runAsUser:1000
kubectl -n social-dev logs job/pg-migrate || kubectl -n social-dev get job pg-migrate   # Job TTL 1h
kubectl -n social-dev set env deploy/pg-service ROLLING_PROBE=$(date +%s)
kubectl -n social-dev rollout status deploy/pg-service   # bez przerwy (maxUnavailable:0)
kubectl -n social-dev get pdb                            # MIN AVAILABLE 1
kubectl -n social-dev port-forward deploy/pg-service 3001:3001 &
curl -s http://localhost:3001/metrics | grep -E "http_requests_total|process_cpu" | head
```

**Dwa środowiska (Kustomize):**
```bash
kubectl kustomize k8s/overlays/dev  | grep -E "namespace:|replicas:" | sort | uniq -c   # social-dev, 1
kubectl kustomize k8s/overlays/prod | grep -E "namespace:|replicas:" | sort | uniq -c   # social, 2
```

## 5. CI/CD (GitHub Actions)

- [.github/workflows/ci.yml](../.github/workflows/ci.yml) — testy per serwis + walidacja Dockerfile + E2E newman.
- [.github/workflows/cd-k8s.yml](../.github/workflows/cd-k8s.yml) — przy pushu na `main`: build →
  publikacja do **GHCR** → klaster **kind** → `kubectl apply -k overlays/dev` → czeka na Joby migracji
  → **sprawdza rollout** (`kubectl rollout status`) → smoke test (`/health`, POST/GET `/api/posts`, `/api/feed`, `X-Cache`).

## 6. Mapa wymagań → realizacja

| Wymaganie | Realizacja |
|-----------|------------|
| Manifesty (Namespace, Deployment, StatefulSet, Service, Ingress, ConfigMap, Secret, PVC) | `k8s/base/*` (Kustomize) |
| Deploymenty + rolling update (backend ≥2 repliki) | pg/mongo-service prod: 2 repliki, RollingUpdate maxUnavailable:0 |
| Baza + trwałość (StatefulSet + PVC) | postgres/mongodb StatefulSet + `volumeClaimTemplates` |
| Services, Ingress, izolacja | tylko gateway za Ingress, reszta ClusterIP/headless |
| ConfigMap + Secret | `app-config`, `nginx-config`, `db-credentials` |
| Probes + resources | readiness/liveness + requests/limits na wszystkich kontenerach |
| securityContext + initContainer/Job | non-root + `drop ALL` + Joby `pg-migrate`/`mongo-seed` + initContainer wait-for-db |
| CI/CD (build, test, push, deploy, rollout) | `cd-k8s.yml` |
| NetworkPolicy (+2.5%) | `networkpolicy.yaml` (default-deny + 6 reguł) |
| PodDisruptionBudget (+2.5%) | `pdb.yaml` (minAvailable: 1) |
| Helm/Kustomize, 2 środowiska (+2.5%) | `overlays/dev` + `overlays/prod` |
| Obserwowalność (+2.5%) | `/metrics` w obu serwisach + adnotacje `prometheus.io/*` |
| Minimalna funkcjonalność / trwałość / cache | add+read+`/health`, PVC, Redis (`X-Cache`) |

## 7. Czyszczenie

```bash
kubectl delete -k k8s/overlays/dev      # usuwa zasoby (PVC zostają)
kubectl -n social-dev delete pvc --all  # usunięcie danych
kind delete cluster --name social
```

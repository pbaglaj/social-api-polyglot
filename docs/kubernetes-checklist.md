# CHECKLIST — projekt Kubernetes (aplikacja wieloserwisowa + CI/CD)

Instrukcja umożliwia sprawdzenie projektu w ok. 20 minut na lokalnym klastrze
(**kind**, **minikube** lub **k3d**). Manifesty są w katalogu [k8s/](../k8s) (Kustomize: `base` + `overlays/dev|prod`).

> Link do ostatniego udanego workflow GitHub Actions: https://github.com/pbaglaj/social-api-polyglot/actions/runs/26750906909

---

## 1. Architektura w klastrze

```
                         Internet  /  kubectl port-forward
                                   │
                           ┌───────▼────────┐
                           │    Ingress      │  ingressClassName: nginx
                           │  social.local / │  (host: social.local)
                           └───────┬─────────┘
                                   │  Service api-gateway (ClusterIP :80)
                         ┌─────────▼───────────┐
                         │  api-gateway (nginx) │  Deployment ×2, non-root (uid 101)
                         │  ConfigMap nginx.conf│  upstream = Service DNS (ClusterIP)
                         └───┬─────────────┬────┘
              /api/posts...  │             │  /api/feed, /api/analytics
              /api/users...  │             │
                   ┌─────────▼──────┐ ┌────▼──────────────┐
                   │   pg-service   │ │   mongo-service   │  Deployment ×2,
                   │  RollingUpdate │ │   RollingUpdate   │  RollingUpdate, PDB,
                   │  + PDB + /metrics│ │   + /metrics     │  probes, limity, non-root
                   └──┬────────┬────┘ └─────────┬─────────┘
        Service       │        │ Service        │ Service
        ┌─────────────▼┐  ┌────▼─────┐    ┌─────▼──────────┐
        │  postgres    │  │  redis   │    │   mongodb      │
        │ StatefulSet  │  │ Deploy   │    │  StatefulSet   │
        │ +PVC pgdata  │  │ (cache)  │    │  +PVC mongodata│
        └──────────────┘  └──────────┘    └────────────────┘

  Namespace: social-dev (overlay dev) / social (overlay prod)
  Secret: db-credentials   ConfigMap: app-config + nginx-config
  Job: pg-migrate (Prisma+Knex+seed), mongo-seed (idempotentny)
  NetworkPolicy: default-deny + reguly (gateway→serwisy, serwisy→ich bazy)
```

## 2. Lista zasobów Kubernetes

| Rodzaj | Nazwa | Uwagi |
|---|---|---|
| Namespace | `social-dev` (dev) / `social` (prod) | izolacja środowiska |
| Deployment | `pg-service` | 2 repliki, RollingUpdate, probes, limity, non-root |
| Deployment | `mongo-service` | 2 repliki, RollingUpdate, probes, limity, non-root |
| Deployment | `api-gateway` | nginx unprivileged, ConfigMap nginx.conf |
| Deployment | `redis` | cache (emptyDir, bez PVC) |
| StatefulSet | `postgres` | PVC `pgdata` (volumeClaimTemplates) |
| StatefulSet | `mongodb` | PVC `mongodata` (volumeClaimTemplates) |
| Service | `pg-service`, `mongo-service`, `redis`, `api-gateway` | ClusterIP |
| Service | `postgres`, `mongodb` | headless (clusterIP: None) |
| Ingress | `social-ingress` | host `social.local`, `/` → api-gateway |
| ConfigMap | `app-config`, `nginx-config` | konfiguracja niepoufna |
| Secret | `db-credentials` | hasła + URL-e z hasłem |
| Job | `pg-migrate`, `mongo-seed` | migracje/seedy (initContainer wait-for-db) |
| NetworkPolicy | `default-deny-ingress` + 6 reguł | izolacja ruchu pod↔pod |
| PodDisruptionBudget | `pg-service-pdb`, `mongo-service-pdb` | `minAvailable: 1` |

## 3. Uruchomienie od zera (kind)

Wymagania: Docker, `kubectl`, `kind` (lub minikube/k3d).

```bash
# 1) Klaster
kind create cluster --name social

# 2) Build obrazów (z korzenia repo)
docker build -t pg-service:dev     apps/backend/pg-service
docker build -t mongo-service:dev  apps/backend/mongo-service

# 3) Wgranie obrazów do klastra (kind nie pobiera ich z rejestru)
kind load docker-image pg-service:dev    --name social
kind load docker-image mongo-service:dev --name social

# 3b) (zalecane) Pre-load obrazów bazowych — eliminuje losowe ImagePullBackOff,
#     gdy Docker Hub/CloudFront przerwie pobieranie (EOF) w trakcie startu podów.
for img in redis:7-alpine postgres:15-alpine mongo:6 busybox:1.36 nginxinc/nginx-unprivileged:alpine; do
  docker pull "$img" && kind load docker-image "$img" --name social
done

# 4) Deploy (overlay dev → namespace social-dev)
kubectl apply -k k8s/overlays/dev
```

> **minikube:** zamiast `kind load` użyj `minikube image load pg-service:dev` (i mongo).
> **k3d:** `k3d image import pg-service:dev mongo-service:dev -c <klaster>`.

Czekaj na gotowość:

```bash
kubectl -n social-dev rollout status statefulset/postgres
kubectl -n social-dev rollout status statefulset/mongodb
kubectl -n social-dev wait --for=condition=complete job/pg-migrate --timeout=180s
kubectl -n social-dev wait --for=condition=complete job/mongo-seed --timeout=180s
kubectl -n social-dev rollout status deployment/pg-service
kubectl -n social-dev rollout status deployment/mongo-service
kubectl -n social-dev rollout status deployment/api-gateway
```

Status:

```bash
kubectl -n social-dev get pods,svc,statefulset,deploy,job,pvc
kubectl -n social-dev get deploy pg-service -o wide   # READY 1/1 (dev) lub 2/2 (prod)
```

## 4. Komendy testowe (curl)

Wystawienie gatewaya na host:

```bash
kubectl -n social-dev port-forward svc/api-gateway 8080:80
# (w drugim terminalu wykonuj curl-e poniżej; baza adresowa: http://localhost:8080)
```

> **Przez Ingress (alternatywa):** zainstaluj ingress-nginx, dodaj `127.0.0.1 social.local`
> do `hosts` i wołaj `curl -H "Host: social.local" http://localhost/...`.

### 4.1. Health (`/health`, `/ready` — wymóg minimalnej funkcjonalności)

```bash
curl -s http://localhost:8080/health
curl -s http://localhost:8080/health/pg
curl -s http://localhost:8080/health/mongo
```

Oczekiwany wynik (pg): `{"status":"ok","service":"pg-service","checks":{"postgres":{"ok":true},"redis":{"ok":true}},...}`

### 4.2. Dodanie danych (POST)

```bash
curl -s -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"Hello from k8s CHECKLIST"}'
```

Oczekiwany: kod 201, JSON z `id`, `authorId`, `bodyPreview`, `createdAt`.

### 4.3. Odczyt danych + dowód działania cache (Redis)

```bash
curl -i http://localhost:8080/api/posts | grep -i "x-cache"   # 1. raz: MISS
curl -i http://localhost:8080/api/posts | grep -i "x-cache"   # 2. raz: HIT
```

### 4.4. Feed z mongo-service

```bash
curl -s "http://localhost:8080/api/feed/1?limit=3"
```

## 5. Trwałość danych po restarcie poda bazy (wymóg)

```bash
# 1) Dodaj rekord
curl -s -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"persistence-test"}'

# 2) Usuń poda bazy — StatefulSet odtworzy go z tym samym PVC
kubectl -n social-dev delete pod postgres-0
kubectl -n social-dev rollout status statefulset/postgres

# 3) Odczyt — rekord nadal istnieje (dane przetrwały na PersistentVolumeClaim)
curl -s http://localhost:8080/api/posts | grep "persistence-test"
```

PVC są niezależne od podów:

```bash
kubectl -n social-dev get pvc       # pgdata-postgres-0, mongodata-mongodb-0 — STATUS Bound
```

## 6. Izolacja — bazy/cache/worker nie są wystawione na zewnątrz

```bash
kubectl -n social-dev get svc
```

Oczekiwane: `postgres`/`mongodb` jako `ClusterIP None`, `redis`/`pg-service`/`mongo-service`
jako `ClusterIP` (brak `NodePort`/`LoadBalancer`/`EXTERNAL-IP`). Jedyny ruch zewnętrzny → Ingress → `api-gateway`.

NetworkPolicy (ograniczenie ruchu pod↔pod):

```bash
kubectl -n social-dev get networkpolicy
```

> Uwaga: domyślny CNI kind (`kindnet`) **nie egzekwuje** NetworkPolicy — manifesty są obecne i
> poprawne, ale do realnego testu blokowania użyj klastra z Calico/Cilium (np. `kind` z Calico
> lub minikube `--cni=calico`).

## 7. Sondy, zasoby, securityContext, migracje

```bash
# Probes + resources + securityContext
kubectl -n social-dev describe deploy pg-service | grep -A2 -E "Liveness|Readiness|Limits|Requests"
kubectl -n social-dev get pod -l app=pg-service -o jsonpath='{.items[0].spec.containers[0].securityContext}'; echo
# => allowPrivilegeEscalation:false, capabilities drop ALL, (pod) runAsNonRoot:true, runAsUser:1000

# initContainer (oczekiwanie na zaleznosci) + Job migracji
kubectl -n social-dev get pod -l app=pg-service -o jsonpath='{.items[0].spec.initContainers[*].name}'; echo
# Job czysci sie sam po 1h (ttlSecondsAfterFinished) — jesli juz znikl, sprawdz status zamiast logow:
kubectl -n social-dev logs job/pg-migrate || kubectl -n social-dev get job pg-migrate
```

## 8. Rolling update (min. 2 repliki backendu — overlay prod)

```bash
# overlay prod => 2 repliki; wymusza nowy rollout
kubectl -n social-dev set env deploy/pg-service ROLLING_PROBE=$(date +%s)
kubectl -n social-dev rollout status deploy/pg-service   # bez przerwy w dostepnosci (maxUnavailable:0)
kubectl -n social-dev rollout history deploy/pg-service
```

PodDisruptionBudget:

```bash
kubectl -n social-dev get pdb   # ALLOWED DISRUPTIONS >= 0, MIN AVAILABLE 1
```

## 9. Obserwowalność (/metrics)

```bash
kubectl -n social-dev port-forward deploy/pg-service 3001:3001 &
curl -s http://localhost:3001/metrics | grep -E "http_requests_total|process_cpu" | head
# Pody maja adnotacje prometheus.io/scrape=true, prometheus.io/port, prometheus.io/path=/metrics
kubectl -n social-dev get pod -l app=pg-service -o jsonpath='{.items[0].metadata.annotations}'; echo

# Logi (alternatywna forma obserwowalnosci)
kubectl -n social-dev logs -l app=mongo-service --tail=50
```

## 10. Dwa środowiska (Kustomize)

```bash
kubectl kustomize k8s/overlays/dev   | grep -E "namespace:|replicas:" | sort | uniq -c   # social-dev, repliki 1
kubectl kustomize k8s/overlays/prod  | grep -E "namespace:|replicas:" | sort | uniq -c   # social, repliki 2
```

## 11. CI/CD (GitHub Actions)

Workflow [.github/workflows/cd-k8s.yml](../.github/workflows/cd-k8s.yml) przy pushu na `main`:
buduje obrazy → publikuje do **GHCR** → tworzy klaster **kind** → `kubectl apply -k overlays/dev`
→ czeka na Joby migracji → **sprawdza rollout** (`kubectl rollout status`) → smoke test (`/health`,
POST/GET `/api/posts`, `/api/feed`).

## 12. Czyszczenie

```bash
kubectl delete -k k8s/overlays/dev      # usuwa zasoby (PVC zostaja)
kubectl -n social-dev delete pvc --all  # usuniecie danych
kind delete cluster --name social       # usuniecie klastra
```

---

## Mapowanie na wymagania

| Wymaganie | Gdzie |
|---|---|
| Manifesty (Namespace, Deployment, StatefulSet, Service, Ingress, ConfigMap, Secret, PVC) | `k8s/base/*` |
| Deploymenty + rolling update (backend ≥2 repliki) | `pg-service`/`mongo-service` (prod: 2 repliki, RollingUpdate maxUnavailable:0) |
| Baza + trwałość (StatefulSet + PVC) | `postgres`/`mongodb` StatefulSet + volumeClaimTemplates (§5) |
| Services, Ingress, izolacja | §6 — tylko gateway za Ingress, reszta ClusterIP |
| ConfigMap + Secret | `app-config`, `nginx-config`, `db-credentials` |
| Probes + resources | §7 — readiness/liveness + requests/limits |
| securityContext + initContainer/Job | §7 — non-root + `pg-migrate`/`mongo-seed` Job + initContainer wait-for-db |
| CI/CD (build, test, push, deploy, rollout) | §11 — `cd-k8s.yml` |
| NetworkPolicy (+2.5%) | `networkpolicy.yaml` (§6) |
| PodDisruptionBudget (+2.5%) | `pdb.yaml` (§8) |
| Helm/Kustomize, 2 środowiska (+2.5%) | `overlays/dev` + `overlays/prod` (§10) |
| Obserwowalność (+2.5%) | `/metrics` + adnotacje Prometheusa (§9) |
| Minimalna funkcjonalność (add/read + /health) | §4 |
| Trwałość danych aplikacji | §5 |
| Cache/kolejka/worker | Redis + dowód `X-Cache` (§4.3) |

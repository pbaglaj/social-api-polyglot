# Plan wdrożenia projektu na Kubernetes

Dokument ocenia obecny stan repozytorium (wariant Docker) względem wymagań z
[kubernetes_readme.md](kubernetes_readme.md) i opisuje konkretny plan doprowadzenia
aplikacji do działania w klastrze Kubernetes z pełnym pipeline CI/CD.

> **Maksymalna punktacja:** 40 pkt. Grupa „Kubernetes + CI/CD” = 80% wagi,
> elementy dodatkowe = +10%, wymagania specyficzne (funkcjonalność/trwałość/cache) =
> kolejne 20%.

---

## 1. Ocena stanu obecnego

Projekt ma już bardzo dobrą bazę z wariantu Docker, którą da się w dużej części przenieść 1:1.

### Co jest gotowe do ponownego użycia

| Element | Stan obecny | Przydatność dla K8s |
|---|---|---|
| **pg-service** (Express, Node 22) | Multi-stage Dockerfile, `USER node`, `/health` zwraca 200/503 | Gotowy obraz, gotowa sonda |
| **mongo-service** (Express, Node 22) | Multi-stage Dockerfile, `USER node`, `/health` zwraca 200/503 | Gotowy obraz, gotowa sonda |
| **api-gateway** (nginx) | Reverse proxy `/api/*`, CORS, agregacja `/health` | Reużywalny po zmianie `resolver` (Docker DNS → kube-dns) |
| **Bazy danych** | postgres:15-alpine, mongo:6, redis:7-alpine | Te same obrazy w StatefulSet/Deployment |
| **Migracje** | Prisma `migrate deploy` + Knex `migrate:latest` + seedy (w `command` compose) | Przeniesienie do **Job/initContainer** |
| **Sekrety** | Pliki `postgres_password`, `mongo_password` (Docker secrets) | Mapowanie na obiekt **Secret** |
| **Konfiguracja** | `.env.example` (DATABASE_URL, MONGO_URI, REDIS_URL, CACHE_TTL_SECONDS, porty) | Podział na **ConfigMap** (jawne) + **Secret** (poufne) |
| **Graceful shutdown** | Handler SIGTERM w obu serwisach (25 s) | Współgra z `terminationGracePeriodSeconds` |
| **Health checks** | Endpoint `/health` w obu serwisach | Bezpośrednio jako readiness/liveness |
| **CI** | GitHub Actions: testy pg/mongo, docker build, e2e (newman) | Rozszerzenie o push do rejestru + deploy + rollout |

### Czego brakuje (luki względem wymagań)

1. Brak jakichkolwiek manifestów Kubernetes (`k8s/`, Helm lub Kustomize).
2. Brak StatefulSet + PVC dla baz (obecnie named volumes Dockera).
3. Brak Ingress, sond w formacie K8s, `resources.requests/limits`, `securityContext` na poziomie poda.
4. Brak NetworkPolicy, PodDisruptionBudget.
5. Brak endpointu `/metrics` (obserwowalność — element dodatkowy).
6. CI nie publikuje obrazów do rejestru ani nie wdraża na klaster.
7. Brak `CHECKLIST.md` dla wariantu Kubernetes.
8. `nginx.conf` używa `resolver 127.0.0.11` (Docker embedded DNS) — nie działa w K8s.

---

## 2. Architektura docelowa w Kubernetes

```
                          Internet / kubectl port-forward
                                      │
                              ┌───────▼────────┐
                              │    Ingress     │  (ingress-nginx)
                              │  host: social. │  ścieżki / oraz /api/*
                              │   local        │
                              └───────┬────────┘
                                      │ Service (ClusterIP)
                          ┌───────────▼────────────┐
                          │   api-gateway (nginx)   │  Deployment x2
                          │   ConfigMap: nginx.conf │  (resolver = kube-dns)
                          └─────┬──────────────┬────┘
                  /api/posts... │              │ /api/feed, /api/analytics
                  /api/users... │              │
                       ┌────────▼───────┐  ┌───▼─────────────┐
                       │   pg-service   │  │  mongo-service  │  Deployment x2
                       │  Deployment x2 │  │  Deployment x2  │  (RollingUpdate)
                       │  RollingUpdate │  │                 │  non-root, probes,
                       │  + PDB         │  │                 │  requests/limits
                       └──┬──────────┬──┘  └────────┬────────┘
            Service       │          │ Service      │ Service
         ┌────────────────▼┐   ┌─────▼────┐   ┌─────▼──────────┐
         │   postgres      │   │  redis   │   │    mongodb     │
         │  StatefulSet    │   │ Deploy   │   │  StatefulSet   │
         │  + PVC (pgdata) │   │ (cache)  │   │  + PVC (mongo) │
         └─────────────────┘   └──────────┘   └────────────────┘

  Namespace: social
  NetworkPolicy: default-deny + reguły (gateway→serwisy, serwisy→ich bazy)
  Secret: db-credentials   ConfigMap: app-config + nginx-config
  Job: db-migrate (Prisma + Knex + seed)   initContainer: wait-for-db
```

**Kluczowe decyzje architektoniczne:**

- **api-gateway pozostaje** jako pojedynczy punkt wejścia za Ingressem (parytet z wariantem
  Docker, zachowuje agregację `/health` i CORS). Wymaga osobnego `nginx.conf` w ConfigMap ze
  zmianą `resolver` na `kube-dns.kube-system.svc.cluster.local`.
  *(Alternatywa: routing ścieżkowy bezpośrednio na Ingressie — opisana w §7.)*
- **Postgres i MongoDB → StatefulSet + PVC** (trwałość, stabilna tożsamość sieciowa).
- **Redis → Deployment** (cache, dane efemeryczne; `emptyDir` wystarczy) — spełnia wymóg
  „cache/kolejka/worker”.
- **Backend (pg-service, mongo-service) → Deployment, 2 repliki, RollingUpdate.**
- **Migracje → dedykowany Job** (uruchamiany raz przed startem), a w podach aplikacji
  **initContainer** czekający na gotowość bazy → pokrywa wymóg „initContainer **albo** Job”
  obiema metodami.
- **Kustomize (base + overlays dev/prod)** zamiast surowych manifestów → zalicza element
  dodatkowy „Helm albo Kustomize” i daje dwa środowiska.

---

## 3. Proponowana struktura katalogów

```
k8s/
├── base/
│   ├── namespace.yaml
│   ├── configmap-app.yaml          # DATABASE_URL, MONGO_URI, REDIS_URL, CACHE_TTL, porty
│   ├── configmap-nginx.yaml        # nginx.conf dla K8s (resolver kube-dns)
│   ├── secret.yaml                 # db-credentials (placeholdery, NIE realne hasła)
│   ├── postgres-statefulset.yaml   # + headless Service + volumeClaimTemplates
│   ├── postgres-service.yaml
│   ├── mongodb-statefulset.yaml    # + volumeClaimTemplates
│   ├── mongodb-service.yaml
│   ├── redis-deployment.yaml
│   ├── redis-service.yaml
│   ├── pg-service-deployment.yaml  # 2 repliki, initContainer wait-for-db, probes, limits, securityContext
│   ├── pg-service-service.yaml
│   ├── pg-service-pdb.yaml         # PodDisruptionBudget minAvailable: 1
│   ├── mongo-service-deployment.yaml
│   ├── mongo-service-service.yaml
│   ├── gateway-deployment.yaml
│   ├── gateway-service.yaml
│   ├── ingress.yaml
│   ├── job-migrate.yaml            # Prisma migrate deploy + Knex latest (+ seed idempotentny)
│   ├── networkpolicy.yaml          # default-deny + reguły
│   └── kustomization.yaml
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml       # replicas=1/2, tag=dev, namespace=social-dev
    │   └── patches/...
    └── prod/
        ├── kustomization.yaml       # replicas=2/2, tag=stabilny, większe limity
        └── patches/...
```

---

## 4. Plan zadań — krok po kroku

Kolejność jest ułożona tak, by każdy etap dało się zweryfikować osobno (`kubectl apply` + sprawdzenie).

### Etap 0 — Przygotowanie obrazów i rejestru
- [ ] Zmienić nazewnictwo obrazów na `ghcr.io/<owner>/pg-service` i `.../mongo-service`.
- [ ] Potwierdzić, że Dockerfile'e budują się bez zmian (są już non-root, multi-stage).
- [ ] **Drobna zmiana kodu (opcjonalna, dla `/metrics`):** dodać `prom-client` + middleware
      eksponujący `/metrics` w obu serwisach (patrz Etap 8).

### Etap 1 — Fundament klastra
- [ ] `namespace.yaml` → `social` (oraz `social-dev` w overlay).
- [ ] `secret.yaml` — `POSTGRES_PASSWORD`, `MONGO_PASSWORD` jako placeholdery
      (`CHANGEME`/`stringData`), realne wartości wstrzykiwane przez CI lub `kubectl create secret`.
- [ ] `configmap-app.yaml` — niepoufne: `POSTGRES_USER`, `POSTGRES_DB`, `MONGO_URI` (bez hasła),
      `REDIS_URL`, `CACHE_TTL_SECONDS`, porty. `DATABASE_URL`/`MONGO_URI` z hasłem składane
      z Secret (przez `valueFrom` lub initContainer budujący URL).
- **Weryfikacja:** `kubectl get ns social`, `kubectl -n social get configmap,secret`.

### Etap 2 — Bazy danych (trwałość)  *(waga 12% + 5%)*
- [ ] `postgres-statefulset.yaml`: 1 replika, `volumeClaimTemplates` (PVC `pgdata`, 1Gi),
      `readinessProbe`/`livenessProbe` = `pg_isready`, `resources`, `securityContext` (postgres uid).
- [ ] Headless Service `postgres` (clusterIP: None) + zwykły Service do połączeń.
- [ ] `mongodb-statefulset.yaml`: analogicznie, PVC `mongodata`, sonda `mongosh ping`.
- [ ] `redis-deployment.yaml` + Service (bez PVC, cache).
- **Weryfikacja trwałości:** dodać rekord → `kubectl delete pod postgres-0` → po odtworzeniu
      rekord nadal istnieje (PVC przetrwał).

### Etap 3 — Migracje (initContainer + Job)  *(waga 8%)*
- [ ] `job-migrate.yaml`: obraz `pg-service`, `command`:
      `npx prisma migrate deploy && npx knex migrate:latest --knexfile knexfile.cjs`.
- [ ] Seedy: uruchamiać **idempotentnie** lub jednorazowo (uwaga: obecne seedy używają fakera —
      przy każdym deployu duplikowałyby dane). Rekomendacja: w Jobie tylko migracje; seed jako
      osobny krok włączany flagą `RUN_SEED=true` z `upsert`/`onConflict`. **(do potwierdzenia, §6)**
- [ ] initContainer `wait-for-postgres` w deploymencie pg-service (np. `busybox` + pętla `nc`).
- [ ] initContainer `wait-for-mongo` analogicznie + seed mongo (`node dist/seed.js`) jednorazowo.
- **Weryfikacja:** `kubectl -n social get jobs`, `kubectl logs job/db-migrate`.

### Etap 4 — Backend jako Deployment  *(waga 10% + 10% sondy/zasoby + 8% securityContext)*
- [ ] `pg-service-deployment.yaml`:
  - `replicas: 2`, `strategy: RollingUpdate` (maxSurge 1, maxUnavailable 0),
  - `readinessProbe`/`livenessProbe` → `GET /health` (port 3001),
  - `resources.requests` (np. 100m/128Mi) + `limits` (np. 500m/512Mi),
  - `securityContext`: `runAsNonRoot: true`, `runAsUser: 1000`, `allowPrivilegeEscalation: false`,
    `readOnlyRootFilesystem: true` (z `emptyDir` na zapis, jeśli potrzebny), `capabilities.drop: [ALL]`,
  - env z ConfigMap + Secret, initContainer wait-for-db.
- [ ] `mongo-service-deployment.yaml`: analogicznie, 2 repliki, sonda `/health` (3002).
- [ ] Service ClusterIP dla obu (porty 3001/3002).
- **Weryfikacja:** `kubectl get deploy`, `kubectl rollout status deploy/pg-service`.

### Etap 5 — Gateway + Ingress + izolacja  *(waga 10%)*
- [ ] `configmap-nginx.yaml` — kopia `nginx.conf` ze zmianą:
      `resolver kube-dns.kube-system.svc.cluster.local valid=10s;`
      (upstreamy `pg-service:3001`, `mongo-service:3002` rozwiązują się przez kube-dns).
- [ ] `gateway-deployment.yaml` (nginx:alpine, montuje ConfigMap) + Service.
- [ ] `ingress.yaml` → host `social.local`, ścieżka `/` → gateway Service.
- [ ] Upewnić się, że Service'y baz/cache/serwisów są tylko `ClusterIP` (brak NodePort/LoadBalancer)
      → bazy i worker niewystawione na zewnątrz.
- **Weryfikacja:** `curl -H "Host: social.local" http://<ingress-ip>/api/posts`.

### Etap 6 — NetworkPolicy  *(dodatkowe +2.5%)*
- [ ] `default-deny` (ingress) w namespace.
- [ ] Reguły: `ingress-nginx → gateway`, `gateway → pg-service/mongo-service`,
      `pg-service → postgres,redis`, `mongo-service → mongodb`, Job → bazy.
- **Weryfikacja:** test, że pod spoza polityki nie połączy się z postgresem.

### Etap 7 — PodDisruptionBudget  *(dodatkowe +2.5%)*
- [ ] `pg-service-pdb.yaml`: `minAvailable: 1` dla pg-service (i opcjonalnie mongo-service).
- **Weryfikacja:** `kubectl get pdb`, `kubectl drain` nie schodzi poniżej 1 repliki.

### Etap 8 — Obserwowalność  *(dodatkowe +2.5%)*
- [ ] Dodać `prom-client` do obu serwisów + endpoint `GET /metrics`
      (`http_requests_total`, czasy odpowiedzi, default metrics).
- [ ] Adnotacje Prometheusa na podach: `prometheus.io/scrape: "true"`, `prometheus.io/port`, `/metrics`.
- [ ] Instrukcja w CHECKLIST: `kubectl port-forward` + `curl /metrics`, oraz `kubectl logs`.

### Etap 9 — Kustomize (dwa środowiska)  *(dodatkowe +2.5%)*
- [ ] `base/kustomization.yaml` z listą zasobów + `images:` (tag wstrzykiwany).
- [ ] `overlays/dev`: namespace `social-dev`, repliki 1, mniejsze limity.
- [ ] `overlays/prod`: namespace `social`, repliki 2, pełne limity.
- **Weryfikacja:** `kubectl kustomize k8s/overlays/dev` i `.../prod` generują poprawne manifesty.

### Etap 10 — CI/CD GitHub Actions  *(waga 10%)*
Nowy job `k8s-deploy` (lub osobny workflow `deploy.yml`):
- [ ] **Build + test:** reużyć istniejące joby testów (pg/mongo) jako bramkę.
- [ ] **Push obrazów:** `docker/login-action` → GHCR (`permissions: packages: write`,
      `GITHUB_TOKEN`), `docker/build-push-action` z tagiem `ghcr.io/<owner>/<svc>:${{ github.sha }}`.
- [ ] **Klaster w runnerze:** `helm/kind-action` (kind), `kind load docker-image` (lub pull z GHCR).
- [ ] **Deploy:** `kubectl apply -k k8s/overlays/dev` (kustomize ustawia tag = SHA).
- [ ] **Sprawdzenie rolloutu:** `kubectl rollout status deploy/pg-service --timeout=120s`
      (i mongo-service, gateway). Job migracji: `kubectl wait --for=condition=complete job/db-migrate`.
- [ ] **Smoke test:** `kubectl port-forward` / Ingress + 2–3 `curl` (`/health`, POST + GET `/api/posts`).
- **Weryfikacja:** zielony workflow + link do runu w CHECKLIST.

### Etap 11 — Dokumentacja
- [ ] `docs/kubernetes_checklist.md` (wzorzec: [docker_checklist.md](docker_checklist.md)):
      uruchomienie na kind/minikube/k3d, lista zasobów, komendy `kubectl`, przykładowe wyniki,
      link do ostatniego udanego workflow.
- [ ] Rozważyć `CHECKLIST.md` w korzeniu repo (wymaganie literalnie mówi o `CHECKLIST.md`).

---

## 5. Mapowanie wymagań → punktacja (szacunek)

| Wymaganie | Waga | Pokrycie w planie |
|---|---|---|
| Manifesty K8s (Namespace, Deployment, StatefulSet, Service, Ingress, ConfigMap, Secret, PVC) | 12% | Etap 1–5 — wszystkie obiekty obecne |
| Deploymenty + rolling update (backend ≥2 repliki) | 10% | Etap 4 — RollingUpdate, 2 repliki |
| Baza + trwałość (StatefulSet + PVC) | 12% | Etap 2 |
| Services, Ingress, izolacja | 10% | Etap 2/5 — tylko gateway za Ingress, reszta ClusterIP |
| ConfigMap + Secret | 8% | Etap 1 |
| Probes + resources | 10% | Etap 2/4 — readiness/liveness + requests/limits |
| securityContext + initContainer/Job | 8% | Etap 3/4 — non-root + Job + initContainer |
| CI/CD (build, test, push, deploy, rollout) | 10% | Etap 10 |
| **Suma grupy głównej** | **80%** | |
| NetworkPolicy | +2.5% | Etap 6 |
| PodDisruptionBudget | +2.5% | Etap 7 |
| Helm/Kustomize (2 środowiska) | +2.5% | Etap 9 |
| Obserwowalność (/metrics) | +2.5% | Etap 8 |
| Minimalna funkcjonalność (add/read + /health) | 10% | Już w kodzie — POST/GET `/api/posts`, `/health` |
| Trwałość danych aplikacji | 5% | Etap 2 (test usunięcia poda bazy) |
| Cache/kolejka/worker | 5% | Redis (Etap 2) + dowód `X-Cache` w CHECKLIST |

Plan pokrywa **100% grupy głównej + wszystkie 4 elementy dodatkowe (+10%)** oraz wymagania specyficzne.

---

## 6. Kwestie do rozstrzygnięcia / ryzyka

1. **Seedy a wielokrotny deploy.** Obecne seedy (Prisma/Knex/`seed.js`) używają `@faker-js/faker`
   i przy każdym uruchomieniu Jobu dodałyby nowe losowe dane. Trzeba: (a) uczynić je idempotentnymi
   (`upsert`/`onConflict('ignore')`), albo (b) uruchamiać seed tylko raz (Job z `RUN_SEED` ustawianym
   wyłącznie przy pierwszym wdrożeniu). **Rekomendacja: w Jobie tylko migracje; seed osobno i idempotentnie.**
2. **`DATABASE_URL`/`MONGO_URI` zawierają hasło.** Trzeba zdecydować: trzymać cały URL w Secret,
   czy składać go w initContainerze z `POSTGRES_USER` (ConfigMap) + `POSTGRES_PASSWORD` (Secret).
   Składanie jest czystsze, ale wymaga małego skryptu startowego.
3. **`readOnlyRootFilesystem: true`** — Prisma/tsx mogą zapisywać do `.cache`/`/tmp`. Może być
   potrzebny `emptyDir` na `/tmp` i `/app/.cache`. Do przetestowania.
4. **nginx resolver w K8s** — zmiana z `127.0.0.11` na kube-dns jest obowiązkowa, inaczej gateway
   nie rozwiąże nazw serwisów.
5. **Rejestr obrazów** — domyślnie GHCR (darmowy, zintegrowany z `GITHUB_TOKEN`). Alternatywa:
   Docker Hub (wymaga sekretów w repo).
6. **Klaster w CI** — kind w runnerze jest efemeryczny (deploy + rollout + smoke, potem teardown).
   Jeśli wymagany jest trwały klaster, plan trzeba rozszerzyć o `kubeconfig` w sekretach.

---

## 7. Alternatywa: Ingress jako gateway (bez nginx)

Zamiast utrzymywać osobny pod nginx, Ingress (ingress-nginx) może routować ścieżki bezpośrednio:
`/api/posts|users|stats|tags|notifications`, `/health/pg` → `pg-service`;
`/api/feed|analytics`, `/health/mongo` → `mongo-service`. CORS przez adnotacje Ingressa.

- **Plusy:** mniej zasobów, bardziej „k8s-native”, jeden hop mniej.
- **Minusy:** tracimy agregację `/health` i parytet z wariantem Docker; logika z `nginx.conf`
  przenosi się do adnotacji/reguł Ingressa.

**Rekomendacja:** wariant podstawowy z gateway (parytet, łatwiejsza obrona), ale decyzja
do potwierdzenia z prowadzącym.

---

## 8. Kolejność realizacji (skrót)

1. Etap 0–1 (rejestr, namespace, config/secret)
2. Etap 2 (bazy + PVC) → test trwałości
3. Etap 3 (Job migracji + initContainery)
4. Etap 4 (backend Deploymenty) → `rollout status`
5. Etap 5 (gateway + Ingress) → smoke `curl`
6. Etap 6–9 (NetworkPolicy, PDB, /metrics, Kustomize) — elementy dodatkowe
7. Etap 10 (CI/CD) → zielony workflow
8. Etap 11 (CHECKLIST + dokumentacja)

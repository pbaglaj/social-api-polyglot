# Struktura katalogu `k8s/` — opis każdego pliku

Manifesty Kubernetes zorganizowane są wzorcem **Kustomize**: wspólna `base/` +
nakładki środowiskowe `overlays/dev` i `overlays/prod`. `base/` jest kompletnym,
działającym zestawem zasobów; nakładki tylko go modyfikują (namespace, liczba
replik, obrazy, limity), nie duplikując manifestów.

```
k8s/
├── base/                      # pełny, neutralny zestaw zasobów
│   ├── kustomization.yaml     # spina wszystkie manifesty base/
│   ├── namespace.yaml
│   ├── configmap-app.yaml     # konfiguracja niepoufna
│   ├── configmap-nginx.yaml   # nginx.conf gatewaya
│   ├── secret.yaml            # hasła / URL-e z hasłem
│   ├── postgres-statefulset.yaml + postgres-service.yaml
│   ├── mongodb-statefulset.yaml + mongodb-service.yaml
│   ├── redis-deployment.yaml  + redis-service.yaml
│   ├── job-migrate.yaml       # migracje + seed Postgresa
│   ├── job-mongo-seed.yaml    # seed Mongo
│   ├── pg-service-deployment.yaml    + pg-service-service.yaml
│   ├── mongo-service-deployment.yaml + mongo-service-service.yaml
│   ├── gateway-deployment.yaml       + gateway-service.yaml
│   ├── ingress.yaml           # wejście z zewnątrz → api-gateway
│   ├── networkpolicy.yaml     # default-deny + reguły pod↔pod
│   └── pdb.yaml               # PodDisruptionBudget backendów
└── overlays/
    ├── dev/kustomization.yaml   # namespace social-dev, 1 replika, obrazy lokalne :dev
    └── prod/kustomization.yaml  # namespace social, 2 repliki, obrazy GHCR, większe limity
```

---

## `base/` — zasoby współdzielone

### `kustomization.yaml`
Punkt wejścia Kustomize dla bazy. Robi trzy rzeczy:
- **`resources:`** — wymienia wszystkie pliki manifestów (kolejność na liście nie
  wymusza kolejności tworzenia — o zależności startowe dbają initContainery i Joby).
- **`labels:`** — dokleja `app.kubernetes.io/part-of: social-api-polyglot` do każdego
  zasobu, z `includeSelectors: false` (nie wstrzykuje etykiety do niemutowalnych
  selektorów Deploymentów/StatefulSetów).
- **`images:`** — centralny punkt podmiany obrazów (`pg-service`, `mongo-service`);
  nakładki i CI nadpisują tu `newName`/`newTag`.
- Domyślny `namespace: social` (nadpisywany przez nakładkę dev na `social-dev`).

### `namespace.yaml`
Definicja `Namespace social` — izolacja środowiska. Nakładki nadpisują nazwę
(`social-dev` / `social`), więc to tylko wartość bazowa.

### `configmap-app.yaml` — ConfigMap `app-config`
Konfiguracja **niepoufna** wstrzykiwana do podów jako zmienne środowiskowe:
`NODE_ENV`, `POSTGRES_USER/DB`, `PGDATA`, porty serwisów (`PG_SERVICE_PORT`,
`MONGO_SERVICE_PORT`), `REDIS_URL`, `CACHE_TTL_SECONDS`. Dane wrażliwe celowo
NIE są tutaj — trafiają do Secreta.

### `configmap-nginx.yaml` — ConfigMap `nginx-config`
Plik `nginx.conf` dla gatewaya w wariancie Kubernetes. Montowany do poda
api-gateway. Definiuje:
- `upstream`y po nazwach Service'ów (`pg-service:3001`, `mongo-service:3002`) —
  ClusterIP jest stabilny, więc nginx rozwiązuje DNS raz przy starcie.
- routing ścieżek: `/api/users|posts|stats|tags|notifications` → pg-service;
  `/api/feed|analytics` → mongo-service.
- własny `/health` (zwraca JSON gatewaya) oraz proxy `/health/pg`, `/health/mongo`.
- nasłuch na `8080` i `pid /tmp/nginx.pid` (wymóg obrazu nginx-unprivileged, uid 101).

### `secret.yaml` — Secret `db-credentials`
Dane **poufne**: `POSTGRES_PASSWORD`, `DATABASE_URL` (z hasłem, dla Prisma/Knex),
`MONGO_INITDB_ROOT_*`, `MONGO_URI`. Wartości w repo to **placeholdery developerskie**
— na produkcji nadpisywane przez `kubectl create secret` lub sekrety CI.

---

### Bazy danych — StatefulSet + headless Service

Bazy działają jako **StatefulSet** (stabilna tożsamość poda + trwały dysk przez
`volumeClaimTemplates`), wystawione przez **headless Service** (`clusterIP: None`),
co daje stałą nazwę DNS poda i zero ekspozycji poza klaster.

#### `postgres-statefulset.yaml`
Postgres 15-alpine, 1 replika. `volumeClaimTemplates` tworzy PVC `pgdata` (1Gi,
RWO) montowany w `/var/lib/postgresql/data` — **dane przeżywają restart poda**.
`securityContext.fsGroup: 70` daje userowi `postgres` prawo zapisu na PVC.
Probes: `pg_isready` (readiness/liveness). Konfiguracja z `app-config`, hasło z Secreta.

#### `postgres-service.yaml`
Headless Service `postgres` (`clusterIP: None`, port 5432). Daje stabilny adres
`postgres-0.postgres` i nie wystawia bazy poza klaster.

#### `mongodb-statefulset.yaml`
Mongo 6, 1 replika. PVC `mongodata` (1Gi) w `/data/db`. `fsGroup: 999`.
Probes: `mongosh ... ping`. Root user/hasło z Secreta.

#### `mongodb-service.yaml`
Headless Service `mongodb` (`clusterIP: None`, port 27017) — analogicznie do Postgresa.

---

### Cache — Redis

#### `redis-deployment.yaml`
Redis 7-alpine jako **Deployment** (nie StatefulSet — cache jest efemeryczny).
Uruchamiany z `--save "" --appendonly no` (bez persystencji), dane na `emptyDir`.
Twardo zahartowany: `runAsNonRoot`, `readOnlyRootFilesystem`, `drop: ALL`.
Probes: `redis-cli ping`.

#### `redis-service.yaml`
ClusterIP Service `redis` (port 6379) — dostępny tylko wewnątrz klastra dla pg-service.

---

### Joby inicjalizujące (uruchamiane raz)

#### `job-migrate.yaml` — Job `pg-migrate`
Jednorazowa inicjalizacja Postgresa: Prisma `migrate deploy` → Knex `migrate:latest`
→ Prisma `db seed` → Knex `seed:run`. Używa obrazu `pg-service:dev`.
- **initContainer `wait-for-postgres`** czeka na port 5432, zanim ruszą migracje.
- `restartPolicy: OnFailure`, `backoffLimit: 5`.
- `ttlSecondsAfterFinished: 3600` — Job sam się usuwa po 1h (logi dostępne przez
  cały czas przeglądu wg checklisty).
- `REDIS_DISABLED=true`, by seed nie wisiał na połączeniu do Redis.
- Re-run: `kubectl delete job pg-migrate` i ponowny `apply` (Job jest niemutowalny).

#### `job-mongo-seed.yaml` — Job `mongo-seed`
Idempotentny seed feedu/rich-postów (`deleteMany` przed `insertMany`), obraz
`mongo-service:dev`, `node dist/seed.js`. initContainer `wait-for-mongo` czeka na
27017. Również `ttlSecondsAfterFinished: 3600`.

---

### Serwisy backendowe — Deployment + ClusterIP Service

Oba backendy: 2 repliki (HA), `RollingUpdate` z `maxSurge:1 / maxUnavailable:0`
(zero przerwy podczas wdrożenia), `runAsNonRoot` (uid 1000), `drop: ALL`,
adnotacje Prometheusa (`scrape/port/path=/metrics`), probes HTTP `/health`,
requesty/limity zasobów oraz `terminationGracePeriodSeconds: 30` (graceful shutdown).

#### `pg-service-deployment.yaml`
Usługa Node przy Postgresie + Redis (cache). Port 3001. initContainer
`wait-for-postgres` czeka **i** na postgres:5432, **i** na redis:6379.
Konfiguracja z `app-config`, `DATABASE_URL` z Secreta.

#### `pg-service-service.yaml`
ClusterIP Service `pg-service` (port 3001) — ruch tylko z api-gateway, brak ekspozycji.

#### `mongo-service-deployment.yaml`
Usługa Node przy MongoDB (feed/analytics/rich-posts). Port 3002. initContainer
`wait-for-mongo`. `MONGO_URI` z Secreta.

#### `mongo-service-service.yaml`
ClusterIP Service `mongo-service` (port 3002).

---

### API Gateway (wejście do klastra)

#### `gateway-deployment.yaml`
nginx (`nginxinc/nginx-unprivileged:alpine`, uid 101), 2 repliki, RollingUpdate.
Montuje ConfigMap `nginx-config` jako `/etc/nginx/nginx.conf` (read-only, `subPath`).
Nasłuch 8080, probes na `/health`. To jedyny komponent, do którego trafia ruch z zewnątrz.

> **Dlaczego gateway jest `Ready` zanim wstaną bazy?** To zamierzone. nginx nie ma
> initContainera czekającego na bazę, a jego `readinessProbe /health` zwraca
> **statyczny 200** lokalnie z nginx (patrz `configmap-nginx.yaml`, `location = /health`)
> — nie dotyka backendów. Dlatego gateway jest gotowy w kilka sekund, podczas gdy
> pg-service/mongo-service czekają (initContainer) aż bazy przyjmą połączenia.
> Zanim backendy wstaną, `/api/...` zwróci 502, ale samo `/health` gatewaya działa.

#### `gateway-service.yaml`
ClusterIP Service `api-gateway` (port 80 → targetPort http/8080). Celowo ClusterIP —
ruch wchodzi **wyłącznie przez Ingress**, nie bezpośrednio.

#### `ingress.yaml` — Ingress `social-ingress`
Punkt wejścia z zewnątrz: `ingressClassName: nginx`, host `social.local`,
`/` (Prefix) → Service `api-gateway:80`. Cała ścieżka ruchu:
`Internet → Ingress → api-gateway → pg-service/mongo-service → bazy`.

---

### Polityki i ochrona dostępności

#### `networkpolicy.yaml`
`default-deny-ingress` blokuje cały ruch przychodzący w namespace, a 6 reguł
otwiera tylko konkretne ścieżki:
- ingress-controller → `api-gateway` (8080)
- `api-gateway` → `pg-service` (3001)
- `api-gateway` **i** `pg-service` → `mongo-service` (3002) — reguła
  `allow-mongo-service-from-gateway-and-pg` obejmuje synchroniczny fan-out T8c
  (pg-service woła wewnętrzne endpointy mongo-service)
- `pg-service` **i** Job `pg-migrate` → `postgres` (5432)
- `pg-service` → `redis` (6379)
- `mongo-service` **i** Job `mongo-seed` → `mongodb` (27017)

> Uwaga: domyślny CNI `kind` (kindnet) NIE egzekwuje NetworkPolicy — manifesty są
> poprawne, ale do realnego testu blokowania użyj Calico/Cilium.

#### `pdb.yaml`
Dwa PodDisruptionBudget (`pg-service-pdb`, `mongo-service-pdb`) z `minAvailable: 1`
— gwarantują co najmniej 1 działający pod backendu podczas rolling-update, drainu
węzła czy prac utrzymaniowych klastra.

---

## `overlays/` — różnice środowiskowe

Nakładki nie kopiują manifestów; biorą `../../base` i nakładają poprawki.

### `overlays/dev/kustomization.yaml`
Środowisko lokalne/lekkie:
- **`namespace: social-dev`** (nadpisuje bazowy `social`).
- **`replicas: 1`** dla pg-service, mongo-service, api-gateway — oszczędność na kind/minikube.
- **`images:`** lokalne obrazy z tagiem `:dev` (wgrywane przez `kind load`).
- **`commonAnnotations: social.env: dev`** na wszystkich zasobach.

### `overlays/prod/kustomization.yaml`
Środowisko produkcyjne (HA):
- **`namespace: social`**.
- **`replicas: 2`** dla wszystkich trzech backendów (wysoka dostępność + rolling update).
- **`images:`** z GHCR (`ghcr.io/OWNER/...:stable`) — CI podmienia `newTag` na SHA commita.
- **`patches:`** podnoszą limity zasobów (CPU `1`, RAM `768Mi`) dla pg-service i mongo-service.
- **`commonAnnotations: social.env: prod`**.

> StatefulSety (postgres, mongodb) i redis pozostają przy 1 replice w obu środowiskach
> — skalowane są tylko bezstanowe backendy. Stąd `kubectl kustomize overlays/prod`
> pokazuje 3× `replicas: 1` i 3× `replicas: 2`.

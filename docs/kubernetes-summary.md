# Kubernetes — podsumowanie realizacji wymagań

Dla każdego wymagania z [kubernetes-readme.md](kubernetes-readme.md): krótki opis, jak zostało spełnione oraz wskazanie pliku i linii w repozytorium.

## Wymagania architektoniczne — Kubernetes i CI/CD (80%)

### Manifesty Kubernetes (12%)
**Wymaganie:** katalog `k8s/` (lub Helm/Kustomize) z minimum: Namespace, Deployment, StatefulSet (baza), Service, Ingress, ConfigMap, Secret, PVC.
**Realizacja:** katalog [k8s/](../k8s/) zorganizowany jako Kustomize (base + overlays). Wszystkie wymagane typy obecne:
- Namespace — [k8s/base/namespace.yaml:2](../k8s/base/namespace.yaml#L2)
- Deployment — [k8s/base/pg-service-deployment.yaml:2](../k8s/base/pg-service-deployment.yaml#L2), [mongo-service-deployment.yaml:2](../k8s/base/mongo-service-deployment.yaml#L2), [gateway-deployment.yaml:2](../k8s/base/gateway-deployment.yaml#L2), [redis-deployment.yaml:2](../k8s/base/redis-deployment.yaml#L2)
- StatefulSet (bazy) — [k8s/base/postgres-statefulset.yaml:2](../k8s/base/postgres-statefulset.yaml#L2), [mongodb-statefulset.yaml:2](../k8s/base/mongodb-statefulset.yaml#L2)
- Service — [k8s/base/postgres-service.yaml:2](../k8s/base/postgres-service.yaml#L2), [gateway-service.yaml](../k8s/base/gateway-service.yaml), i pozostałe `*-service.yaml`
- Ingress — [k8s/base/ingress.yaml:2](../k8s/base/ingress.yaml#L2)
- ConfigMap — [k8s/base/configmap-app.yaml:2](../k8s/base/configmap-app.yaml#L2), [configmap-nginx.yaml](../k8s/base/configmap-nginx.yaml)
- Secret — [k8s/base/secret.yaml:2](../k8s/base/secret.yaml#L2)
- PVC — `volumeClaimTemplates` w [postgres-statefulset.yaml:73](../k8s/base/postgres-statefulset.yaml#L73) i [mongodb-statefulset.yaml:68](../k8s/base/mongodb-statefulset.yaml#L68)
- Spis zasobów — [k8s/base/kustomization.yaml:14-35](../k8s/base/kustomization.yaml#L14-L35)

### Deploymenty i rolling update (10%)
**Wymaganie:** front/API/worker jako Deployment; backend min. 2 repliki i strategia rolling update.
**Realizacja:** `pg-service` i `mongo-service` mają `replicas: 2` oraz `strategy: RollingUpdate` (maxSurge 1 / maxUnavailable 0) — [pg-service-deployment.yaml:9-14](../k8s/base/pg-service-deployment.yaml#L9-L14), [mongo-service-deployment.yaml:9-14](../k8s/base/mongo-service-deployment.yaml#L9-L14). Gateway analogicznie — [gateway-deployment.yaml:9-14](../k8s/base/gateway-deployment.yaml#L9-L14).

### Baza danych i trwałość (12%)
**Wymaganie:** baza jako StatefulSet z PersistentVolumeClaim.
**Realizacja:** Postgres i MongoDB to StatefulSet-y z `volumeClaimTemplates` (PVC 1Gi, RWO) — [postgres-statefulset.yaml:73-81](../k8s/base/postgres-statefulset.yaml#L73-L81), [mongodb-statefulset.yaml:68-75](../k8s/base/mongodb-statefulset.yaml#L68-L75).

### Services, Ingress i izolacja (10%)
**Wymaganie:** komunikacja wewnętrzna przez Service; ruch zewnętrzny przez Ingress; bazy/cache/worker nie wystawione na zewnątrz.
**Realizacja:** ruch zewnętrzny wchodzi tylko przez Ingress → `api-gateway` — [ingress.yaml:11-22](../k8s/base/ingress.yaml#L11-L22). Bazy używają headless Service `clusterIP: None` (brak ekspozycji poza klaster) — [postgres-service.yaml:11](../k8s/base/postgres-service.yaml#L11). Izolacja dodatkowo wymuszona NetworkPolicy — [networkpolicy.yaml](../k8s/base/networkpolicy.yaml).

### ConfigMap i Secret (8%)
**Wymaganie:** dane niepoufne w ConfigMap, poufne w Secret; brak prawdziwych haseł w kodzie/README.
**Realizacja:** konfiguracja niepoufna (porty, NODE_ENV, REDIS_URL) w [configmap-app.yaml:8-19](../k8s/base/configmap-app.yaml#L8-L19); hasła i URL-e z hasłem w Secret jako placeholdery developerskie z instrukcją nadpisania w prod — [secret.yaml:8-20](../k8s/base/secret.yaml#L8-L20). Kontenery czytają je przez `configMapKeyRef`/`secretKeyRef` — np. [pg-service-deployment.yaml:53-78](../k8s/base/pg-service-deployment.yaml#L53-L78).

### Probes i zasoby (10%)
**Wymaganie:** główne kontenery mają readinessProbe, livenessProbe oraz resources.requests i resources.limits.
**Realizacja:** np. pg-service ma sondy HTTP `/health` i resources — [pg-service-deployment.yaml:79-101](../k8s/base/pg-service-deployment.yaml#L79-L101); mongo-service — [mongo-service-deployment.yaml:67-89](../k8s/base/mongo-service-deployment.yaml#L67-L89); bazy mają sondy `exec` (`pg_isready` / `mongosh ping`) — [postgres-statefulset.yaml:49-69](../k8s/base/postgres-statefulset.yaml#L49-L69), [mongodb-statefulset.yaml:38-64](../k8s/base/mongodb-statefulset.yaml#L38-L64).

### SecurityContext oraz initContainer/Job (8%)
**Wymaganie:** kontenery aplikacyjne jako non-root z securityContext; użycie initContainer lub Job (migracje/inicjalizacja/oczekiwanie na zależności).
**Realizacja:** `runAsNonRoot`, `runAsUser/Group`, `allowPrivilegeEscalation: false`, `drop: ["ALL"]` — [pg-service-deployment.yaml:27-30](../k8s/base/pg-service-deployment.yaml#L27-L30) i [:102-105](../k8s/base/pg-service-deployment.yaml#L102-L105). initContainer `wait-for-postgres`/`wait-for-redis` czeka na zależności — [pg-service-deployment.yaml:31-46](../k8s/base/pg-service-deployment.yaml#L31-L46). Job migracji bazy — [job-migrate.yaml:46-55](../k8s/base/job-migrate.yaml#L46-L55), Job seedu Mongo — [job-mongo-seed.yaml:42](../k8s/base/job-mongo-seed.yaml#L42).

### CI/CD GitHub Actions (10%)
**Wymaganie:** workflow buduje obraz, uruchamia testy/walidację, publikuje obraz do rejestru, deployuje przez kubectl/Helm/Kustomize, sprawdza rollout.
**Realizacja:**
- Testy + walidacja Dockerfile (CI) — [.github/workflows/ci.yml](../.github/workflows/ci.yml) (joby pg-service, mongo-service, docker-build, e2e).
- Build + push do GHCR — [cd-k8s.yml:54-82](../.github/workflows/cd-k8s.yml#L54-L82).
- Deploy przez Kustomize — [cd-k8s.yml:105-106](../.github/workflows/cd-k8s.yml#L105-L106).
- Sprawdzenie rollout po wdrożeniu — [cd-k8s.yml:120-124](../.github/workflows/cd-k8s.yml#L120-L124).

## Rzeczy dodatkowe (+10%)

### NetworkPolicy (2.5%)
**Wymaganie:** NetworkPolicy ograniczające ruch między podami (baza tylko od backendu/workera).
**Realizacja:** `default-deny-ingress` + reguły otwierające tylko konkretne ścieżki (gateway→serwisy, pg-service→postgres/redis, mongo-service→mongodb) — [networkpolicy.yaml:11-145](../k8s/base/networkpolicy.yaml#L11-L145).

### PodDisruptionBudget (2.5%)
**Wymaganie:** PDB chroniący minimalną dostępność replik backendu.
**Realizacja:** PDB `minAvailable: 1` dla pg-service i mongo-service — [pdb.yaml:4-28](../k8s/base/pdb.yaml#L4-L28).

### Helm albo Kustomize (2.5%)
**Wymaganie:** parametryzacja manifestów i min. dwa środowiska (np. dev i prod).
**Realizacja:** Kustomize base + dwa overlaye: dev (1 replika, obrazy lokalne) — [k8s/overlays/dev/kustomization.yaml](../k8s/overlays/dev/kustomization.yaml); prod (2 repliki, obrazy GHCR, większe limity) — [k8s/overlays/prod/kustomization.yaml](../k8s/overlays/prod/kustomization.yaml).

### Obserwowalność (2.5%)
**Wymaganie:** `/metrics`, adnotacje dla Prometheusa lub inna forma obserwowalności + instrukcja sprawdzenia.
**Realizacja:** endpoint `/metrics` w obu serwisach — [pg-service/src/index.ts:26](../apps/backend/pg-service/src/index.ts#L26), [mongo-service/src/index.ts:21](../apps/backend/mongo-service/src/index.ts#L21); adnotacje `prometheus.io/*` na podach — [pg-service-deployment.yaml:22-25](../k8s/base/pg-service-deployment.yaml#L22-L25), [mongo-service-deployment.yaml:22-25](../k8s/base/mongo-service-deployment.yaml#L22-L25).

## Wymagania specyficzne dla projektu

### Minimalna funkcjonalność aplikacji (10%)
**Wymaganie:** jeden główny zasób biznesowy z dodawaniem, odczytem oraz endpointem `/health` lub `/ready`.
**Realizacja:** zasób „post": `POST /api/posts` (dodanie) i `GET /api/posts` (odczyt) — [pg-service/src/routes/postRoutes.ts:7-8](../apps/backend/pg-service/src/routes/postRoutes.ts#L7-L8); `/health` z kontrolą zależności — [pg-service/src/routes/healthRoutes.ts:7](../apps/backend/pg-service/src/routes/healthRoutes.ts#L7). Smoke-test add/read/health w CI — [cd-k8s.yml:126-150](../.github/workflows/cd-k8s.yml#L126-L150).

### Trwałość danych aplikacji (5%)
**Wymaganie:** dane w bazie w K8s, dostępne po restarcie poda bazy.
**Realizacja:** dane Postgresa/Mongo trzymane na PVC (`volumeClaimTemplates`), więc przeżywają restart poda — [postgres-statefulset.yaml:73-81](../k8s/base/postgres-statefulset.yaml#L73-L81), [mongodb-statefulset.yaml:68-75](../k8s/base/mongodb-statefulset.yaml#L68-L75).

### Cache, kolejka albo worker (5%)
**Wymaganie:** dodatkowy komponent architektury (Redis/RabbitMQ/worker) z dowodem działania.
**Realizacja:** Redis jako cache — Deployment + Service [redis-deployment.yaml](../k8s/base/redis-deployment.yaml), [redis-service.yaml](../k8s/base/redis-service.yaml); używany przez middleware cache w `GET /api/posts` (`cacheGet`) — [pg-service/src/routes/postRoutes.ts:8](../apps/backend/pg-service/src/routes/postRoutes.ts#L8). Dowód: nagłówek `X-Cache` weryfikowany w CI — [cd-k8s.yml:144-145](../.github/workflows/cd-k8s.yml#L144-L145).

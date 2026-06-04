# Zagadnienia na obronę — odpowiedzi w kontekście projektu

> Projekt: **social-api-polyglot** — backend mini-sieci społecznościowej.
> Kod serwisów: [apps/backend/](apps/backend/), manifesty Kubernetes: [k8s/](k8s/).
> Branch `main`. Bazy: **PostgreSQL** + **MongoDB** + **Redis (cache)**.

Ten dokument jest pogrupowany tematycznie. Każda odpowiedź wskazuje konkretny plik/linijkę,
żebyś mógł od razu pokazać to prowadzącemu na ekranie.

---

## SPIS TREŚCI

1. [Architektura całości — co i ile mam](#1-architektura-całości)
2. [Bazy danych: StatefulSet, trwałe dane, PVC](#2-bazy-danych)
3. [Redis — cache](#3-redis)
4. [Ingress, API Gateway, nginx, ruch w aplikacji](#4-ingress-api-gateway-nginx-ruch)
5. [Frontend i jak gada z backendem](#5-frontend)
6. [ConfigMap i Secret](#6-configmap-i-secret)
7. [Probes: readiness / liveness / health / ready](#7-probes)
8. [securityContext i initContainer](#8-securitycontext-i-initcontainer)
9. [GHCR i obrazy](#9-ghcr)
10. [Helm vs Kustomize](#10-helm-vs-kustomize)
11. [Workflowy (CI/CD)](#11-workflowy)
12. [Pytania praktyczne kubectl (ściąga komend)](#12-pytania-praktyczne-kubectl)

---

## 0. Przygotowanie środowiska do demo (zrób PRZED obroną)

Masz **dwie ścieżki** prezentacji — wybierz w zależności od tego, czego prowadzący chce słuchać.
Bloki **▶️ Demo** w dalszej części opisuję dla wariantu **Kubernetes** (główny temat obrony),
ale przy wielu z nich podaję też szybszy odpowiednik na `docker compose`.

### Wariant A — Docker Compose (najszybszy, „na pewno działa")
```bash
cd apps/backend
docker compose up -d --build          # cały stack; migracje + seedy idą przed startem aplikacji
docker compose ps                     # sprawdź, że wszystko healthy
curl -s http://localhost:8080/health  # gateway żyje
# narzędzia (opcjonalnie): adminer :8081, mongo-express :8082
docker compose --profile tools up -d
```

### Wariant B — Kubernetes na kind (to, o co realnie pytają)
```bash
# 0) jednorazowo: kind + kubectl zainstalowane
kind create cluster --name social

# 1) zbuduj obrazy lokalnie i wgraj do kind (deploy używa tagu :dev)
docker build -t pg-service:dev    apps/backend/pg-service
docker build -t mongo-service:dev apps/backend/mongo-service
kind load docker-image pg-service:dev mongo-service:dev --name social

# 2) wdróż overlay dev (namespace social-dev, po 1 replice)
kubectl apply -k k8s/overlays/dev

# 3) poczekaj aż wszystko wstanie
kubectl -n social-dev rollout status deployment/pg-service
kubectl -n social-dev rollout status deployment/mongo-service
kubectl -n social-dev rollout status deployment/api-gateway

# 4) udostępnij gateway na localhost (Ingress nie jest wymagany do demo)
kubectl -n social-dev port-forward svc/api-gateway 8080:80
#   → w drugim terminalu: curl http://localhost:8080/health
```

> **Złota zasada na demo:** miej **dwa terminale** — w jednym `port-forward` (zostaw go działającego),
> w drugim odpalaj `curl` i `kubectl`. I miej otwarte pliki YAML w edytorze, żeby pokazać kod obok komendy.

---

## 1. Architektura całości

**Ile mam „podów backendu" i co to za serwisy?**

Backend to **dwa mikroserwisy Node/TypeScript**, każdy z własną bazą (polyglot persistence):

| Serwis | Port | Baza | Odpowiada za |
|---|---|---|---|
| **pg-service** | 3001 | PostgreSQL (+Redis) | użytkownicy, posty, reakcje, komentarze, follow, tagi, powiadomienia |
| **mongo-service** | 3002 | MongoDB | feed (kursor), rich-posty, analityka (agregacje) |

W bazowym manifeście każdy serwis ma `replicas: 2` → [k8s/base/pg-service-deployment.yaml:9](k8s/base/pg-service-deployment.yaml#L9) i [k8s/base/mongo-service-deployment.yaml](k8s/base/mongo-service-deployment.yaml). Plus **api-gateway** (nginx, też 2 repliki).

**Pełna lista podów na klastrze (overlay `prod` / base):**
- `pg-service` ×2, `mongo-service` ×2, `api-gateway` ×2
- `postgres` ×1 (StatefulSet), `mongodb` ×1 (StatefulSet), `redis` ×1 (Deployment)
- dorywczo: Joby `pg-migrate` i `mongo-seed` (kończą się i znikają)

> Uwaga: overlay **dev** ([k8s/overlays/dev/kustomization.yaml](k8s/overlays/dev/kustomization.yaml)) zbija backend i gateway do **1 repliki** (oszczędność na kind/minikube). Overlay **prod** zostawia 2 repliki + większe limity.

**Dlaczego dwa serwisy?** Podział po silniku bazodanowym — PG trzyma kanoniczne rekordy i graf
relacji (spójność transakcyjna), Mongo trzyma zdenormalizowany, szybki do odczytu feed i agregacje.
Komunikują się po HTTP wewnątrz klastra (patrz niżej, pkt 4).

> **▶️ Demo — pokaż całą architekturę jednym poleceniem:**
> ```bash
> kubectl -n social-dev get all          # Deploymenty, StatefulSety, Pody, Service'y naraz
> kubectl -n social-dev get pods -o wide # IP + węzeł każdego poda
> ```
> Oczekiwany obraz: pody `pg-service-…`, `mongo-service-…`, `api-gateway-…` w stanie **Running 1/1**,
> StatefulSety `postgres-0`, `mongodb-0`, Deployment `redis`, oraz zakończone Joby `pg-migrate`/`mongo-seed` (Completed).
> Powiedz przy tym: *„dwa serwisy backendu, każdy z własną bazą, gateway przed nimi"*.

---

## 2. Bazy danych

### Dlaczego Postgres (i Mongo) jako **StatefulSet**, a nie Deployment?

Bo to są **komponenty stanowe** (trzymają dane na dysku). StatefulSet daje trzy rzeczy, których
Deployment nie gwarantuje:

1. **Stabilna tożsamość sieciowa** — pod nazywa się zawsze `postgres-0` i ma stały adres DNS
   `postgres-0.postgres`. (Deployment generuje losowe sufiksy, np. `pg-service-7d9f…`.)
2. **Stabilny, przypisany do poda storage** — przez `volumeClaimTemplates` każdy pod dostaje
   **swój własny PVC**, który po restarcie poda zostaje ten sam → dane przeżywają.
3. **Uporządkowany start/stop** (0,1,2…) — istotne dla replikacji baz.

Pokaż: [k8s/base/postgres-statefulset.yaml](k8s/base/postgres-statefulset.yaml) — `kind: StatefulSet`, `serviceName: postgres`, na końcu sekcja `volumeClaimTemplates`.

### Czego używam, żeby mieć wolumen i trwałe dane (oprócz samego StatefulSetu)?

**`volumeClaimTemplates`** — to jest mechanizm trwałości:

```yaml
volumeClaimTemplates:
  - metadata: { name: pgdata }
    spec:
      accessModes: ["ReadWriteOnce"]
      resources: { requests: { storage: 1Gi } }
```
([k8s/base/postgres-statefulset.yaml](k8s/base/postgres-statefulset.yaml), analogicznie [mongodb-statefulset.yaml](k8s/base/mongodb-statefulset.yaml))

Z tego szablonu Kubernetes tworzy **PVC (PersistentVolumeClaim)**, który bindzie się do
**PV (PersistentVolume)** dostarczonego przez StorageClass klastra. Wolumen jest montowany pod
`/var/lib/postgresql/data` (`volumeMounts`). Dzięki temu `kubectl delete pod postgres-0` **nie**
kasuje danych — nowy pod podłącza ten sam PVC.

> **Analogia do Dockera:** w [apps/backend/docker-compose.yml](apps/backend/docker-compose.yml) ten sam efekt dają **named volumes** `pgdata`, `mongodata`, `redisdata` (`docker compose down` zostawia dane, `down -v` je kasuje).

> **Wyjątek — Redis:** używa `emptyDir: {}` (NIE PVC), patrz [k8s/base/redis-deployment.yaml](k8s/base/redis-deployment.yaml). To celowe — cache jest **efemeryczny**, nie potrzebuje trwałości. Dlatego Redis jest zwykłym **Deploymentem**, nie StatefulSetem.

> **▶️ Demo — pokaż StatefulSet i PVC:**
> ```bash
> kubectl -n social-dev get statefulset                 # postgres, mongodb
> kubectl -n social-dev get pvc                          # pgdata-postgres-0, mongodata-mongodb-0 (Bound)
> kubectl -n social-dev describe pod postgres-0 | grep -A3 "Mounts"   # montowanie wolumenu
> ```

> **▶️ Demo „TRWAŁOŚĆ DANYCH" (mocny punkt — udowadnia, że dane przeżywają restart):**
> ```bash
> # 1) dodaj rekord
> curl -s -X POST http://localhost:8080/api/posts \
>   -H "Content-Type: application/json" \
>   -d '{"authorId":1,"bodyPreview":"post na obronę #demo"}'
> # 2) skasuj poda bazy — StatefulSet odtworzy postgres-0 z tym samym PVC
> kubectl -n social-dev delete pod postgres-0
> kubectl -n social-dev rollout status statefulset/postgres
> # 3) odczytaj — rekord nadal jest
> curl -s http://localhost:8080/api/posts | grep "demo"
> ```
> **Odpowiednik na Docker Compose** (to samo, prościej): dodaj rekord →
> `docker compose down` (BEZ `-v`) → `docker compose up -d` → odczytaj. Dane są, bo named volume `pgdata` przeżył.
> Pokaż przy tym: `docker volume ls | findstr pgdata`.

---

## 3. Redis

### Do czego używam Redisa?

Do **cache'owania odpowiedzi GET** w pg-service (głównie listy postów), żeby odciążyć Postgresa.

### Gdzie jest połączenie do Redisa (kod)?

[apps/backend/pg-service/src/config/redis.ts](apps/backend/pg-service/src/config/redis.ts) — funkcja `getRedis()`:
- tworzy klienta `createClient({ url: process.env.REDIS_URL, ... })` (URL = `redis://redis:6379`),
- **singleton** — jedno połączenie reużywane (`if (client && client.isOpen) return ...`),
- `connectTimeout: 2000` i `reconnectStrategy` — jak Redis nie odpowiada, żądanie nie wisi,
- `closeRedis()` zamyka połączenie przy graceful shutdown (SIGTERM/SIGINT w [src/index.ts:67-71](apps/backend/pg-service/src/index.ts#L67-L71)).

### Co dokładnie zapisuję do Redisa i gdzie?

Logika cache: [apps/backend/pg-service/src/middlewares/cache.ts](apps/backend/pg-service/src/middlewares/cache.ts)

- **`cacheGet(prefix, ttl)`** — middleware na trasach GET:
  - klucz: `` `${prefix}:${req.originalUrl}` `` (np. `posts:list:/api/posts?authorId=1`),
  - jeśli klucz jest w Redisie → zwraca z cache, nagłówek **`X-Cache: HIT`**,
  - jeśli nie ma → przepuszcza do kontrolera, a odpowiedź JSON (status 2xx) zapisuje przez
    `redis.setEx(key, ttl, JSON.stringify(body))` z **TTL = `CACHE_TTL_SECONDS` (30 s)**,
    nagłówek **`X-Cache: MISS`**,
  - jeśli Redis niedostępny → **`X-Cache: BYPASS`** (aplikacja działa dalej bez cache).
- **`invalidatePrefix(prefix)`** — przy każdym **zapisie** (nowy post, reakcja, usunięcie)
  kasuje pasujące klucze (`SCAN` + `DEL`), żeby nie serwować nieaktualnych danych. Wywoływane
  z [apps/backend/pg-service/src/services/postService.ts](apps/backend/pg-service/src/services/postService.ts) (`invalidatePrefix('posts:list')`).

**Dowód działania na obronie:** `curl -i http://localhost:8080/api/posts` dwa razy — pierwszy raz
`X-Cache: MISS`, drugi `X-Cache: HIT`. (Dokładnie to sprawdza smoke test w [cd-k8s.yml:135-136](.github/workflows/cd-k8s.yml#L135-L136).)

> **▶️ Demo — cache w akcji (nagłówek X-Cache):**
> ```bash
> # PowerShell:
> curl.exe -s -i http://localhost:8080/api/posts | Select-String "X-Cache"   # 1. raz → MISS
> curl.exe -s -i http://localhost:8080/api/posts | Select-String "X-Cache"   # 2. raz → HIT
> # bash/git-bash:
> curl -s -i http://localhost:8080/api/posts | grep -i x-cache               # MISS, potem HIT
> ```
> **Pokaż klucz w Redisie** (że to naprawdę tam ląduje):
> ```bash
> kubectl -n social-dev exec deploy/redis -- redis-cli KEYS 'posts:*'
> # → np. "posts:list:/api/posts"
> ```
> **Pokaż unieważnianie cache:** dodaj post (`POST /api/posts`) → następny `GET` znów daje `MISS`
> (bo `invalidatePrefix('posts:list')` skasował klucz). To dowód, że cache nie serwuje nieaktualnych danych.

---

## 4. Ingress, API Gateway, nginx, ruch

### Jak działa Ingress i co robi?

[k8s/base/ingress.yaml](k8s/base/ingress.yaml) — to **jedyny wjazd ruchu zewnętrznego** do klastra:

```yaml
spec:
  ingressClassName: nginx
  rules:
    - host: social.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: api-gateway, port: { number: 80 } }
```

Czyli: cały ruch na host `social.local`, ścieżka `/`, jest kierowany do **Service `api-gateway`** na port 80. Ingress obsługuje **kontroler ingress-nginx** (osobny komponent klastra) — to on faktycznie nasłuchuje na zewnątrz i realizuje regułę.

### Czy request z Ingressu trafia na **Pod** czy na **Service**? I dlaczego?

**Na Service.** Ingress w `backend:` wskazuje **nazwę Service + port**, nigdy konkretnego poda.

**Dlaczego Service, a nie Pod:**
- Pody są **efemeryczne** — mają zmienne IP, są tworzone/usuwane przy skalowaniu i rolling-update.
- **Service** to stabilny obiekt: stały ClusterIP, stała nazwa DNS, **load balancing** po
  wszystkich podach pasujących do `selector` (po labelach `app: api-gateway`).
- Service automatycznie utrzymuje listę „żywych" endpointów (pody, które przeszły **readinessProbe**).

Czyli łańcuch: **Ingress → Service → (kube-proxy load-balancuje) → Pod**.

### Gdzie mam proxy / API Gateway? Czym jest nginx?

**API Gateway = nginx** jako **reverse proxy**, który routuje po prefiksie ścieżki do właściwego serwisu:
- `/api/users`, `/api/posts`, `/api/stats`, `/api/tags`, `/api/notifications` → **pg-service:3001**
- `/api/feed`, `/api/analytics` → **mongo-service:3002**
- `/health`, `/health/pg`, `/health/mongo` → agregacja stanu

Konfiguracja w k8s jest trzymana w **ConfigMapie** (nie w obrazie): [k8s/base/configmap-nginx.yaml](k8s/base/configmap-nginx.yaml), montowana do poda przez `volumeMounts` jako `/etc/nginx/nginx.conf`. Deployment: [k8s/base/gateway-deployment.yaml](k8s/base/gateway-deployment.yaml).

> **Czym jest nginx (gdyby pytał wprost):** serwer WWW i reverse proxy. U mnie pełni rolę API
> Gateway — jeden punkt wejścia, routing po ścieżce, obsługa CORS/OPTIONS, agregacja health.
> Aplikacja nie wystawia portów na zewnątrz — wszystko idzie przez gateway.

### Czy nginx „przesyła do poda czy do serwisu"?

**Do Service.** W [configmap-nginx.yaml](k8s/base/configmap-nginx.yaml) jest `proxy_pass http://pg_upstream;`, a upstream to `server pg-service:3001;` — czyli **nazwa Service** (ClusterIP). DNS klastra (CoreDNS) rozwiązuje `pg-service` na ClusterIP, a Service rozkłada ruch na pody.

> **Ciekawostka, którą możesz dorzucić:** wersja nginx dla Dockera ([apps/backend/api-gateway/nginx.conf](apps/backend/api-gateway/nginx.conf)) używa dynamicznego resolvera `127.0.0.11` i zmiennych `set $var`, bo IP kontenerów się zmieniają. W Kubernetes nie trzeba — ClusterIP Service'u jest **stały**, więc nginx rozwiązuje nazwę raz przy starcie. Komentarz to wyjaśnia w configmap-nginx.

### „Ten nginx się odpala"?

Tak — `api-gateway` to **Deployment** (2 repliki), obraz `nginxinc/nginx-unprivileged:alpine`,
kontener słucha na **8080** (bo non-root nie może na 80), a Service `api-gateway` wystawia
**port 80** i kieruje na `targetPort: http` (8080). [k8s/base/gateway-service.yaml](k8s/base/gateway-service.yaml).

### Pełen przepływ ruchu (to warto powiedzieć jednym ciągiem):

```
Przeglądarka
  → Ingress (ingress-nginx, host social.local)
  → Service api-gateway:80
  → Pod nginx (gateway, :8080)  — routing po ścieżce /api/...
  → Service pg-service:3001  /  Service mongo-service:3002
  → Pod pg-service / mongo-service
  → Service postgres:5432 / mongodb:27017 / redis:6379
  → Pod bazy danych
```
Dodatkowo **pg-service ↔ mongo-service** gadają bezpośrednio po HTTP (fan-out feedu, analityka) — `http://mongo-service:3002/api/internal/...` ([postService.ts:6](apps/backend/pg-service/src/services/postService.ts#L6)). Cały ten ruch jest ograniczony przez **NetworkPolicy** ([k8s/base/networkpolicy.yaml](k8s/base/networkpolicy.yaml)): domyślnie deny, otwarte tylko konkretne ścieżki (gateway→serwisy, pg→postgres+redis, mongo→mongodb). Bazy nie przyjmują ruchu znikąd poza swoimi konsumentami.

> **▶️ Demo — routing gatewaya (jedno wejście, dwa serwisy):**
> ```bash
> curl -s http://localhost:8080/api/posts   | head -c 200   # /api/posts  → pg-service
> curl -s http://localhost:8080/api/feed/1  | head -c 200   # /api/feed   → mongo-service
> curl -s http://localhost:8080/health                      # agregacja health w gatewayu
> ```
> Powiedz: *„te same `:8080`, ale gateway po prefiksie ścieżki wysłał jedno do pg-service, drugie do mongo-service"*.
>
> **Pokaż obiekt Ingress i dowód, że gateway gada z Service (nie z podem):**
> ```bash
> kubectl -n social-dev get ingress                          # social-ingress, host social.local → api-gateway:80
> kubectl -n social-dev get svc                              # api-gateway, pg-service, mongo-service (ClusterIP)
> kubectl -n social-dev logs -l app=api-gateway --tail=20    # widać przychodzące /api/... w logach nginx
> ```
> **Pokaż izolację (NetworkPolicy)** — z gatewaya da się dojść do pg-service, ale do Postgresa już NIE:
> ```bash
> kubectl -n social-dev exec deploy/api-gateway -- sh -c "nc -zv pg-service 3001"   # OK
> kubectl -n social-dev exec deploy/api-gateway -- sh -c "nc -zv postgres 5432"     # timeout (zablokowane)
> ```

---

## 5. Frontend

### Jak frontend jest zrobiony i jak komunikuje się z backendem?

[apps/backend/frontend/](apps/backend/frontend/) — **statyczny** `index.html` + `src/app.js` + `styles.css`. Czysty JS, bez frameworka. To tylko demo do prezentacji (warstwa kliencka nie jest oceniana).

Komunikacja: przez `fetch()` na **API Base** = `http://localhost:8080/api` (pole konfigurowalne w UI, [index.html](apps/backend/frontend/index.html)). Funkcja `request()` w [app.js:18-29](apps/backend/frontend/src/app.js#L18-L29) robi `fetch(base + path)` z nagłówkiem `Content-Type: application/json`. Czyli frontend uderza w **gateway na :8080**, a gateway routuje dalej.

Przykład: `loadPosts()` → `GET /posts` → gateway → pg-service; przyciski reakcji → `POST /posts/:id/reactions`.

> Frontend **nie jest** deployowany w Kubernetes — w k8s wjazd jest przez Ingress→gateway. Frontend uruchamiasz lokalnie / w compose. Jak pytają „gdzie frontend w k8s" — odpowiedź: świadomie poza klastrem, bo ocena dotyczy backendu i danych.

> **▶️ Demo — pokaż frontend w przeglądarce:**
> ```bash
> # otwórz plik bezpośrednio w przeglądarce (Windows):
> start apps/backend/frontend/index.html
> ```
> W polu **API Base** wpisz `http://localhost:8080/api` (musi działać `port-forward`/compose), kliknij **Refresh** →
> lista postów się załaduje. Dodaj post / kliknij reakcję → pokaż, że request idzie przez gateway do backendu.
> (W zakładce DevTools → Network widać `fetch` na `:8080/api/...`.)

---

## 6. ConfigMap i Secret

### Gdzie są ConfigMapy i Secrety?

- **ConfigMap `app-config`** ([k8s/base/configmap-app.yaml](k8s/base/configmap-app.yaml)) — dane **niepoufne**: `NODE_ENV`, `POSTGRES_USER`, `POSTGRES_DB`, `PGDATA`, porty serwisów, `REDIS_URL`, `CACHE_TTL_SECONDS`.
- **ConfigMap `nginx-config`** ([k8s/base/configmap-nginx.yaml](k8s/base/configmap-nginx.yaml)) — plik `nginx.conf` dla gatewaya.
- **Secret `db-credentials`** ([k8s/base/secret.yaml](k8s/base/secret.yaml), `type: Opaque`) — dane **poufne**: `POSTGRES_PASSWORD`, `DATABASE_URL` (z hasłem), `MONGO_INITDB_ROOT_USERNAME/PASSWORD`, `MONGO_URI`.

> **Zasada podziału:** niepoufne → ConfigMap, hasła i pełne URL-e z hasłem → Secret. Komentarz w configmap-app to mówi.

> W Dockerze ten sam podział to **`.env`** ([apps/backend/.env.example](apps/backend/.env.example)) + **Docker secrets** (pliki `secrets/*.txt` montowane jako `/run/secrets/...`).

### Jak dodać coś do Secretu, żeby backend FAKTYCZNI to przeczytał? (kluczowe pytanie!)

Samo dopisanie klucza do Secretu **nie wystarczy** — pod go nie zobaczy. Trzeba **dwa kroki**:

1. **Dodaj klucz do Secretu** — w [k8s/base/secret.yaml](k8s/base/secret.yaml) w `stringData:` (albo `kubectl create secret ...`).
2. **Zmapuj go na zmienną środowiskową w deploymencie** przez `env` + `valueFrom.secretKeyRef`:

```yaml
env:
  - name: DATABASE_URL                 # nazwa zmiennej w procesie
    valueFrom:
      secretKeyRef:
        name: db-credentials           # nazwa Secretu
        key: DATABASE_URL              # klucz w Secrecie
```

Dopiero to wstrzykuje sekret do **`process.env`** kontenera. Bez tego mapowania aplikacja nie ma do niego dostępu.

> Gdzie to skonfigurować: w pliku deploymentu danego serwisu, sekcja `spec.template.spec.containers[].env`. Po zmianie: `kubectl apply -k ...` i pod startuje z nową zmienną. (Uwaga: zmiana Secretu **nie** restartuje automatycznie podów — trzeba `kubectl rollout restart deployment/...`.)

### Której linijki / sekretów używa już backend?

- **pg-service** — `DATABASE_URL` z Secretu: [k8s/base/pg-service-deployment.yaml](k8s/base/pg-service-deployment.yaml), sekcja `env` (`secretKeyRef: db-credentials / DATABASE_URL`). W kodzie czytane przez `process.env.DATABASE_URL` w [config/prisma.ts](apps/backend/pg-service/src/config/prisma.ts), [config/knex.ts](apps/backend/pg-service/src/config/knex.ts), `config/sequelize.ts`, `config/pgPool.ts`.
- **mongo-service** — `MONGO_URI` z Secretu: [k8s/base/mongo-service-deployment.yaml](k8s/base/mongo-service-deployment.yaml). W kodzie `process.env.MONGO_URI` w [config/](apps/backend/mongo-service/src/config/).
- Niepoufne (`REDIS_URL`, `CACHE_TTL_SECONDS`, `PORT`, `NODE_ENV`) idą z ConfigMapy przez `configMapKeyRef`.

> **▶️ Demo — ConfigMap, Secret i to, że backend faktycznie je czyta:**
> ```bash
> kubectl -n social-dev get configmap app-config -o yaml      # niepoufne (NODE_ENV, REDIS_URL, porty…)
> kubectl -n social-dev get secret db-credentials -o yaml     # poufne — wartości w base64
> # podejrzyj jak Secret jest podłączony w deploymencie:
> kubectl -n social-dev describe deploy/pg-service | grep -A2 DATABASE_URL   # → secretKeyRef
> # DOWÓD, że trafiło do procesu kontenera (env zmapowane z Secretu/ConfigMapy):
> kubectl -n social-dev exec deploy/pg-service -- printenv DATABASE_URL REDIS_URL CACHE_TTL_SECONDS
> ```
> Puenta dla prowadzącego: *„sama wartość w Secrecie nie wystarczy — w deploymencie mapuję ją przez
> `valueFrom.secretKeyRef` na zmienną `env`, dopiero wtedy jest w `process.env` kontenera"* (pkt 6).

---

## 7. Probes

### Czy mam readiness i liveness probe? Do czego ich używamy?

**Tak, oba**, na każdym komponencie:

| Komponent | Typ probe | Mechanizm |
|---|---|---|
| pg-service / mongo-service | readiness + liveness | `httpGet` na `/health` (port http) |
| api-gateway | readiness + liveness | `httpGet` na `/health` |
| postgres | readiness + liveness | `exec: pg_isready` |
| mongodb | readiness + liveness | `exec: mongosh ping` |
| redis | readiness + liveness | `exec: redis-cli ping` |

**Do czego służą (to musisz umieć rozróżnić):**
- **livenessProbe** = „czy kontener **żyje**?". Jak failuje → kubelet **restartuje kontener** (np. gdy proces się zawiesił/deadlock).
- **readinessProbe** = „czy pod jest **gotowy przyjmować ruch**?". Jak failuje → pod jest **wyrzucany z endpointów Service** (przestaje dostawać ruch), ale **nie** jest restartowany. Wraca, gdy znów odpowie 200.

Przykład: [k8s/base/pg-service-deployment.yaml:79-94](k8s/base/pg-service-deployment.yaml#L79-L94) — readiness ma krótszy `initialDelaySeconds` (5 s) niż liveness (20 s), bo najpierw chcemy wiedzieć „czy gotowy", a dopiero potem „czy żywy".

### Czym różni się `/ready` od `/health`?

Konceptualnie:
- **`/health` (liveness)** — „czy proces żyje" — zwykle lekki, byle proces odpowiadał.
- **`/ready` (readiness)** — „czy mogę obsługiwać ruch" — sprawdza **zależności** (DB, cache); jak baza padła, pod nie jest „ready", ale dalej „żywy".

### Jak coś jest `/ready` — skąd to wiem? (i ważne sprostowanie dot. MOJEGO projektu)

**W tym projekcie nie ma osobnej trasy `/ready`** — **oba** probe'y (readiness i liveness) wskazują **`/health`**. Ale moje `/health` **nie jest puste** — robi realny check zależności, więc pełni rolę readiness:

[apps/backend/pg-service/src/routes/healthRoutes.ts](apps/backend/pg-service/src/routes/healthRoutes.ts):
- `prisma.$queryRaw\`SELECT 1\`` → sprawdza Postgresa,
- `redis.ping()` → sprawdza Redisa,
- jeśli **wszystko ok** → `200 {status:"ok", checks:{...}}`; jeśli cokolwiek pada → **`503 {status:"degraded"}`**.

Analogicznie mongo-service ([healthRoutes.ts](apps/backend/mongo-service/src/routes/healthRoutes.ts)): sprawdza `mongoose.connection.readyState === 1` oraz natywny `client.db().admin().ping()`.

Czyli **„skąd wiem, że ready"** = serwis sam odpytuje swoje zależności i zwraca 200/503, a Kubernetes na podstawie tego kodu HTTP decyduje, czy wpuścić ruch.

> Jakby drążył „czemu nie masz osobnego /ready": powiem, że `/health` świadomie robi pełny check zależności (200/503), więc działa jako readiness. Gdyby chcieli rozdzielić: liveness = lekki `200 OK` (tylko „proces żyje"), readiness = obecne `/health` ze sprawdzaniem DB/Redis — to zmiana 2 linijek `path:` w deploymencie + dodanie trasy.

### Czy `/health` to wbudowany endpoint Kubernetesa, czy ja go implementuję?

**Ja go implementuję** — to zwykła trasa Express w [healthRoutes.ts](apps/backend/pg-service/src/routes/healthRoutes.ts), zarejestrowana w [index.ts:36](apps/backend/pg-service/src/index.ts#L36) (`app.use('/health', healthRoutes)`). Kubernetes (kubelet) tylko **wywołuje** tę ścieżkę zgodnie z definicją probe. To **nie** jest magiczny endpoint K8s — sam decyduję co sprawdza i jaki kod zwraca.

> **▶️ Demo — probe'y i co sprawdza `/health`:**
> ```bash
> # 1) definicja probe'ów w deploymencie:
> kubectl -n social-dev describe pod -l app=pg-service | grep -A2 -E "Liveness|Readiness"
> # 2) co realnie zwraca /health (sprawdza Postgres + Redis):
> curl -s http://localhost:8080/health/pg
> #    → {"status":"ok","service":"pg-service","checks":{"postgres":{"ok":true},"redis":{"ok":true}}}
> ```
> **▶️ Demo „readiness w akcji" (efektowne, ale opcjonalne):** wyłącz Postgresa i patrz, jak pod przestaje być Ready:
> ```bash
> kubectl -n social-dev scale statefulset/postgres --replicas=0
> kubectl -n social-dev get pods -l app=pg-service -w     # READY przejdzie 1/1 → 0/1 (503 z /health)
> # przywróć:
> kubectl -n social-dev scale statefulset/postgres --replicas=1
> ```
> Puenta: *„readiness wyrzuca poda z load-balancera Service, gdy baza padła, ale go nie restartuje — to robi liveness"*.

---

## 8. securityContext i initContainer

### Co to `securityContext` i co u mnie robi?

**Hardening kontenera** — ograniczenie uprawnień, żeby zminimalizować skutki włamania. U mnie (np. [pg-service-deployment.yaml:27-30](k8s/base/pg-service-deployment.yaml#L27-L30) i `securityContext` przy kontenerze):

- **`runAsNonRoot: true` + `runAsUser: 1000`** — proces nie działa jako root.
- **`allowPrivilegeEscalation: false`** — proces nie może podnieść uprawnień (np. przez setuid).
- **`capabilities: drop: ["ALL"]`** — zrzuca wszystkie zdolności jądra Linuksa.
- **Redis** dodatkowo `readOnlyRootFilesystem: true` ([redis-deployment.yaml](k8s/base/redis-deployment.yaml)) — system plików tylko do odczytu, zapis tylko do zamontowanego `emptyDir`.
- **StatefulSety baz** mają `fsGroup` (np. `70` dla postgres, `999` dla mongo) — żeby non-root user mógł pisać na PVC.
- **Gateway** działa jako `uid 101` na porcie 8080 (obraz `nginx-unprivileged`), bo non-root nie wejdzie na port < 1024.

### Co to `initContainer` i do czego go mam?

**Kontener, który wykonuje się **przed** głównym kontenerem** i musi zakończyć się sukcesem, zanim ruszy aplikacja.

U mnie initContainer **`wait-for-postgres` / `wait-for-mongo`** (obraz `busybox`, [pg-service-deployment.yaml:31-47](k8s/base/pg-service-deployment.yaml#L31-L47)):

```sh
until nc -z postgres 5432; do sleep 2; done
until nc -z redis 6379; do sleep 2; done
```

Czeka, aż baza/cache **przyjmują połączenia TCP**, zanim wystartuje serwis — żeby aplikacja nie crashowała przy starcie na braku bazy. Joby migracji ([job-migrate.yaml](k8s/base/job-migrate.yaml)) i seedu też mają taki init.

> To uzupełnia `depends_on: service_healthy` znane z docker-compose — w K8s nie ma `depends_on`, więc kolejność wymuszamy initContainerem + probe'ami.

> **▶️ Demo — non-root (securityContext):**
> ```bash
> kubectl -n social-dev exec deploy/pg-service -- id
> #   → uid=1000 gid=1000 ...  (NIE root/uid=0)
> kubectl -n social-dev exec deploy/api-gateway -- id    # uid=101 (nginx-unprivileged)
> ```
> **▶️ Demo — initContainer (że poczekał na bazę):**
> ```bash
> # logi kontenera inicjującego w podzie serwisu:
> kubectl -n social-dev logs -l app=pg-service -c wait-for-postgres
> #   → "Czekam na postgres:5432..." → "Zaleznosci gotowe."
> kubectl -n social-dev get pod -l app=pg-service -o jsonpath='{.items[0].spec.initContainers[*].name}'
> ```

---

## 9. GHCR

**GHCR = GitHub Container Registry** — rejestr obrazów Docker zintegrowany z GitHubem
(`ghcr.io/<owner>/<obraz>:<tag>`). To miejsce, gdzie publikuję zbudowane obrazy, żeby klaster mógł je pobrać.

W moim CD ([.github/workflows/cd-k8s.yml](.github/workflows/cd-k8s.yml)):
1. `docker/login-action` loguje się do `ghcr.io` tokenem `GITHUB_TOKEN`,
2. obrazy budowane z **dwoma tagami**: lokalny `:dev` (do `kind load`) oraz `ghcr.io/<owner>/pg-service:<SHA>`,
3. `docker push` publikuje wersję otagowaną **SHA commita** → spełnia wymóg „tagowanie/publikacja obrazów wersją lub SHA".

Overlay **prod** ([k8s/overlays/prod/kustomization.yaml](k8s/overlays/prod/kustomization.yaml)) pobiera obrazy właśnie z GHCR (`newName: ghcr.io/OWNER/...`).

> **▶️ Demo — GHCR:** pokaż w przeglądarce zakładkę **Packages** repozytorium na GitHubie
> (obrazy `pg-service` / `mongo-service` z tagami = SHA commitów), albo:
> ```bash
> docker pull ghcr.io/<owner>/pg-service:<sha>     # po `docker login ghcr.io`
> ```
> oraz krok publikacji w pipeline: [cd-k8s.yml:79-82](.github/workflows/cd-k8s.yml#L79-L82) (`docker push ...`).

---

## 10. Helm vs Kustomize

### Co robi Helm i jakie są jego benefity?

**Helm** = menedżer pakietów dla Kubernetesa („apt/npm dla K8s"). Pakuje manifesty w **chart** z szablonami (`templates/` + `values.yaml`).

**Benefity Helma:**
- **Templating / parametryzacja** — jeden chart, różne `values.yaml` na środowisko (dev/prod), zmienne, pętle, warunki.
- **Release management** — instalacja jako nazwany „release" (`helm install`), z historią wersji.
- **Łatwy rollback** — `helm rollback <release> <rewizja>`.
- **Reużywalność i dystrybucja** — gotowe charty z repozytoriów (np. bitnami/postgresql).
- **Zarządzanie zależnościami** (subcharts).

### Czy używam Helma? (ważne — żeby nie skłamać)

**Nie. W tym projekcie używam Kustomize**, nie Helma.

Struktura: **base + overlays** ([k8s/base/kustomization.yaml](k8s/base/kustomization.yaml), [k8s/overlays/dev](k8s/overlays/dev/kustomization.yaml), [k8s/overlays/prod](k8s/overlays/prod/kustomization.yaml)).

**Kustomize vs Helm (jak porówna):**
- Kustomize **nie szablonuje** — nakłada **patche/overlaye** na bazowe manifesty (czysto deklaratywne, bez języka szablonów).
- Jest **wbudowany w kubectl** (`kubectl apply -k`), nie trzeba instalować nic ekstra.
- U mnie overlay **dev** zmienia repliki na 1 i tag obrazu na `dev`; overlay **prod** daje 2 repliki, obrazy z GHCR i patche większych limitów CPU/RAM.

> Krótka puenta na obronę: „Wybrałem Kustomize, bo dla tej skali wystarczą overlaye dev/prod bez narzutu szablonów Helma, i jest natywnie w kubectl. Helm dałby przewagę przy większej parametryzacji i wersjonowaniu release z rollbackiem."

> **▶️ Demo — Kustomize generuje różne manifesty z tej samej bazy:**
> ```bash
> kubectl kustomize k8s/overlays/dev  | findstr "replicas: namespace: newTag"   # 1 replika, social-dev, :dev
> kubectl kustomize k8s/overlays/prod | findstr "replicas: namespace: newTag"   # 2 repliki, social, GHCR
> ```
> Pokaż, że **nie duplikuję manifestów** — base jest jedna, a overlaye tylko nakładają różnice
> ([base](k8s/base/kustomization.yaml) vs [dev](k8s/overlays/dev/kustomization.yaml) vs [prod](k8s/overlays/prod/kustomization.yaml)).

---

## 11. Workflowy

### Czy mam jakieś workflowy? Jakie?

Tak, w [.github/workflows/](.github/workflows/):

**1. CI — [ci.yml](.github/workflows/ci.yml)** (na PR i push do `main`):
- **Detekcja zmian** (`paths-filter`) — testuje tylko zmienione serwisy.
- **pg-service** — `npm ci` → `prisma generate` → typecheck (`npm run build`) → migracje (Prisma + Knex) na **realnym Postgresie** (service container) → testy **unit** + **integration**.
- **mongo-service** — typecheck + testy `node:test`.
- **docker-build** — buduje oba obrazy (walidacja Dockerfile, multi-stage).
- **E2E** — pełny `docker compose up --build` + **newman** odpalający [postman_collection.json](postman_collection.json) przez gateway.
- **`CI passed`** — bramka końcowa (required check do merge).

**2. CD (Kubernetes) — [cd-k8s.yml](.github/workflows/cd-k8s.yml)** (push do `main`):
- build obu obrazów → **push do GHCR** (tag = SHA) → utworzenie efemerycznego klastra **kind** → `kind load` obrazów → **`kubectl apply -k k8s/overlays/dev`** → czeka na rollout StatefulSetów, Jobów (migracje/seed) i Deploymentów → **smoke test** (`/health`, `POST /api/posts`, `GET /api/posts` z `X-Cache`, `GET /api/feed/1`) → przy błędzie zrzuca logi.

**3. Security — [security.yml](.github/workflows/security.yml)**.

Dodatkowo jest **[.gitlab-ci.yml](.gitlab-ci.yml)** (projekt powstał pierwotnie na GitLabie).

> **▶️ Demo — workflowy:** otwórz zakładkę **Actions** na GitHubie i pokaż zielone runy **CI** i **CD (Kubernetes)**,
> wejdź w ostatni CD i pokaż kroki *push do GHCR → kind → apply -k → rollout → smoke test*. Z terminala:
> ```bash
> gh run list --limit 5
> gh run view --log                 # log ostatniego runu
> ```

---

## 12. Pytania praktyczne kubectl

> Namespace zależy od overlaya: **dev → `social-dev`**, **prod/base → `social`**. Poniżej używam `-n social-dev` (tak deployuje CD). Podmień jeśli trzeba.

### Jak działa ruch w aplikacji?
Patrz pkt 4 (diagram). Krótko: **Ingress → Service api-gateway → pod nginx → Service pg/mongo → pod serwisu → Service bazy → pod bazy**. nginx routuje po prefiksie ścieżki, NetworkPolicy ogranicza dozwolone połączenia.

### Jak wyświetlić opis deploymentu i logi poda?
```bash
kubectl -n social-dev describe deployment pg-service      # opis deploymentu (zdarzenia, strategia, repliki)
kubectl -n social-dev get pods                            # nazwy podów
kubectl -n social-dev logs <nazwa-poda>                   # logi konkretnego poda
kubectl -n social-dev logs -l app=pg-service --tail=100   # logi po labelu (wszystkie repliki)
kubectl -n social-dev logs -f -l app=pg-service           # na żywo (-f = follow)
```

### Jak zwiększyć ilość CPU dla deploymentu?
**Deklaratywnie (zalecane):** zmień `resources.limits.cpu` (i `requests`) w [k8s/base/pg-service-deployment.yaml](k8s/base/pg-service-deployment.yaml) (albo w patchu overlaya prod, gdzie już to robię), potem:
```bash
kubectl apply -k k8s/overlays/dev
```
**Szybko/ad-hoc:**
```bash
kubectl -n social-dev edit deployment pg-service          # otwiera YAML w edytorze
# albo:
kubectl -n social-dev set resources deployment pg-service --limits=cpu=1 --requests=cpu=200m
```
Każda zmiana template'u podu wyzwala **RollingUpdate**.

### Jak zaktualizować endpoint `/health`?
Dwa znaczenia:
- **Zmiana logiki `/health`** (co sprawdza): edytuję [apps/backend/pg-service/src/routes/healthRoutes.ts](apps/backend/pg-service/src/routes/healthRoutes.ts) → przebudowa obrazu → push/`kind load` → bump tagu → `kubectl apply -k ...` (lub `kubectl rollout restart deployment/pg-service`).
- **Zmiana ścieżki, którą sprawdza probe**: edytuję `readinessProbe.httpGet.path` / `livenessProbe...` w deploymencie → `kubectl apply -k ...`.

### Jak wyświetlić listę podów?
```bash
kubectl -n social-dev get pods
kubectl -n social-dev get pods -o wide        # + IP i węzeł
kubectl get pods -A                           # wszystkie namespace'y
```

### Jak wdrożyć nową wersję aplikacji (kubectl apply)?
```bash
# 1) zbuduj nowy obraz z nowym tagiem (np. SHA)
# 2) ustaw tag w kustomize:
cd k8s/overlays/dev && kustomize edit set image pg-service=pg-service:v2
# 3) wdróż:
kubectl apply -k k8s/overlays/dev
# 4) obserwuj rollout:
kubectl -n social-dev rollout status deployment/pg-service
# ewentualny cofnij:
kubectl -n social-dev rollout undo deployment/pg-service
```
Strategia to **RollingUpdate** (`maxSurge: 1, maxUnavailable: 0` → zero downtime), chroniona przez **PDB** ([k8s/base/pdb.yaml](k8s/base/pdb.yaml), `minAvailable: 1`).

### Jak wyświetlić logi jakiegoś backendu?
```bash
kubectl -n social-dev logs -l app=mongo-service --tail=100 -f
kubectl -n social-dev logs job/pg-migrate           # logi Joba migracji
```

### Jakbym chciała zmienić port w Ingressie — jak?
W [k8s/base/ingress.yaml](k8s/base/ingress.yaml) zmieniam `backend.service.port.number` (teraz `80` — to port **Service** `api-gateway`). Po zmianie `kubectl apply -k ...`. Uwaga: to musi się zgadzać z portem zdefiniowanym w [gateway-service.yaml](k8s/base/gateway-service.yaml).

### Jak wyświetlić opis backendu przez describe?
```bash
kubectl -n social-dev describe deployment pg-service     # opis deploymentu
kubectl -n social-dev describe pod <nazwa-poda>          # opis poda (zdarzenia, probe'y, mounty)
```
`describe` pokazuje m.in. zdarzenia (Events) — pierwsze miejsce do debugowania, czemu pod nie wstaje.

### Gdzie są otagowane pody? (labels)
W `spec.template.metadata.labels` w deploymentach/statefulsetach — np. `app: pg-service` ([pg-service-deployment.yaml](k8s/base/pg-service-deployment.yaml)). Te **labele** są kluczowe: po nich działa **`selector` Service'u**, **NetworkPolicy** (`podSelector`), **PDB** i filtrowanie `kubectl get pods -l app=pg-service`. Dodatkowo są **annotacje** Prometheusa (`prometheus.io/scrape`, `port`, `path`).
```bash
kubectl -n social-dev get pods --show-labels
```

### Czy nginx przesyła do poda czy do serwisu?
**Do Service** (`proxy_pass http://pg-service:3001` → nazwa Service → ClusterIP → load balancing do podów). Patrz pkt 4.

### Czym jest nginx?
Serwer WWW / reverse proxy; u mnie pełni rolę **API Gateway** — jedyny punkt wejścia, routing po ścieżce do pg-/mongo-service, CORS, agregacja health. Patrz pkt 4.

### Jak zmienić port?
Zależy **który** — port przewija się przez kilka warstw, trzeba zmienić spójnie:
1. **Aplikacja** — `PORT` (z ConfigMapy `app-config`, np. `PG_SERVICE_PORT: 3001`), [configmap-app.yaml](k8s/base/configmap-app.yaml).
2. **Kontener** — `containerPort` w deploymencie.
3. **Service** — `port` i `targetPort` w [pg-service-service.yaml](k8s/base/pg-service-service.yaml).
4. **Gateway** — `upstream ... server pg-service:3001` w [configmap-nginx.yaml](k8s/base/configmap-nginx.yaml).
5. **Probe'y** — jeśli używają numeru portu (u mnie używają nazwanego `port: http`, więc zmiana numeru ich nie psuje).

Po zmianach: `kubectl apply -k ...`. Pointa na obronę: „port jest w kilku miejscach, bo każda warstwa (proces → kontener → Service → gateway) ma własną definicję; używam **nazwanych portów** (`name: http`), żeby ograniczyć liczbę miejsc do zmiany".

---

## Szybka ściąga „pokaż na ekranie"

| Chcą zobaczyć | Plik |
|---|---|
| Deployment + probe'y + initContainer + securityContext | [k8s/base/pg-service-deployment.yaml](k8s/base/pg-service-deployment.yaml) |
| StatefulSet + volumeClaimTemplates (trwałość) | [k8s/base/postgres-statefulset.yaml](k8s/base/postgres-statefulset.yaml) |
| API Gateway / nginx routing | [k8s/base/configmap-nginx.yaml](k8s/base/configmap-nginx.yaml) |
| Ingress | [k8s/base/ingress.yaml](k8s/base/ingress.yaml) |
| ConfigMap (niepoufne) | [k8s/base/configmap-app.yaml](k8s/base/configmap-app.yaml) |
| Secret (poufne) | [k8s/base/secret.yaml](k8s/base/secret.yaml) |
| NetworkPolicy (izolacja) | [k8s/base/networkpolicy.yaml](k8s/base/networkpolicy.yaml) |
| Job migracji/seedów | [k8s/base/job-migrate.yaml](k8s/base/job-migrate.yaml) |
| Kustomize base / overlays | [k8s/base/kustomization.yaml](k8s/base/kustomization.yaml) · [dev](k8s/overlays/dev/kustomization.yaml) · [prod](k8s/overlays/prod/kustomization.yaml) |
| Endpoint /health (implementacja) | [apps/backend/pg-service/src/routes/healthRoutes.ts](apps/backend/pg-service/src/routes/healthRoutes.ts) |
| Połączenie + użycie Redis | [config/redis.ts](apps/backend/pg-service/src/config/redis.ts) · [middlewares/cache.ts](apps/backend/pg-service/src/middlewares/cache.ts) |
| CI / CD | [ci.yml](.github/workflows/ci.yml) · [cd-k8s.yml](.github/workflows/cd-k8s.yml) |

---

## Scenariusz prezentacji „od zera do demo" (gotowa ścieżka ~5 min)

Odpal to po kolei — pokrywa większość pytań bez szukania.

```bash
# --- przygotowanie (zrób przed wejściem, żeby nie czekać) ---
kind create cluster --name social
docker build -t pg-service:dev    apps/backend/pg-service
docker build -t mongo-service:dev apps/backend/mongo-service
kind load docker-image pg-service:dev mongo-service:dev --name social
kubectl apply -k k8s/overlays/dev
kubectl -n social-dev rollout status deployment/pg-service
kubectl -n social-dev rollout status deployment/mongo-service
kubectl -n social-dev rollout status deployment/api-gateway
kubectl -n social-dev port-forward svc/api-gateway 8080:80   # zostaw w osobnym terminalu

# --- 1. architektura (pkt 1) ---
kubectl -n social-dev get all

# --- 2. ruch przez gateway do dwóch serwisów (pkt 4) ---
curl -s http://localhost:8080/api/posts  | head -c 150
curl -s http://localhost:8080/api/feed/1 | head -c 150

# --- 3. cache Redis: MISS → HIT (pkt 3) ---
curl -s -i http://localhost:8080/api/posts | grep -i x-cache
curl -s -i http://localhost:8080/api/posts | grep -i x-cache

# --- 4. trwałość danych: dodaj → ubij poda bazy → odczytaj (pkt 2) ---
curl -s -X POST http://localhost:8080/api/posts -H "Content-Type: application/json" -d '{"authorId":1,"bodyPreview":"obrona #demo"}'
kubectl -n social-dev delete pod postgres-0
kubectl -n social-dev rollout status statefulset/postgres
curl -s http://localhost:8080/api/posts | grep demo

# --- 5. konfiguracja: Secret zmapowany do procesu (pkt 6) ---
kubectl -n social-dev exec deploy/pg-service -- printenv DATABASE_URL

# --- 6. bezpieczeństwo: non-root + health (pkt 7-8) ---
kubectl -n social-dev exec deploy/pg-service -- id
curl -s http://localhost:8080/health/pg

# --- 7. (jeśli zapyta) deploy nowej wersji / rollback ---
kubectl -n social-dev rollout restart deployment/pg-service
kubectl -n social-dev rollout status  deployment/pg-service
kubectl -n social-dev rollout undo    deployment/pg-service
```

> **Plan B, gdyby kind nie wstał:** cały punkt 2–6 zrobisz identycznie na `docker compose` —
> `cd apps/backend && docker compose up -d --build`, a komendy `curl` są te same (gateway na `:8080`).
> Trwałość pokażesz przez `docker compose down` (bez `-v`) i `up -d`.

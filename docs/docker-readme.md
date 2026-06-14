# Docker / Docker Compose — architektura i weryfikacja

Aplikacja wieloserwisowa uruchamiana jednym poleceniem `docker compose up`. Nacisk na
architekturę uruchomieniową: obrazy multi-stage, sieci, wolumeny, sekrety, healthchecki,
reverse proxy. Projekt da się sprawdzić w ~20 minut wg komend poniżej.

## 1. Architektura

```
                                  HOST
                                    │  :8080 (jedyny port wystawiony na hosta)
                       ┌────────────▼────────────┐
                       │     api-gateway (nginx) │  sieć: edge + internal
                       └─┬────────────────────┬──┘
              /api/posts │     /api/feed       │ /health/*
              /api/users │     /api/analytics  │
              /api/stats │                     │
              /api/tags  │                     │
              /api/notifications               │
        ┌────────────────▼──────┐   ┌──────────▼──────────┐
        │      pg-service       │   │     mongo-service   │   sieć: internal (internal: true)
        │  multi-stage, USER node│   │ multi-stage, USER node│  BEZ mapowania portów na host
        └─┬─────────┬───────────┘   └──────────┬──────────┘
          │         │ cache                     │
   ┌──────▼──┐ ┌────▼──┐               ┌────────▼─────┐
   │postgres │ │ redis │               │   mongodb    │
   │ pgdata  │ │redisd.│               │  mongodata   │
   └─────────┘ └───────┘               └──────────────┘
        secrets: postgres_password, mongo_password
```

- **Sieci:** `edge` (bridge) — tylko `api-gateway`, mapuje `8080` na hosta;
  `internal` (`internal: true`) — pozostałe usługi, bez dostępu do internetu.
- **Wolumeny (named):** `pgdata`, `mongodata`, `redisdata`. **Bind mount:** `nginx.conf:ro`.
- **Sekrety (Compose secrets):** `postgres_password`, `mongo_password` — wstrzykiwane jako pliki, nie zmienne env.

> Pełna warstwa OAuth2 (Keycloak, SSR, worker) dokłada usługi `keycloak` (:8090), `keycloak-db`,
> `frontend` (:5173), `ssr-client` (:4000), `analytics-worker` — opis w [oauth2-readme.md](oauth2-readme.md).

## 2. Lista usług i portów

| Usługa | Obraz | Port na hoście | Sieć |
|--------|-------|----------------|------|
| api-gateway | `nginx:alpine` | **8080** | edge + internal |
| pg-service | `project-p-baglaj/pg-service:${APP_VERSION}` | — | internal |
| mongo-service | `project-p-baglaj/mongo-service:${APP_VERSION}` | — | internal |
| postgres | `postgres:15-alpine` | — | internal |
| mongodb | `mongo:6` | — | internal |
| redis | `redis:7-alpine` | — | internal |
| adminer* | `adminer:4` | 8081 | edge + internal |
| mongo-express* | `mongo-express:1` | 8082 | edge + internal |

`*` — tylko pod profilem `tools` (`docker compose --profile tools up -d`).

## 3. Uruchomienie od zera

Wymagania: Docker Engine ≥ 20.10, Docker Compose v2.

```bash
cd apps/backend
cp .env.example .env
cp secrets/postgres_password.txt.example secrets/postgres_password.txt
cp secrets/mongo_password.txt.example    secrets/mongo_password.txt
docker compose up --build -d                  # tryb podstawowy
# albo z narzędziami: docker compose --profile tools up --build -d
```

Compose startuje w kolejności: bazy → migracje/seedy (`prisma migrate deploy → knex migrate:latest
→ prisma db seed → knex seed:run`) → serwisy → gateway. Status:

```bash
docker compose ps
docker compose config --services
docker volume ls | grep -E "pgdata|mongodata|redisdata"
```

Oczekiwane: kontenery z `STATUS = healthy`.

## 4. Komendy testowe (curl)

Bazowy adres: `http://localhost:8080`.

```bash
# Health (przez gateway)
curl -s http://localhost:8080/health/pg
# => {"status":"ok","service":"pg-service","checks":{"postgres":{"ok":true},"redis":{"ok":true}},...}

# Dodanie rekordu (201, JSON z id/authorId/bodyPreview/createdAt/author.username)
curl -s -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"Hello from Docker"}'

# Dowód cache (Redis): 1. raz MISS, 2. raz HIT
curl -i http://localhost:8080/api/posts | grep -i "x-cache"   # X-Cache: MISS
curl -i http://localhost:8080/api/posts | grep -i "x-cache"   # X-Cache: HIT
```

**Trwałość danych po restarcie (bez `-v`!):**
```bash
NEW_ID=$(curl -s -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" -d '{"authorId":1,"bodyPreview":"persistence-test"}' | jq -r .id)
docker compose down && docker compose up -d
curl -s http://localhost:8080/api/posts | jq ".[] | select(.id==$NEW_ID)"   # rekord nadal istnieje
```

**Izolacja sieci — baza niedostępna z hosta:**
```bash
docker compose ps postgres mongodb redis
# kolumna PORTS tylko wewnętrzna (5432/tcp, 27017/tcp, 6379/tcp) — bez 0.0.0.0:/127.0.0.1:
```

**Reverse proxy z dynamicznym DNS:** nginx używa `resolver 127.0.0.11` + zmiennych
`$pg_upstream`/`$mongo_upstream` w `proxy_pass`, więc rebuild backendu nie wymaga restartu gateway:
```bash
docker compose up -d --force-recreate --no-deps pg-service
curl -i http://localhost:8080/api/posts   # nadal 200 OK (DNS odświeżany co 10 s)
```

## 5. Zrealizowane wymagania dodatkowe (+10%)

| Wymaganie | Waga | Dowód |
|-----------|------|-------|
| Limity zasobów (`cpus`, `mem_limit`) | +3% | na wszystkich usługach w `docker-compose.yml` |
| Rotacja logów (json-file, 10m × 3) | +2% | `logging.driver=json-file`, `max-size: 10m`, `max-file: 3` |
| Graceful shutdown (SIGTERM + grace 30s) | +3% | handler SIGTERM w pg-service/mongo-service + `stop_grace_period: 30s` |
| Profile środowisk (`tools`) | +2% | `adminer` + `mongo-express` pod `profiles: [tools]` |

Inne spełnione wymagania bazowe: Compose ≥ 4 usługi, multi-stage Dockerfile z `.dockerignore`
i `USER node` (non-root), osobne sieci edge/internal, named volumes + bind mount `nginx.conf`,
`.env.example` + Compose secrets, healthchecki + `depends_on: service_healthy`, tagowanie obrazów `${APP_VERSION}`.

## 6. Czyszczenie

```bash
docker compose --profile tools down    # zatrzymanie (wolumeny zostają)
docker compose down -v                 # pełne czyszczenie razem z danymi
```

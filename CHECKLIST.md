# CHECKLIST — projekt Docker (aplikacja wieloserwisowa)

Instrukcja umożliwia sprawdzenie projektu w ok. 20 minut.

## 1. Architektura

```
                                  HOST
                                    │
                                    │ :8080 (jedyny port wystawiony na hosta)
                                    │
                       ┌────────────▼────────────┐
                       │     api-gateway (nginx) │  sieć: edge + internal
                       └─┬────────────────────┬──┘
                         │                    │
              /api/posts │     /api/feed      │ /health/*
              /api/users │     /api/analytics │
              /api/stats │                    │
              /api/tags  │                    │
              /api/notifications              │
                         │                    │
        ┌────────────────▼──────┐   ┌────────▼────────────┐
        │      pg-service       │   │     mongo-service   │       sieć: internal (internal: true)
        │   Node 18 (Express)   │   │   Node 22 (Express) │       NO host port mapping
        │  multi-stage, USER node│   │ multi-stage, USER node│
        └─┬─────────┬─────┬─────┘   └─────────┬───────────┘
          │         │     │                   │
          │         │     │ cache             │
          │         │     │                   │
   ┌──────▼──┐ ┌────▼──┐ ┌▼──────┐    ┌───────▼──────┐
   │postgres │ │ redis │ │       │    │   mongodb    │
   │ pgdata  │ │redisd.│ │       │    │   mongodata  │
   │  vol    │ │  vol  │ │       │    │     vol      │
   └─────────┘ └───────┘ │       │    └──────────────┘
                         │       │
                  secrets: postgres_password, mongo_password
```

Sieci:
- `edge` (bridge) — tylko `api-gateway`, mapuje port `8080` na hosta
- `internal` (bridge, `internal: true`) — wszystkie pozostałe usługi; brak dostępu do internetu

Wolumeny (named): `pgdata`, `mongodata`, `redisdata`. Bind mount: `./api-gateway/nginx.conf:ro`.

Sekrety (Docker Compose secrets): `postgres_password`, `mongo_password` — wstrzykiwane do kontenerów jako pliki, nie zmienne środowiskowe.

## 2. Lista usług i portów

| Usługa         | Obraz                                           | Port na hoście | Sieć              |
|----------------|-------------------------------------------------|----------------|-------------------|
| api-gateway    | `nginx:alpine`                                  | **8080**       | edge + internal   |
| pg-service     | `project-p-baglaj/pg-service:${APP_VERSION}`    | —              | internal          |
| mongo-service  | `project-p-baglaj/mongo-service:${APP_VERSION}` | —              | internal          |
| postgres       | `postgres:15-alpine`                            | —              | internal          |
| mongodb        | `mongo:6`                                       | —              | internal          |
| redis          | `redis:7-alpine`                                | —              | internal          |
| adminer*       | `adminer:4`                                     | 8081           | edge + internal   |
| mongo-express* | `mongo-express:1`                               | 8082           | edge + internal   |

`*` — wyłącznie pod profilem `tools` (`docker compose --profile tools up -d`).

## 3. Uruchomienie od zera

Wymagania: Docker Desktop / Docker Engine ≥ 20.10, Docker Compose v2.

```bash
cd backend
cp .env.example .env                          # uzupełnij wartości jeśli trzeba
docker compose up --build -d                  # podstawowy tryb
# albo z narzędziami developerskimi:
docker compose --profile tools up --build -d
```

Sprawdź status:

```bash
docker compose ps
docker compose config --services
docker volume ls | grep -E "pgdata|mongodata|redisdata"
```

Oczekiwany efekt: 6 kontenerów z `STATUS = healthy` (poza adminer/mongo-express, jeśli włączone).

## 4. Komendy testowe (curl)

Bazowy adres: `http://localhost:8080`.

### 4.1. Health (przez gateway)

```bash
curl -s http://localhost:8080/health
curl -s http://localhost:8080/health/pg
curl -s http://localhost:8080/health/mongo
```

Oczekiwany wynik (pg):
```json
{"status":"ok","service":"pg-service","checks":{"postgres":{"ok":true},"redis":{"ok":true}},"timestamp":"..."}
```

### 4.2. Dodanie rekordu (post)

```bash
curl -s -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"Hello from CHECKLIST"}'
```

Oczekiwany wynik: kod 201, ciało JSON z polami `id`, `authorId`, `bodyPreview`, `createdAt`, `author.username`.

### 4.3. Odczyt listy + dowód działania cache

Pierwsze wywołanie — MISS (zapisuje do Redis):
```bash
curl -i http://localhost:8080/api/posts | grep -i "x-cache"
# X-Cache: MISS
```

Drugie wywołanie — HIT (z Redis):
```bash
curl -i http://localhost:8080/api/posts | grep -i "x-cache"
# X-Cache: HIT
```

### 4.4. Trwałość danych po restarcie (bez `-v`!)

```bash
# 1) Dodaj rekord
NEW_ID=$(curl -s -X POST http://localhost:8080/api/posts \
  -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"persistence-test"}' | jq -r .id)

# 2) Restart środowiska BEZ -v
docker compose down
docker compose up -d

# 3) Odczytaj — rekord nadal istnieje
curl -s http://localhost:8080/api/posts | jq ".[] | select(.id==$NEW_ID)"
```

### 4.5. Izolacja sieci — baza danych nie jest dostępna z hosta

Najbardziej wiarygodne sprawdzenie to brak mapowania w `docker compose ps`:
```bash
docker compose ps postgres mongodb redis
```
Oczekiwany efekt: kolumna `PORTS` zawiera tylko port wewnętrzny (`5432/tcp`, `27017/tcp`, `6379/tcp`) — bez prefiksu `0.0.0.0:` lub `127.0.0.1:`. Tylko `api-gateway` ma `0.0.0.0:8080->80/tcp`.

Uwaga: jeśli na hoście działa lokalny PostgreSQL/MongoDB poza Dockerem, port 5432 / 27017 odpowie — ale to inna instancja niż nasz kontener (inna baza, inne hasło).

### 4.6. Reverse proxy z dynamicznym DNS

Nginx używa `resolver 127.0.0.11` + zmiennych `$pg_upstream`/`$mongo_upstream` w `proxy_pass`, dzięki czemu rebuild backendu (`docker compose up -d --build pg-service`) nie wymaga restartu gateway — DNS jest odświeżany co 10 s. Test:

```bash
docker compose up -d --force-recreate --no-deps pg-service
# IP kontenera może się zmienić, ale:
curl -i http://localhost:8080/api/posts   # nadal 200 OK
```

## 5. Zrealizowane wymagania dodatkowe

| Wymaganie                                | Waga | Dowód                                                                              |
|------------------------------------------|------|------------------------------------------------------------------------------------|
| Limity zasobów (cpus, mem_limit)         | +3%  | `cpus` + `mem_limit` na wszystkich usługach w `docker-compose.yml`                  |
| Rotacja logów (json-file, 10m × 3)       | +2%  | `logging.driver=json-file`, `max-size: 10m`, `max-file: 3`                          |
| Graceful shutdown (SIGTERM + grace 30s)  | +3%  | Handler SIGTERM w `pg-service` i `mongo-service` + `stop_grace_period: 30s`        |
| Profile środowisk (`tools`)              | +2%  | `adminer` + `mongo-express` pod `profiles: [tools]`                                 |

Łącznie: **+10%** wagi dodatkowej.

## 6. Czyszczenie

```bash
docker compose --profile tools down          # zatrzymanie kontenerów (volumes zostają)
docker compose down -v                       # pełne wyczyszczenie razem z danymi
```

# social-api-polyglot

🌐 **Polski** · [English](README.md)

Backend lekkiej sieci społecznościowej: profile, obserwowanie, posty, reakcje, komentarze, feed,
analityka. PostgreSQL utrzymuje graf obserwacji i kanoniczne rekordy postów; MongoDB trzyma
zdenormalizowany feed użytkownika, treści rozszerzone (załączniki, ankiety) oraz dzienne agregaty
aktywności. Całość spięta przez API Gateway (nginx) i uruchamiana jednym poleceniem Docker Compose,
z warstwą bezpieczeństwa OAuth2/OIDC (Keycloak) i wariantem wdrożenia w Kubernetes.

## Architektura

```
                    Klient (przeglądarka / Postman / SPA)
                                   │ :8080
                        ┌──────────▼──────────┐
                        │  API Gateway (nginx)│   routing per prefiks ścieżki
                        └────┬───────────┬────┘
        /api/posts,users,    │           │   /api/feed, /api/analytics
        stats,tags,          │           │
        notifications,admin  ▼           ▼
                   ┌──────────────┐  HTTP  ┌────────────────┐
                   │  pg-service  │ ─────► │  mongo-service │
                   │  (Express)   │ (saga) │  (Express)     │
                   └──────┬───────┘        └───────┬────────┘
                          ▼                        ▼
                     PostgreSQL 15            MongoDB 6
                                   ▲
                          ┌────────┴─────────┐
                          │ Keycloak (OAuth2)│  realm SocialPolyglot, :8090
                          └──────────────────┘
```

- **pg-service** rozmawia wyłącznie z PostgreSQL; **mongo-service** wyłącznie z MongoDB.
  Komunikacja serwis↔serwis idzie po HTTP (`/api/internal/*` na mongo-service, nieeksponowane przez gateway).
- **Cztery narzędzia DB** ćwiczone na osobnych grupach endpointów w `pg-service`:

  | Narzędzie | Endpointy | Singleton |
  |-----------|-----------|-----------|
  | `pg` (sterownik natywny) | `/api/stats/*` | `src/config/pgPool.ts` |
  | Knex (query builder) | `/api/tags/*` | `src/config/knex.ts` |
  | Sequelize v6 | `/api/notifications/*` | `src/config/sequelize.ts` |
  | Prisma (ORM główny) | `/api/posts/*`, `/api/users/*` | `src/config/prisma.ts` |

  Prisma jest właścicielem kanonicznego schematu; migracje Knex dokładają `tags`/`post_tags` na bazie Prismy.

## Layout

```
apps/backend/          korzeń docker-compose — wszystko uruchamiaj stąd
  pg-service/          serwis PostgreSQL (Express, TS, ESM)
  mongo-service/       serwis MongoDB (Express, TS, ESM)
  api-gateway/         reverse proxy nginx (nginx.conf)
  keycloak/            realm-export.json (Authorization Server)
  analytics-worker/    klient M2M OAuth2 (Client Credentials)
  ssr-client/          klient SSR OAuth2 (Authorization Code, confidential)
  secrets/             pliki sekretów docker (hasła dev)
apps/frontend/         SPA React + Vite (klient OAuth2 PKCE — demo)
k8s/                   Kustomize base + overlays dev/prod
docs/                  dokumentacja tematyczna (niżej)
openapi.yaml           specyfikacja API; postman_collection.json napędza E2E (newman)
```

## Uruchomienie

Wymagania: Docker Engine ≥ 20.10, Docker Compose v2. Wszystko startuje z `apps/backend/`
(**nie** ma działającego `npm start` dla serwisów — uruchamia je `command:` w compose).

```bash
cd apps/backend
cp .env.example .env                          # zmienne środowiskowe (m.in. GOOGLE_CLIENT_ID/SECRET)
cp secrets/postgres_password.txt.example secrets/postgres_password.txt   # *.txt są gitignorowane —
cp secrets/mongo_password.txt.example    secrets/mongo_password.txt      # bez nich PG/Mongo nie wstaną
docker compose up -d --build                  # gateway :8080, keycloak :8090, SPA :5173, SSR :4000
docker compose --profile tools up -d          # + adminer :8081, mongo-express :8082
```

Compose startuje: bazy → migracje/seedy → serwisy → gateway. pg-service wykonuje uporządkowany
start (kolejność ma znaczenie — Prisma tworzy schemat bazowy, Knex dokłada tabele tagów na wierzchu):

```
prisma migrate deploy → knex migrate:latest → prisma db seed → knex seed:run → tsx src/index.ts
```

Szybki sanity check:

```bash
curl -s http://localhost:8080/health/pg                              # {"status":"ok",...}
curl -s -X POST http://localhost:8080/api/posts -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"Hello"}'                         # 201
curl -s "http://localhost:8080/api/feed/1?limit=3"                  # feed z mongo-service
```

## Zmienne środowiskowe i sekrety

Konfiguracja w `apps/backend/.env` (wzorzec w `.env.example`); poufne hasła w `secrets/*.txt`
(jeden sekret na plik, bez końcowego newline), wstrzykiwane do kontenerów jako Docker secrets.
Najważniejsze:

| Zmienna | Rola |
|---------|------|
| `POSTGRES_USER/PASSWORD/DB`, `DATABASE_URL` | dostęp do PostgreSQL (Prisma/Knex/Sequelize/pg) |
| `MONGO_INITDB_ROOT_*`, `MONGO_URI` | dostęp do MongoDB |
| `PG_SERVICE_PORT` (3001), `MONGO_SERVICE_PORT` (3002), `API_GATEWAY_PORT` (8080) | porty |
| `REDIS_URL`, `CACHE_TTL_SECONDS` | cache postów (Redis) |
| `KEYCLOAK_JWKS_URI`, `KEYCLOAK_ALLOWED_ISSUERS` | walidacja JWT w Resource Server |
| `GOOGLE_CLIENT_ID/SECRET` | Identity Brokering Google (Faza 4) |

Nowe zmienne dodawaj do `.env.example`; nowe hasła przez pliki `secrets/*.txt`, nie inline.

## Przepływ danych PG ↔ Mongo (zapis rozproszony)

`POST /api/posts` to zapis rozproszony z manualną kompensacją (Saga — brak 2PC między PG a Mongo):

1. pg-service INSERT-uje `Post` (Prisma) i pobiera followersów autora.
2. pg-service woła `POST /api/internal/rich-posts` na mongo-service, które zapisuje `RichPost`,
   robi fan-out po jednym `UserFeedEntry` per follower (`insertMany`) i upsert `ActivityDaily`.
3. **Jeśli Mongo zawiedzie, pg-service DELETE-uje post** (kompensacja) i zwraca 500.
4. Po sukcesie best-effort fan-out powiadomień `new_post` (Sequelize `bulkCreate`) — jego błąd **nie** cofa posta.

Odczyt feedu jest paginowany kursorem (`insertedAt < cursor`, nie OFFSET) po indeksie złożonym
`{ userId, insertedAt }`. Usunięcie posta kaskaduje w PG (FK `onDelete: Cascade`) i fire-and-forget
`DELETE /api/internal/rich-posts/:id` czyści wpisy feedu w Mongo.

**Kontrakt błędów:** każda odpowiedź błędu ma kształt `{ error, code, details }` — nigdy stack trace.
Centralny handler (`src/middlewares/errorHandler.ts`) mapuje SQLSTATE (`23505→409`, `23503→400`, …)
i kody Prismy (`P2002→409`, `P2003→400`) na HTTP.

## Bezpieczeństwo

- **OAuth2/OIDC:** JWT walidowane względem JWKS Keycloaka (`jose`) w `src/middlewares/auth.ts`;
  RBAC przez `requireRole(...)` na `realm_access.roles`. Trzech klientów (SPA/PKCE, SSR/confidential,
  M2M/Client Credentials), least-privilege per klient. Szczegóły → [docs/oauth2-readme.md](docs/oauth2-readme.md).
- **Wejście:** walidacja przed dotknięciem bazy, zapytania wyłącznie parametryzowane (pg `$1/$2`,
  Prisma `$queryRaw` tagged template, Knex builder — nigdy konkatenacja SQL).
- **Hardening:** brak wycieku stack trace, rate limit (429 z nagłówkami `RateLimit-*`), blokada
  self-follow po stronie serwera, jawna obsługa błędów SQL/Mongo.

## Testy

Dwa serwisy używają **różnych runnerów**:

```bash
# pg-service — Jest + ts-jest (ESM); unit mockuje Prisma
cd apps/backend/pg-service
npm test                       # unit (bez bazy)
npm test -- posts.test.ts      # pojedynczy plik
npm run test:integration       # wymaga realnego Postgresa (RUN_INTEGRATION, truncate tabel!)
npm run build                  # tsc (typecheck w CI)

# mongo-service — wbudowany test runner Node (tsx, bez Jest)
cd apps/backend/mongo-service
npm test
npm run build
```

CI (`.github/workflows/ci.yml`) jest filtrowane per serwis, potem pełny `docker compose` + E2E newman
na `postman_collection.json`.

## Dokumentacja

| Plik | Zakres |
|------|--------|
| [docs/databases-readme.md](docs/databases-readme.md) | Bazy danych: cztery narzędzia DB, schematy PG/Mongo, wzorce, wymagania T1–T14 / F1–F5 |
| [docs/docker-readme.md](docs/docker-readme.md) | Docker Compose: architektura, sieci, sekrety, healthchecki, komendy weryfikacyjne |
| [docs/kubernetes-readme.md](docs/kubernetes-readme.md) | Kubernetes + CI/CD: manifesty Kustomize, struktura `k8s/`, deploy, GitHub Actions |
| [docs/oauth2-readme.md](docs/oauth2-readme.md) | OAuth2/OIDC: Keycloak, trzej klienci, RBAC, Google Brokering, scenariusz demo |
| [docs/README_old.md](docs/README_old.md) | Oryginalna treść zadania zaliczeniowego (kryteria oceny) |

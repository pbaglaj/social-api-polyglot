# social-api-polyglot

🌐 **English** · [Polski](README_PL.md)

Backend for a lightweight social network: profiles, follows, posts, reactions, comments, feed,
analytics. PostgreSQL holds the follow graph and the canonical post records; MongoDB stores the
denormalized user feed, rich content (attachments, polls) and daily activity aggregates. Everything
is wired together by an API Gateway (nginx) and launched with a single Docker Compose command, with
an OAuth2/OIDC security layer (Keycloak) and a Kubernetes deployment variant.

## Architecture

```
                    Client (browser / Postman / SPA)
                                   │ :8080
                        ┌──────────▼──────────┐
                        │  API Gateway (nginx)│   routing by path prefix
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

- **pg-service** talks only to PostgreSQL; **mongo-service** only to MongoDB. Service-to-service
  communication goes over HTTP (`/api/internal/*` on mongo-service, not exposed by the gateway).
- **Four DB tools** are each exercised on their own group of endpoints in `pg-service`:

  | Tool | Endpoints | Singleton |
  |------|-----------|-----------|
  | `pg` (native driver) | `/api/stats/*` | `src/config/pgPool.ts` |
  | Knex (query builder) | `/api/tags/*` | `src/config/knex.ts` |
  | Sequelize v6 | `/api/notifications/*` | `src/config/sequelize.ts` |
  | Prisma (primary ORM) | `/api/posts/*`, `/api/users/*` | `src/config/prisma.ts` |

  Prisma owns the canonical schema; Knex migrations add `tags`/`post_tags` on top of Prisma's tables.

## Layout

```
apps/backend/          docker-compose root — run everything from here
  pg-service/          PostgreSQL service (Express, TS, ESM)
  mongo-service/       MongoDB service (Express, TS, ESM)
  api-gateway/         nginx reverse proxy (nginx.conf)
  keycloak/            realm-export.json (Authorization Server)
  analytics-worker/    OAuth2 M2M client (Client Credentials)
  ssr-client/          OAuth2 SSR client (Authorization Code, confidential)
  secrets/             docker secret files (dev passwords)
apps/frontend/         React + Vite SPA (OAuth2 PKCE demo client)
k8s/                   Kustomize base + dev/prod overlays
docs/                  topic documentation (see below)
openapi.yaml           API spec; postman_collection.json drives E2E (newman)
```

## Running

Requirements: Docker Engine ≥ 20.10, Docker Compose v2. Everything runs from `apps/backend/`
(there is **no** working `npm start` for the services — they are launched by the compose `command:`).

```bash
cd apps/backend
cp .env.example .env                          # environment variables (incl. GOOGLE_CLIENT_ID/SECRET)
cp secrets/postgres_password.txt.example secrets/postgres_password.txt   # *.txt are gitignored —
cp secrets/mongo_password.txt.example    secrets/mongo_password.txt      # without them PG/Mongo won't start
docker compose up -d --build                  # gateway :8080, keycloak :8090, SPA :5173, SSR :4000
docker compose --profile tools up -d          # + adminer :8081, mongo-express :8082
```

Compose starts: databases → migrations/seeds → services → gateway. pg-service runs an **ordered**
startup (order matters — Prisma owns the base schema, Knex adds the tag tables on top):

```
prisma migrate deploy → knex migrate:latest → prisma db seed → knex seed:run → tsx src/index.ts
```

Quick sanity check:

```bash
curl -s http://localhost:8080/health/pg                              # {"status":"ok",...}
curl -s -X POST http://localhost:8080/api/posts -H "Content-Type: application/json" \
  -d '{"authorId":1,"bodyPreview":"Hello"}'                         # 201
curl -s "http://localhost:8080/api/feed/1?limit=3"                  # feed from mongo-service
```

## Environment variables and secrets

Config lives in `apps/backend/.env` (template in `.env.example`); sensitive passwords go into
`secrets/*.txt` (one secret per file, no trailing newline), injected into containers as Docker
secrets. The most important ones:

| Variable | Role |
|----------|------|
| `POSTGRES_USER/PASSWORD/DB`, `DATABASE_URL` | PostgreSQL access (Prisma/Knex/Sequelize/pg) |
| `MONGO_INITDB_ROOT_*`, `MONGO_URI` | MongoDB access |
| `PG_SERVICE_PORT` (3001), `MONGO_SERVICE_PORT` (3002), `API_GATEWAY_PORT` (8080) | ports |
| `REDIS_URL`, `CACHE_TTL_SECONDS` | post cache (Redis) |
| `KEYCLOAK_JWKS_URI`, `KEYCLOAK_ALLOWED_ISSUERS` | JWT validation in the Resource Server |
| `GOOGLE_CLIENT_ID/SECRET` | Google Identity Brokering (Phase 4) |

Add new variables to `.env.example`; add new passwords via `secrets/*.txt`, not inline.

## Data flow PG ↔ Mongo (distributed write)

`POST /api/posts` is a distributed write with manual compensation (Saga — there is no 2PC between
PG and Mongo):

1. pg-service INSERTs the `Post` (Prisma) and selects the author's followers.
2. pg-service calls `POST /api/internal/rich-posts` on mongo-service, which writes the `RichPost`,
   fans out one `UserFeedEntry` per follower (`insertMany`) and upserts `ActivityDaily`.
3. **If Mongo fails, pg-service DELETEs the post** (compensation) and returns 500.
4. After success, best-effort fan-out of `new_post` notifications (Sequelize `bulkCreate`) — its
   failure does **not** roll back the post.

Feed reads are cursor-paginated (`insertedAt < cursor`, not OFFSET) over the compound index
`{ userId, insertedAt }`. Post deletion cascades in PG (FK `onDelete: Cascade`) and fire-and-forgets
`DELETE /api/internal/rich-posts/:id` to clean up feed entries in Mongo.

**Error contract:** every error response has the shape `{ error, code, details }` — never a stack
trace. The central handler (`src/middlewares/errorHandler.ts`) maps SQLSTATE (`23505→409`,
`23503→400`, …) and Prisma codes (`P2002→409`, `P2003→400`) to HTTP.

## Security

- **OAuth2/OIDC:** JWTs are validated against Keycloak's JWKS (`jose`) in `src/middlewares/auth.ts`;
  RBAC via `requireRole(...)` against `realm_access.roles`. Three clients (SPA/PKCE, SSR/confidential,
  M2M/Client Credentials), least-privilege per client. Details → [docs/oauth2-readme.md](docs/oauth2-readme.md).
- **Input:** validation before touching the database, parameterized queries only (pg `$1/$2`,
  Prisma `$queryRaw` tagged template, Knex builder — never SQL string concatenation).
- **Hardening:** no stack-trace leaks, rate limiting (429 with `RateLimit-*` headers), server-side
  self-follow block, explicit SQL/Mongo error handling.

## Tests

The two services use **different runners**:

```bash
# pg-service — Jest + ts-jest (ESM); unit tests mock Prisma
cd apps/backend/pg-service
npm test                       # unit (no DB)
npm test -- posts.test.ts      # single file
npm run test:integration       # needs a real Postgres (RUN_INTEGRATION, truncates tables!)
npm run build                  # tsc (typecheck in CI)

# mongo-service — Node's built-in test runner (tsx, no Jest)
cd apps/backend/mongo-service
npm test
npm run build
```

CI (`.github/workflows/ci.yml`) is path-filtered per service, then runs a full `docker compose` +
newman E2E against `postman_collection.json`.

## Documentation

> The documents under `docs/` are written in Polish.

| File | Scope |
|------|-------|
| [docs/databases-readme.md](docs/databases-readme.md) | Databases: the four DB tools, PG/Mongo schemas, patterns, requirements T1–T14 / F1–F5 |
| [docs/docker-readme.md](docs/docker-readme.md) | Docker Compose: architecture, networks, secrets, healthchecks, verification commands |
| [docs/kubernetes-readme.md](docs/kubernetes-readme.md) | Kubernetes + CI/CD: Kustomize manifests, `k8s/` structure, deploy, GitHub Actions |
| [docs/oauth2-readme.md](docs/oauth2-readme.md) | OAuth2/OIDC: Keycloak, three clients, RBAC, Google Brokering, demo scenario |
| [docs/README_old.md](docs/README_old.md) | Original assignment text (grading criteria) |

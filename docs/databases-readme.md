# Bazy danych — architektura i realizacja wymagań

Dokument opisuje warstwę danych projektu: **dwa silniki baz** (PostgreSQL + MongoDB),
**cztery narzędzia DB** ćwiczone na osobnych grupach endpointów w `pg-service` oraz
wzorce zapisu rozproszonego. Jest jednocześnie ściągą do obrony — mapuje wymagania
techniczne (T1–T14) i funkcjonalne (F1–F5) na konkretny kod.

## Podział narzędzi w `pg-service` (celowo, każde na swoich endpointach)

| Narzędzie | Endpointy | Singleton konfiguracji |
|-----------|-----------|------------------------|
| `pg` (sterownik natywny) | `/api/stats/*` | `src/config/pgPool.ts` |
| Knex (query builder) | `/api/tags/*` | `src/config/knex.ts`, migracje w `knex/` |
| Sequelize v6 | `/api/notifications/*` | `src/config/sequelize.ts`, `src/models/` |
| Prisma (ORM główny) | `/api/posts/*`, `/api/users/*` | `src/config/prisma.ts`, `prisma/` |

Prisma jest właścicielem kanonicznego schematu (`User`, `Follow`, `Post`, `Comment`,
`Reaction`). Migracje Knex dokładają `tags`/`post_tags` **na bazie** Prismy, więc kolejność
startowa to: `prisma migrate deploy → knex migrate:latest → prisma db seed → knex seed:run`.

`mongo-service` obsługuje MongoDB dwoma narzędziami: **Mongoose** (ODM — feed, rich-posty,
agregaty) oraz **natywny sterownik `mongodb`** (kolekcja `system_logs`).

---

## Wymagania techniczne (T1–T14)

### T1 — `pg`: pula singleton, zapytania parametryzowane, mapowanie błędów
- **Singleton** `pg.Pool` (jedna instancja na proces) + `pool.end()` na `SIGINT` — `src/config/pgPool.ts`.
- **Parametryzacja** `$1/$2` w endpointach statystyk — `src/routes/statsRoutes.ts`
  (`GET /api/stats/user/:id`, `GET /api/stats/posts/top`). Nigdy nie sklejamy SQL ze stringów.
- **Mapowanie SQLSTATE → HTTP** w `src/middlewares/errorHandler.ts`: `23505→409`, `23503→400`,
  `23502→400`, `23514→400`, `42P01→404`, `08006→503`. Tam też kody Prismy `P2002→409`, `P2003→400`.

### T2 — Knex: migracje, seedy, dynamiczne WHERE
- Dwie addytywne migracje (`knex/migrations/`): `create_tags` (UNIQUE `name`, indeks `usage_count DESC`)
  i `create_post_tags` (tabela łącząca, FK CASCADE do `"Post"`).
- Seed domenowy (`knex/seeds/`): 8 kanonicznych tagów.
- **Dynamiczne WHERE bez stringów** w `GET /api/tags` — warunkowe `.whereILike()`/`.andWhere()`
  budowane z query params. Transakcja Knex w `POST /api/tags/attach` (upsert tagu + `onConflict().ignore()` + `increment`).

### T3 — Sequelize v6: modele z walidacją, relacje, eager loading, hook, transakcja
- Dwa modele (`NotificationType`, `Notification`) z walidatorami niestandardowymi (`isInRange` 0–10, `noScript`).
- Hook `beforeCreate`/`beforeBulkCreate` (normalizacja whitespace), relacja `belongsTo`/`hasMany`, static `markAllAsRead`.
- **Eager loading** przez `include` w `GET /api/notifications/:userId`.
- **Transakcja zarządzana** (`sequelize.transaction(async t => …)`) w `PATCH /api/notifications/:userId/read-all`.

### T4 — Prisma: modele z relacjami, historia migracji, CRUD bez `any`, `$queryRaw`
- Relacje: `Post→User` (n:1), `Follow→User×2` (n:m), `Comment→Comment` (self-referential, wątki).
- 3 migracje stosowane `migrate deploy` na czystej bazie.
- CRUD w pełni typowany (`Prisma.PostWhereInput`, brak `as any`).
- **`$queryRaw` tagged template** dla filtrowania pełnotekstowego (`ILIKE ${'%'+hashtag+'%'}`) — automatyczna parametryzacja.

### T5 — MongoDB native: singleton, SIGINT, operatory, indeks
- Singleton `MongoClient` + zamknięcie Mongoose i klienta natywnego na `SIGINT` — `src/db.ts`.
- Native driver na kolekcji `system_logs` (`insertOne`/`find` z `$gte`).
- **≥3 operatory** w realnych endpointach: `$gte`, `$in`, `$exists`/`$ne`, `$match/$group/$project/$lookup`, `$objectToArray/$unwind`, `$sum/$avg/$round`.
- **Indeks złożony** `{ userId: 1, insertedAt: -1 }` (feed) oraz unique `{ day: 1, authorId: 1 }` (ActivityDaily).

### T6 — Mongoose: walidacja, subdokument, pre hook, populate, statics
- `RichPost`: subdokument `attachments[]` (`{ _id: false }`), walidator „max 4 załączniki", static `findByPostId`, pre `save`.
- `UserFeedEntry`: walidator `score` 0–100, virtual populate `richPost`.
- **Populate** w `GET /api/feed/:userId` (`.populate('richPost')`).

### T7 — Pipeline agregacji: `$match`/`$group`/`$project` + `$lookup`
Trzy endpointy analityczne (`src/routes/analyticsRoutes.ts`), pierwszy `$match` zawsze pod indeks:
- `GET /api/analytics/trending` — top posty tygodnia (match `insertedAt` → group → sort → limit → `$lookup` richposts → project).
- `GET /api/analytics/top-authors-weekly` — top autorzy (ActivityDaily, `$arrayElemAt`).
- `GET /api/analytics/reaction-distribution` — `$objectToArray` + `$unwind` + `$group` po typie reakcji.

### T8 — Docker Compose, multi-stage, healthchecki, depends_on
Szczegóły → [docker-readme.md](docker-readme.md). W skrócie: `docker compose up` bez kroków
ręcznych, healthchecki PG/Mongo, `depends_on: service_healthy`, multi-stage Dockerfile, `.env.example`.

### T9 — Mikroserwisy, podział per silnik, HTTP, API Gateway
Dwa serwisy Node w osobnych kontenerach (`pg-service` ↔ tylko PG, `mongo-service` ↔ tylko Mongo).
nginx jako single entry point routuje po prefiksie ścieżki. `pg-service` woła `mongo-service`
po HTTP (`/api/internal/*`), nie sięga bezpośrednio do MongoDB.

### T10 — Zapis PG+Mongo z kompensacją, jednolity format błędów
- **Saga z kompensacją** w `POST /api/posts`: INSERT (Prisma) → HTTP do mongo-service;
  przy błędzie Mongo `pg-service` **DELETE-uje** post i zwraca 500.
- Każda odpowiedź błędu ma kształt `{ error, code, details }` — nigdy stack trace.

### T11 — README
Główny [README.md](../README.md): jak uruchomić (compose), zmienne/sekrety, podział serwisów,
opis przepływu PG↔Mongo. Niniejszy plik + pozostałe `docs/*-readme.md` to rozwinięcie.

### T12 — Lista endpointów / OpenAPI
Specyfikacja `openapi.yaml` + `postman_collection.json` (E2E newman). Skrót:

**pg-service** (przez gateway `:8080`):
`POST/GET /api/posts`, `POST /api/posts/:id/reactions`, `DELETE /api/posts/:id`,
`POST/GET /api/posts/:id/comments`, `GET /api/users`, `POST/DELETE /api/users/:id/follow`,
`/api/stats/*`, `/api/tags/*`, `/api/notifications/*`.

**mongo-service**: `GET /api/feed/:userId`, `GET /api/analytics/{trending,top-authors-weekly,reaction-distribution}`,
`POST/GET /api/analytics/system-logs`.

### T13 — Testy integracyjne / e2e
- **pg-service**: Jest + supertest. Unit (mock Prisma) — posty, follow/self-follow, errorHandler;
  integracyjne (`RUN_INTEGRATION=true`, prawdziwa baza, truncate) — INSERT + kaskadowy DELETE.
- **mongo-service**: wbudowany test runner Node (`tsx --test`) — analytics, fan-out feedu, kursor, rozkład reakcji.

### T14 — Walidacja wejścia, bezpieczeństwo
- Walidacja przed dotknięciem bazy (`src/validators.ts`) + walidatory Mongoose.
- Brak wycieku stack trace (centralny `errorHandler`, `err.stack` tylko w logach).
- Jawna obsługa błędów Prisma / Mongoose `ValidationError` / `MongoServerError`.
- **Rate limit** 429 z nagłówkami `RateLimit-*` (`express-rate-limit`).
- Zabezpieczone zagrożenia: SQL/NoSQL Injection (parametryzacja + walidacja typów), wyciek stack trace, brute force (rate limit), self-follow (po stronie serwera).

---

## Wymagania funkcjonalne (F1–F5)

### F1 — Schemat PostgreSQL
`prisma/schema.prisma`: `User` (unique `username`/`email`), `Follow` (`@@unique([followerId, followeeId])`,
dwa FK do `User`), `Post` (`bodyPreview @db.VarChar(255)`), `Comment` (self-referential `parentId`,
wątki, ON DELETE CASCADE), `Reaction` (`@@unique([postId, userId])`, reakcje jako wiersze; upsert = idempotencja).

### F2 — Schemat MongoDB
`UserFeedEntry` (`userId, postId, score, insertedAt`; indeks `{userId, insertedAt}`),
`RichPost` (`postId, authorId, attachments[], poll`), `ActivityDaily` (`day, authorId, postsCreated,
reactionsGiven: Map`; unique `{day, authorId}`).

### F3 — API funkcjonalne
- Tworzenie posta (z fan-outem i kompensacją), lista postów z filtrem (`authorId`, `hashtag` przez `$queryRaw ILIKE`).
- Follow/unfollow (z blokadą self-follow, `23505→409` przy duplikacie).
- Reakcja idempotentna (`upsert` po `@@unique`).
- **Feed z kursorem** (`insertedAt < cursor`, nie OFFSET) po indeksie złożonym.

### F4 — Ograniczenia
- Blokada self-follow (serwer). Limit treści (walidacja + `VarChar(255)`).
- Usunięcie posta: kaskada FK w PG (Comment/Reaction) + fire-and-forget `DELETE /api/internal/rich-posts/:id`
  (mongo-service kasuje `RichPost` i `UserFeedEntry`).
- Rate limit → 429 z nagłówkami.

### F5 — Fan-out z kompensacją (T8c)
`POST /api/posts`: insert PG → pobranie followersów → HTTP do mongo-service, gdzie powstaje
`RichPost`, `insertMany` jednego `UserFeedEntry` per follower (fan-out on write) i upsert `ActivityDaily`.
Przy częściowym niepowodzeniu pg-service kompensuje przez DELETE posta. Powiadomienia (Sequelize
`bulkCreate`) są best-effort — ich błąd **nie** cofa posta.

---

## Diagram przepływu

```
              Klient → :8080 nginx API Gateway (routing per prefiks)
                         │                         │
                         ▼                         ▼
                 ┌───────────────┐   HTTP   ┌────────────────┐
                 │   pg-service  │ ───────► │  mongo-service │
                 │ pg/Knex/Seq./ │  (saga)  │ Mongoose +     │
                 │ Prisma        │          │ native driver  │
                 └──────┬────────┘          └───────┬────────┘
                        ▼                           ▼
                  PostgreSQL 15                 MongoDB 6
            User/Follow/Post/Comment/    UserFeedEntry/RichPost/
            Reaction/tags                ActivityDaily/system_logs
```

**Wzorce:** Singleton (pule/klienci), Saga (kompensacja przy tworzeniu posta), fan-out on write,
kursor zamiast OFFSET, API Gateway, fire-and-forget (powiadomienia, kasowanie feedu), agregacja w bazie.

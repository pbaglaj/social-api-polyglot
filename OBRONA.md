# Przygotowanie do Obrony Projektu

> Plik zawiera każde wymaganie z README, jego wyjaśnienie oraz opis implementacji w kodzie.
> Służy jako ściągawka przed obroną — prowadzący będzie pytał o wymagania T1–T8 oraz wymagania funkcjonalne.

---

## T1 — Pula połączeń, zapytania parametryzowane, mapowanie błędów PostgreSQL

**Wymaganie:**
Pula połączeń singleton, zapytania parametryzowane ($1, $2), mapowanie kodów PostgreSQL (np. 23505, 23503) na HTTP.

**Co to znaczy:**
- **Singleton** — jedna instancja klienta bazy danych dla całego procesu Node.js (nie tworzymy nowego połączenia na każde żądanie HTTP).
- **Parametryzowane zapytania** — zamiast sklejać SQL ze stringów (`"WHERE id=" + userId`), używamy placeholderów (`$1`, `$2`), co chroni przed SQL Injection.
- **Mapowanie błędów** — PostgreSQL zwraca kody błędów (np. `23505` = naruszenie UNIQUE), które tłumaczymy na kody HTTP (409 Conflict, 400 Bad Request, itp.).

**Implementacja:**

Singleton Prisma Client — [backend/pg-service/src/db.ts](backend/pg-service/src/db.ts):
```typescript
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientSingleton };
if (!globalForPrisma.prisma) globalForPrisma.prisma = prismaClientSingleton();
export default globalForPrisma.prisma;
```
Prisma przechowuje instancję na `globalThis` — przy hot-reload (nodemon) nie tworzymy dziesiątek połączeń. Wbudowany connection pool jest konfigurowalny przez `?connection_limit=X` w DATABASE_URL.

Parametryzowane zapytania — Prisma automatycznie buduje `$1, $2` w tle. Dla surowego SQL używamy tagged template (`$queryRaw`), który nigdy nie sklejał stringów.

Mapowanie błędów PostgreSQL — [backend/pg-service/src/errorHandler.ts](backend/pg-service/src/errorHandler.ts):
```typescript
const PG_ERROR_CODE_MAP = {
  '23505': { status: 409, error: 'Conflict',           message: 'Naruszenie UNIQUE' },
  '23503': { status: 400, error: 'Bad Request',        message: 'Naruszenie FK' },
  '23502': { status: 400, error: 'Bad Request',        message: 'NOT NULL violation' },
  '23514': { status: 400, error: 'Bad Request',        message: 'CHECK violation' },
  '42P01': { status: 404, error: 'Not Found',          message: 'Tabela nie istnieje' },
  '08006': { status: 503, error: 'Service Unavailable',message: 'Utrata połączenia' },
};
```
Mapowanie kodów błędów Prisma (`P2002` = UNIQUE, `P2003` = FK) odbywa się w tym samym pliku:
```typescript
if (err instanceof PrismaClientKnownRequestError) {
  if (err.code === 'P2002') { status = 409; ... }
  if (err.code === 'P2003') { status = 400; ... }
}
```

**Pytania potencjalne:**
- *"Dlaczego singleton?"* — żeby nie wyczerpać puli połączeń do bazy. PostgreSQL ma domyślnie limit ~100 równoczesnych połączeń.
- *"Czym grozi sklejanie SQL ze stringów?"* — SQL Injection. Użytkownik może wstrzyknąć `'; DROP TABLE users; --`.
- *"Co to jest kod 23505?"* — UNIQUE constraint violation w PostgreSQL. Np. próba rejestracji z już istniejącym emailem.

---

## T2 — Migracje, seedy, dynamiczne WHERE bez sklejania stringów

**Wymaganie:**
Schemat wyłącznie przez migracje (min. 2 addytywne), seedy domenowe, min. 1 endpoint z dynamicznym WHERE bez sklejania SQL z stringów.

**Co to znaczy:**
- **Migracje** — historia zmian schematu bazy. Każda migracja to plik SQL, który można odtworzyć na czystej bazie. Addytywna = tylko dodaje kolumny/tabele, nie usuwa.
- **Seedy** — skrypt wypełniający bazę przykładowymi danymi domenowymi (użytkownicy, posty, follows) na potrzeby developmentu/prezentacji.
- **Dynamiczne WHERE** — filtrowanie wyników bez sklejania stringów SQL.

**Implementacja:**

Trzy migracje Prisma — [backend/pg-service/prisma/migrations/](backend/pg-service/prisma/migrations/):

1. `20260426180006_init` — tabele bazowe: User, Follow, Post, Comment, Reaction
2. `20260505183000_cascade_post_deletes` — addytywna: dodanie `ON DELETE CASCADE` do FK w Comment i Reaction
3. `20260513120000_add_user_profile_fields` — addytywna: nowe kolumny w User (`bio`, `avatarUrl`, `displayName`, `location`, `isVerified`, `updatedAt`)

Seed domenowy — [backend/pg-service/prisma/seed.ts](backend/pg-service/prisma/seed.ts):
Tworzy 10 użytkowników (faker), dla każdego: 1 post, 1 komentarz, 1 relację follow.

Dynamiczne WHERE bez sklejania stringów — [backend/pg-service/src/postRoutes.ts](backend/pg-service/src/postRoutes.ts):
```typescript
// GET /api/posts?authorId=5&hashtag=tech
const where: Prisma.PostWhereInput = {};
if (authorId)  where.authorId = Number(authorId);
if (hashtag)   where.bodyPreview = { contains: `#${hashtag}`, mode: 'insensitive' };

const posts = await prisma.post.findMany({ where, include: { author: true } });
```
Prisma buduje parametryzowany SQL bez żadnego sklejania stringów.

**Pytania potencjalne:**
- *"Jak uruchomić migracje na czystej bazie?"* — `npx prisma migrate deploy` (działa automatycznie w docker-compose).
- *"Czym różni się `migrate dev` od `migrate deploy`?"* — `dev` tworzy nową migrację i ją stosuje (środowisko deweloperskie), `deploy` tylko stosuje istniejące migracje (produkcja/CI).
- *"Co to znaczy addytywna migracja?"* — tylko dodaje elementy (kolumny, tabele, indeksy), nie usuwa i nie modyfikuje istniejących. Bezpieczna dla rolling deployments.

---

## T3 — Modele Prisma z walidacją, relacje, eager loading, hook, transakcja

**Wymaganie:**
Min. 2 modele z walidacją, relacje użyte w endpointach, eager loading (include), hook domenowy, transakcja zarządzana.

**Co to znaczy:**
- **Eager loading** — pobieranie powiązanych danych w jednym zapytaniu (zamiast N+1 queries).
- **Hook domenowy** — logika automatycznie wykonywana przed/po operacji na modelu (np. normalizacja danych).
- **Transakcja zarządzana** — blok kodu gdzie albo wszystkie operacje się powiodą, albo żadna (ACID).

**Implementacja:**

Dwa modele: `Post` i `User` (+ `Follow`, `Comment`, `Reaction`) — [backend/pg-service/prisma/schema.prisma](backend/pg-service/prisma/schema.prisma).

Relacje w endpointach — eager loading przez `include`:
```typescript
// GET /api/posts — dołącza dane autora
const posts = await prisma.post.findMany({
  where,
  include: { author: { select: { id: true, username: true } } },
  orderBy: { createdAt: 'desc' },
  take: limit
});
```

Hook domenowy (Client Extension) — [backend/pg-service/src/db.ts](backend/pg-service/src/db.ts):
```typescript
const extended = base.$extends({
  query: {
    user: {
      async create({ args, query }) {
        // Hook: normalizuj email do lowercase przed zapisem
        if (args?.data?.email) args.data.email = String(args.data.email).toLowerCase();
        return query(args);
      },
    },
  },
});
```

Transakcja zarządzana — DELETE /api/posts/:id — [backend/pg-service/src/postRoutes.ts](backend/pg-service/src/postRoutes.ts):
```typescript
await prisma.$transaction(async (tx) => {
  await tx.comment.deleteMany({ where: { postId } });
  await tx.reaction.deleteMany({ where: { postId } });
  await tx.post.delete({ where: { id: postId } });
});
```
`$transaction` używa callback pattern — Prisma automatycznie zarządza `BEGIN`/`COMMIT`/`ROLLBACK`.

**Pytania potencjalne:**
- *"Co to jest N+1 problem i jak go rozwiązuje eager loading?"* — Bez `include`: 1 query na posty + N queries na autorów. Z `include`: 1 query JOIN.
- *"Dlaczego `$transaction` callback zamiast `$transaction([promise1, promise2])`?"* — Callback pozwala na warunkową logikę w środku transakcji i gwarantuje atomowość. Tablicowy wariant nie pozwala na zależności między operacjami.

---

## T4 — Prisma: modele z relacjami, historia migracji, CRUD bez `any`, `$queryRaw`

**Wymaganie:**
Min. 2 modele z relacjami, historia migracji (migrate deploy na czystej bazie), CRUD przez PrismaClient bez `any`, min. 1 `$queryRaw` (tagged template).

**Co to znaczy:**
- **CRUD bez `any`** — TypeScript jest ścisły, nie używamy `as any` do obejścia typów Prisma.
- **`$queryRaw` tagged template** — surowy SQL wykonany bezpiecznie przez Prisma (template literal `prisma.$queryRaw\`SELECT...\``).

**Implementacja:**

Modele z relacjami — `Post → User` (many-to-one), `Follow → User × 2` (many-to-many), `Comment → Comment` (self-referential, wątkowanie) — schema.prisma.

Historia migracji: 3 pliki w [backend/pg-service/prisma/migrations/](backend/pg-service/prisma/migrations/), `migrate deploy` stosuje je w kolejności na czystej bazie.

CRUD bez `any` — pełna typizacja Prisma (typy generowane ze schema.prisma):
```typescript
const post: Post = await prisma.post.create({ data: { authorId, bodyPreview } });
const where: Prisma.PostWhereInput = {};
```

`$queryRaw` tagged template — używamy dla dynamicznego listowania z filtrowaniem pełnotekstowym lub gdy Prisma ORM nie generuje optymalnego SQL:
```typescript
const posts = await prisma.$queryRaw<Post[]>`
  SELECT p.*, u.username
  FROM "Post" p
  JOIN "User" u ON p."authorId" = u.id
  WHERE p."bodyPreview" ILIKE ${'%' + hashtag + '%'}
  ORDER BY p."createdAt" DESC
`;
```
Tagged template (`Prisma.sql`) automatycznie parametryzuje wartości — brak ryzyka SQL Injection.

**Pytania potencjalne:**
- *"Dlaczego `$queryRaw` tagged template, a nie string?"* — `prisma.$queryRaw('SELECT...' + input)` jest niebezpieczne (SQL Injection). Tagged template `prisma.$queryRaw\`...\`` zawsze parametryzuje.
- *"Co się stanie jeśli na czystej bazie uruchomisz `migrate deploy`?"* — Prisma wykona wszystkie migracje w kolejności chronologicznej, odtwarzając pełny schemat.

---

## T5 — MongoDB: Singleton MongoClient, SIGINT, native driver, operatory, indeks

**Wymaganie:**
Singleton MongoClient, zamknięcie przy SIGINT, zasób domenowy sterownikiem natywnym, min. 3 różne operatory w realnych endpointach, indeks złożony lub tekstowy.

**Co to znaczy:**
- **Singleton MongoClient** — jak w PostgreSQL: jedna instancja klienta, nie tworzymy nowej przy każdym żądaniu.
- **SIGINT** — sygnał Unix `Ctrl+C`. Musimy zamknąć połączenia przed zakończeniem procesu (graceful shutdown).
- **Native driver** — używamy bezpośrednio sterownika `mongodb` (nie tylko Mongoose) dla co najmniej jednej kolekcji.
- **Operatory** — `$gte`, `$match`, `$in`, `$exists` itp.
- **Indeks złożony** — indeks na więcej niż jednym polu, przyspiesza zapytania z wieloma warunkami.

**Implementacja:**

Singleton + SIGINT — [backend/mongo-service/src/db.ts](backend/mongo-service/src/db.ts):
```typescript
// Singleton MongoClient (native)
if (!globalForMongo.nativeClient) {
  const client = new MongoClient(uri);
  await client.connect();
  globalForMongo.nativeClient = client;
  globalForMongo.nativeDb = client.db();
}

// Graceful shutdown przy SIGINT
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  await globalForMongo.nativeClient.close();
  process.exit(0);
});
```

Native driver — kolekcja `system_logs` obsługiwana przez natywny MongoClient (nie Mongoose):
```typescript
// Zapis logu (native driver)
const db = globalForMongo.nativeDb;
await db.collection('system_logs').insertOne({ level, message, insertedAt: new Date() });

// Odczyt logów (native driver)
const logs = await db.collection('system_logs')
  .find({ insertedAt: { $gte: oneDayAgo } })  // Operator $gte
  .sort({ insertedAt: -1 })
  .limit(50)
  .toArray();
```

Min. 3 operatory w endpointach:
- `$gte` — filtrowanie po dacie (analytics, feed)
- `$match`, `$group`, `$project`, `$lookup` — aggregation pipeline
- `$exists`, `$ne` — warunki opcjonalne w feedzie
- `$in` — filtrowanie po liście ID
- `$objectToArray`, `$unwind` — pipeline reaction-distribution
- `$sum`, `$avg`, `$round` — aggregacje statystyczne

Indeks złożony — [backend/mongo-service/src/models/UserFeedEntry.ts](backend/mongo-service/src/models/UserFeedEntry.ts):
```typescript
UserFeedEntrySchema.index({ userId: 1, insertedAt: -1 });
// Obsługuje zapytania: WHERE userId=X ORDER BY insertedAt DESC (feed z paginacją)
```

Indeks złożony unique — ActivityDaily:
```typescript
ActivityDailySchema.index({ day: 1, authorId: 1 }, { unique: true });
// Gwarantuje jeden wpis dziennie per autor
```

**Pytania potencjalne:**
- *"Dlaczego ważny jest SIGINT handler?"* — Bez niego process.exit() nie zwalnia połączeń. MongoDB może mieć otwarte connections w puli, co przy wielu restartach wyczerpuje limity.
- *"Czym różni się Mongoose od native MongoClient?"* — Mongoose to ODM (Object Document Mapper) — schematy, walidatory, hooki. Native driver to niskopoziomowy dostęp bezpośrednio do MongoDB API.
- *"Po co indeks złożony `{ userId, insertedAt }`?"* — Feed pobieramy dla konkretnego usera posortowany po czasie. Indeks złożony obsługuje oba warunki naraz (bez `userId` indeks na `insertedAt` byłby mniej efektywny).

---

## T6 — Mongoose: schematy z walidacją, subdokument, pre hook, populate, methods/statics

**Wymaganie:**
Min. 2 schematy z walidatorami niestandardowymi, subdokument lub tablica zagnieżdżona, pre hook, populate w endpoincie, methods lub statics.

**Co to znaczy:**
- **Walidator niestandardowy** — własna funkcja walidująca (nie tylko `required: true`, ale np. "wartość musi być w zakresie 0-100").
- **Subdokument** — zagnieżdżony schemat wewnątrz dokumentu (np. `attachments` w RichPost).
- **Pre hook** — logika wykonywana automatycznie przed operacją save/find.
- **Populate** — Mongoose odpowiednik JOIN — zastępuje ID referencyjne pełnymi dokumentami.
- **methods/statics** — metody instancji (`doc.metodaX()`) i statyczne (`Model.metodaY()`).

**Implementacja:**

Dwa schematy Mongoose — [backend/mongo-service/src/models/](backend/mongo-service/src/models/):

**RichPost** — walidator niestandardowy + subdokument:
```typescript
// Subdokument (tablica zagnieżdżona)
const AttachmentSchema = new Schema<IAttachment>({
  url:  { type: String, required: true },
  type: { type: String, enum: ['image', 'video', 'link'], required: true }
}, { _id: false });  // subdocument bez własnego _id

// Walidator niestandardowy: max 4 załączniki
attachments: {
  type: [AttachmentSchema],
  validate: {
    validator: (v: IAttachment[]) => v.length <= 4,
    message: 'Post może mieć maksymalnie 4 załączniki.'
  }
}

// Static method
RichPostSchema.statics.findByPostId = function(postId: number) {
  return this.findOne({ postId });
};

// Pre hook — aktualizacja daty modyfikacji
RichPostSchema.pre('save', function() {
  this.updatedAt = new Date();
});
```

**UserFeedEntry** — walidator niestandardowy + virtual populate:
```typescript
// Walidator niestandardowy: score 0-100
score: {
  type: Number,
  default: 1,
  validate: {
    validator: (v: number) => v >= 0 && v <= 100,
    message: 'Score musi być w zakresie 0-100.'
  }
}

// Virtual (wirtualne pole populate do RichPost)
UserFeedEntrySchema.virtual('richPost', {
  ref: 'RichPost',
  localField: 'postId',
  foreignField: 'postId',
  justOne: true
});
```

Populate w endpoincie — [backend/mongo-service/src/feedRoutes.ts](backend/mongo-service/src/feedRoutes.ts):
```typescript
// GET /api/feed/:userId — pobiera feed z danymi rich post
const entries = await UserFeedEntry.find(query)
  .sort({ insertedAt: -1 })
  .limit(limit)
  .populate('richPost');  // Zastępuje postId pełnym dokumentem RichPost
```

**Pytania potencjalne:**
- *"Czym różni się subdokument od referencji?"* — Subdokument jest przechowywany wewnątrz dokumentu (denormalizacja, szybki odczyt, brak JOINa). Referencja to ID do innej kolekcji (normalizacja, wymaga populate/lookup).
- *"Kiedy pre hook się wywołuje?"* — Przed operacją na bazie (np. `save`, `find`, `validate`). Używamy do modyfikacji danych przed zapisem lub do side-effectów.
- *"Co to `{ _id: false }` w subdokumencie?"* — Wyłącza automatyczne generowanie `_id` dla subdokumentu. Używamy gdy nie potrzebujemy identyfikować subdokumentów indywidualnie.

---

## T7 — Pipeline agregacji MongoDB: $match, $group, $project, $lookup

**Wymaganie:**
Pipeline z `$match`, `$group`, `$project` i min. jednym dodatkowym stage; `$lookup`; pierwszy `$match` pod indeks; endpoint analityczny — agregacja w bazie.

**Co to znaczy:**
- **Pipeline agregacji** — sekwencja etapów (stages) przetwarzających dokumenty jak taśma produkcyjna.
- **`$match` pod indeks** — pierwszy stage filtruje dane używając indeksowanego pola (wydajne — baza nie skanuje wszystkich dokumentów).
- **`$lookup`** — odpowiednik SQL JOIN między kolekcjami.
- **Agregacja w bazie** — obliczenia wykonuje MongoDB, nie kod Node.js (serwer, nie sieć).

**Implementacja:**

Trzy endpointy analityczne — [backend/mongo-service/src/analyticsRoutes.ts](backend/mongo-service/src/analyticsRoutes.ts):

**A. GET /api/analytics/trending** — top posty tygodnia (5 stages + $lookup):
```typescript
const pipeline = [
  { $match: { insertedAt: { $gte: sevenDaysAgo } } },     // 1. $match pod indeks (insertedAt)
  { $group: { _id: "$postId", totalReach: { $sum: 1 },     // 2. $group — zlicz fan-out
               avgScore: { $avg: "$score" } } },
  { $sort: { totalReach: -1 } },                           // 3. $sort (dodatkowy stage)
  { $limit: 10 },                                          // 4. $limit (dodatkowy stage)
  { $lookup: { from: "richposts", localField: "_id",       // 5. $lookup — JOIN z rich_posts
               foreignField: "postId", as: "richData" } },
  { $project: { _id: 0, postId: "$_id",                   // 6. $project — formatuj wynik
                reach: "$totalReach", averageScore: { $round: ["$avgScore", 2] } } }
];
```

**B. GET /api/analytics/top-authors-weekly** — top autorzy (ActivityDaily):
```typescript
const pipeline = [
  { $match: { day: { $gte: sevenDaysAgo } } },             // $match pod indeks (day)
  { $group: { _id: '$authorId', totalPosts: { $sum: '$postsCreated' } } },
  { $sort: { totalPosts: -1 } }, { $limit: 10 },
  { $lookup: { from: 'richposts', localField: '_id',
               foreignField: 'authorId', as: 'posts' } },
  { $project: { authorId: '$_id', totalPosts: 1,
                samplePostId: { $arrayElemAt: ['$posts.postId', 0] } } }
];
```

**C. GET /api/analytics/reaction-distribution** — rozkład reakcji ($objectToArray + $unwind):
```typescript
const pipeline = [
  { $match: { day: { $gte: sevenDaysAgo } } },
  { $project: { reactionsArray: { $objectToArray: "$reactionsGiven" } } }, // Map → array
  { $unwind: { path: "$reactionsArray", preserveNullAndEmptyArrays: false } },
  { $group: { _id: "$reactionsArray.k", totalCount: { $sum: "$reactionsArray.v" } } },
  { $sort: { totalCount: -1 } },
  { $project: { reactionType: "$_id", totalCount: 1, _id: 0 } }
];
```

**Pytania potencjalne:**
- *"Dlaczego $match jako pierwszy stage?"* — Żeby MongoDB użyło indeksu do odfiltrowania dokumentów zanim wykona droższe operacje ($group, $lookup). Bez tego baza musiałaby przeglądać całą kolekcję.
- *"Co robi $lookup?"* — Łączy dokumenty z innej kolekcji (jak LEFT JOIN w SQL). `localField` to pole w bieżącej kolekcji, `foreignField` to pole w docelowej kolekcji.
- *"Po co $objectToArray?"* — Pole `reactionsGiven` to Map (`{ "like": 10, "heart": 5 }`). `$objectToArray` zamienia ją na `[{k:"like", v:10}, {k:"heart", v:5}]`, co pozwala na `$unwind` i `$group` po kluczu.

---

## T8 — Docker Compose, multi-stage Dockerfile, healthchecki, depends_on

**Wymaganie:**
`docker compose up` bez kroków ręcznych, multi-stage Dockerfile, healthchecki, `depends_on service_healthy`, `.env.example`.

**Co to znaczy:**
- **`docker compose up` bez kroków ręcznych** — jeden komend uruchamia całą infrastrukturę, baza danych, migracje, seedy, aplikacje.
- **Multi-stage Dockerfile** — jeden Dockerfile z kilkoma etapami (np. `builder` → `runner`), zmniejsza rozmiar finalnego obrazu (nie ma `node_modules` devDependencies w produkcji).
- **Healthcheck** — sprawdzenie czy serwis jest gotowy do przyjmowania ruchu (nie tylko "czy kontener działa").
- **`depends_on service_healthy`** — serwis startuje dopiero gdy zależność przejdzie healthcheck.

**Implementacja:**

Docker Compose — [backend/docker-compose.yml](backend/docker-compose.yml):
```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
    interval: 5s  retries: 5

mongodb:
  healthcheck:
    test: echo 'db.runCommand("ping").ok' | mongosh localhost:27017/test --quiet
    interval: 5s  retries: 5

pg-service:
  depends_on:
    postgres: { condition: service_healthy }    # Czeka na healthcheck PG
  command: >
    sh -c "npx prisma migrate deploy && npx prisma db seed && npx tsx src/index.ts"
  healthcheck:
    test: ["CMD-SHELL", "node -e \"...http.get('/api/posts')...\""]

mongo-service:
  depends_on:
    mongodb: { condition: service_healthy }     # Czeka na healthcheck Mongo

api-gateway:
  depends_on:
    pg-service:    { condition: service_healthy }
    mongo-service: { condition: service_healthy }
```

Kolejność uruchamiania: `postgres` → `pg-service` (migracje+seed) → `api-gateway`, równolegle `mongodb` → `mongo-service` → `api-gateway`.

`.env.example` — [.env.example](.env.example): wszystkie zmienne środowiskowe z opisem.

**Multi-stage Dockerfile** — [backend/pg-service/Dockerfile](backend/pg-service/Dockerfile):
```dockerfile
# Stage 1: Builder — instaluje wszystkie zależności, kompiluje TypeScript
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

# Stage 2: Runner — tylko produkcyjne zależności + skompilowany kod
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
```

**Pytania potencjalne:**
- *"Co się stanie jeśli pg-service wystartuje zanim postgres jest gotowy?"* — Bez `depends_on service_healthy` połączenie do bazy się nie powiedzie. Z `service_healthy` Docker czeka na pozytywny healthcheck.
- *"Po co multi-stage build?"* — Zmniejsza rozmiar obrazu (devDependencies jak TypeScript nie trafiają do produkcji). Poprawia bezpieczeństwo (mniej kodu = mniejsza powierzchnia ataku).
- *"Jak uruchomić projekt?"* — `cp .env.example .env && docker compose up --build` w katalogu `backend/`.

---

## T9 — Mikroserwisy, podział per DB, HTTP, API Gateway, migracje z compose

**Wymaganie:**
Min. 2 serwisy Node w osobnych kontenerach, podział per silnik BD, komunikacja HTTP/broker, API Gateway, migracje/seedy z compose.

**Co to znaczy:**
- **2 serwisy Node** — `pg-service` i `mongo-service` to osobne aplikacje Express w osobnych kontenerach.
- **Podział per silnik BD** — `pg-service` rozmawia TYLKO z PostgreSQL, `mongo-service` TYLKO z MongoDB.
- **API Gateway** — Nginx jako single entry point, routuje żądania do właściwego serwisu.
- **Komunikacja HTTP** — `pg-service` wywołuje `mongo-service` przez HTTP (nie bezpośrednio do bazy).

**Implementacja:**

Architektura — dwa serwisy Node.js + Nginx jako API Gateway:

```
Klient (przeglądarka/Postman)
        ↓ :8080
   [Nginx API Gateway]
    /api/users  →  pg-service:3001
    /api/posts  →  pg-service:3001
    /api/feed   →  mongo-service:3002
    /api/analytics → mongo-service:3002

pg-service ──HTTP──→ mongo-service (internal API)
```

Nginx konfiguracja — [backend/api-gateway/nginx.conf](backend/api-gateway/nginx.conf):
```nginx
location /api/users    { proxy_pass http://pg-service:3001; }
location /api/posts    { proxy_pass http://pg-service:3001; }
location /api/feed     { proxy_pass http://mongo-service:3002; }
location /api/analytics{ proxy_pass http://mongo-service:3002; }
```

Komunikacja HTTP między serwisami — [backend/pg-service/src/postRoutes.ts](backend/pg-service/src/postRoutes.ts):
```typescript
// pg-service → mongo-service po stworzeniu posta
const MONGO_SERVICE_URL = process.env.MONGO_SERVICE_URL || 'http://mongo-service:3002';

await fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ postId, authorId, attachments, followerIds })
});
```

Migracje i seedy uruchamiane automatycznie z `compose` — `command` pg-service:
```yaml
command: >
  sh -c "npx prisma migrate deploy && npx prisma db seed && npx tsx src/index.ts"
```

**Pytania potencjalne:**
- *"Dlaczego pg-service nie łączy się bezpośrednio z MongoDB?"* — Naruszałoby to separation of concerns. Każdy serwis odpowiada za swój silnik BD. Zmiany w MongoDB nie dotykają pg-service.
- *"Po co API Gateway?"* — Single entry point dla klientów (nie muszą znać portów wewnętrznych). Obsługa CORS w jednym miejscu. Możliwość dodania autentykacji/rate limitingu bez zmian w serwisach.
- *"Co to jest `/api/internal/`?"* — Wewnętrzne endpointy mongo-service, wywoływane TYLKO przez pg-service (nie przez klientów). Nginx ich nie routuje na zewnątrz.

---

## T10 — Operacja zapisu do PG i Mongo z kompensacją, format błędów

**Wymaganie:**
Min. 1 operacja zapisu do PG i Mongo z rollbackiem lub kompensacją; jednolity format błędów `{ error, code, details }`.

**Co to znaczy:**
- **Kompensacja (Saga pattern)** — w systemach rozproszonych nie ma globalnych transakcji. Jeśli operacja B się nie powiedzie po powodzeniu A, musimy "cofnąć" A ręcznie (kompensacja).
- **Rollback vs Kompensacja** — rollback to cofanie transakcji w tej samej bazie. Kompensacja to odwrotna operacja w drugiej bazie (np. DELETE po INSERT).
- **Jednolity format błędów** — każda odpowiedź błędu ma te same pola: `error` (HTTP status name), `code` (kod aplikacyjny), `details` (szczegółowy opis).

**Implementacja:**

Kompensacja przy tworzeniu posta — [backend/pg-service/src/postRoutes.ts](backend/pg-service/src/postRoutes.ts):
```typescript
let createdPost;
try {
  // Krok 1: INSERT do PostgreSQL
  createdPost = await prisma.post.create({ data: { authorId, bodyPreview } });

  // Krok 2: HTTP POST do mongo-service (fan-out, rich post, activity)
  const mongoResponse = await fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts`, {
    method: 'POST', body: JSON.stringify({ postId: createdPost.id, ... })
  });

  if (!mongoResponse.ok) {
    throw new Error(`Mongo service error: ${mongoResponse.status}`);
  }

  res.status(201).json(createdPost);

} catch (error) {
  // KOMPENSACJA: jeśli Mongo się nie powiodło, usuń post z PG
  if (createdPost) {
    console.warn(`[Kompensacja] Usuwanie posta ${createdPost.id} z PG...`);
    await prisma.post.delete({ where: { id: createdPost.id } })
      .catch(e => console.error('Krytyczny błąd kompensacji!', e));
  }
  next(error);
}
```

Scenariusz kompensacji:
1. ✅ Insert do PostgreSQL (post.id = 42)
2. ❌ Mongo service zwraca 500 (np. sieć niedostępna)
3. 🔄 Kompensacja: `DELETE FROM Post WHERE id = 42`
4. Klient otrzymuje HTTP 500 — post nigdy nie "zaistniał"

Jednolity format błędów — [backend/pg-service/src/errorHandler.ts](backend/pg-service/src/errorHandler.ts):
```typescript
// Każda odpowiedź błędu:
res.status(status).json({
  error: 'Conflict',           // Nazwa statusu HTTP
  code: 'P2002',               // Kod aplikacyjny (Prisma, PG, lub własny)
  details: 'Naruszenie UNIQUE dla pól: email'  // Szczegóły dla developera
});
```

Przykłady format błędów:
- `400` → `{ error: "Bad Request", code: "VALIDATION_FAILED", details: "bodyPreview max 255 znaków" }`
- `409` → `{ error: "Conflict", code: "P2002", details: "Unikalność naruszona dla pól: email" }`
- `403` → `{ error: "Forbidden", code: "NOT_POST_OWNER", details: "Nie jesteś autorem tego postu" }`
- `429` → `{ error: "Too Many Requests", code: 429, details: "Exceeded request limit" }`
- `500` → `{ error: "Internal Server Error", code: "INTERNAL_ERROR", details: "..." }`

**Pytania potencjalne:**
- *"Dlaczego to kompensacja a nie rollback?"* — Rollback działa w granicach jednej transakcji bazy danych. Nie ma transakcji rozpiętej między PostgreSQL a MongoDB. Kompensacja to manualny "rollback" przez wykonanie odwrotnej operacji.
- *"Co jeśli kompensacja też się nie powiedzie?"* — To "critical failure" — logujemy błąd (`console.error`), ale nie możemy zrobić więcej bez idempotentnego mechanizmu retry (np. kolejka). W prostym modelu akceptujemy tę niespójność i alertujemy.
- *"Dlaczego jednolity format błędów?"* — Klient (frontend, Postman) może zawsze parsować tę samą strukturę. Łatwiejsze debugowanie. Nie wyciekamy stack trace.

---

## T11 — README: jak uruchomić, zmienne, podział serwisów, diagram przepływu

**Wymaganie:**
Repozytorium zawiera README: jak uruchomić (compose), zmienne środowiskowe, podział serwisów, diagram lub opis przepływu danych PG/Mongo.

**Implementacja:**
Główne README.md oraz `.env.example` z opisem wszystkich zmiennych. Diagram przepływu danych opisany w architekturze serwisów.

Jak uruchomić (z README):
```bash
cp .env.example .env
docker compose up --build
# API dostępne na http://localhost:8080
```

Zmienne środowiskowe z `.env.example`:
```
POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
DATABASE_URL=postgresql://...
MONGO_INITDB_ROOT_USERNAME, MONGO_INITDB_ROOT_PASSWORD
MONGO_URI=mongodb://...
PG_SERVICE_PORT=3001
MONGO_SERVICE_PORT=3002
API_GATEWAY_PORT=8080
```

---

## T12 — Specyfikacja OpenAPI / lista endpointów

**Wymaganie:**
Publikowalna specyfikacja OpenAPI 3.x lub równoważna lista endpointów z przykładowymi żądaniami/odpowiedziami.

**Implementacja — pełna lista endpointów:**

### pg-service (przez API Gateway: `localhost:8080`)

| Metoda | Endpoint | Opis | Body |
|--------|----------|------|------|
| `POST` | `/api/posts` | Utwórz post | `{ authorId, bodyPreview, attachments?, poll? }` |
| `GET` | `/api/posts?authorId=&hashtag=` | Listuj posty (filtrowane) | — |
| `POST` | `/api/posts/:id/reactions` | Dodaj/zmień reakcję | `{ userId, type }` |
| `DELETE` | `/api/posts/:id` | Usuń post | `{ requesterId }` |
| `POST` | `/api/posts/:id/comments` | Dodaj komentarz | `{ authorId, content, parentId? }` |
| `GET` | `/api/posts/:id/comments` | Pobierz komentarze (wątkowe) | — |
| `GET` | `/api/users?username=&email=` | Listuj użytkowników | — |
| `POST` | `/api/users/:id/follow` | Obserwuj użytkownika | `{ followerId }` |
| `DELETE` | `/api/users/:id/follow` | Przestań obserwować | `{ followerId }` |

### mongo-service (przez API Gateway: `localhost:8080`)

| Metoda | Endpoint | Opis |
|--------|----------|------|
| `GET` | `/api/feed/:userId?cursor=&limit=` | Feed użytkownika (cursor pagination) |
| `GET` | `/api/analytics/trending` | Top posty tygodnia |
| `GET` | `/api/analytics/top-authors-weekly` | Top autorzy tygodnia |
| `GET` | `/api/analytics/reaction-distribution` | Rozkład typów reakcji |
| `POST` | `/api/analytics/system-logs` | Zapisz log (native driver) |
| `GET` | `/api/analytics/system-logs` | Ostatnie logi (24h) |

---

## T13 — Testy integracyjne / e2e (supertest + baza testowa)

**Wymaganie:**
Min. zestaw testów integracyjnych lub e2e krytycznych ścieżek API (np. supertest + baza testowa).

**Implementacja:**

PG Service używa **Jest + supertest** — [backend/pg-service/tests/](backend/pg-service/tests/):

Testy jednostkowe (mock Prisma):
- `posts.test.ts` — walidacja, kompensacja, reakcje idempotentne, autoryzacja DELETE
- `users.test.ts` — follow/unfollow, blokada self-follow
- `errorHandler.test.ts` — mapowanie kodów błędów

Testy integracyjne (prawdziwa baza, `RUN_INTEGRATION=true`):
- `integration/posts.integration.test.ts` — faktyczny INSERT do PG, kaskadowe DELETE

Przykład testu kompensacji:
```typescript
it('kompensacja: w razie błędu mongo, usuwa post z PG', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => ({}) }));
  const deleteSpy = jest.spyOn(prisma.post, 'delete');

  const res = await request(app).post('/api/posts').send({...});

  expect(res.status).toBe(500);
  expect(deleteSpy).toHaveBeenCalled();  // Kompensacja się wykonała
});
```

Mongo Service używa **Node.js test runner + supertest** — [backend/mongo-service/src/__tests__/](backend/mongo-service/src/__tests__/):
- `analyticsRoutes.test.ts` — wszystkie 3 endpointy analityczne
- `internalRoutes.test.ts` — fan-out feedu, reakcje, kaskadowe usuwanie
- `feedRoutes.test.ts` — cursor pagination
- `reactionDistribution.test.ts` — rozkład reakcji

Uruchomienie testów:
```bash
# pg-service
cd backend/pg-service && npm test
# RUN_INTEGRATION=true npm test (testy integracyjne)

# mongo-service
cd backend/mongo-service && npm test
```

**Pytania potencjalne:**
- *"Czym różnią się testy jednostkowe od integracyjnych?"* — Jednostkowe mockują bazę danych (szybkie, izolowane). Integracyjne używają prawdziwej bazy (wolniejsze, sprawdzają faktyczne działanie).
- *"Co testuje test kompensacji?"* — Że gdy Mongo zwróci błąd, `prisma.post.delete` zostanie wywołany — czyli post "znika" z PG.

---

## T14 — Walidacja wejścia, bezpieczeństwo, obsługa błędów SQL/Mongo

**Wymaganie:**
Walidacja wejścia, brak wycieku stack trace do klienta, jawna obsługa błędów SQL/Mongo; krótki opis zagrożeń w README.

**Implementacja:**

Walidacja wejścia — [backend/pg-service/src/validators.ts](backend/pg-service/src/validators.ts) + [backend/mongo-service/src/models/](backend/mongo-service/src/models/):

```typescript
// Walidacja w Express (przed dotkięciem bazy)
if (!authorId || typeof authorId !== 'number') {
  return res.status(400).json({
    error: 'Bad Request', code: 'VALIDATION_FAILED',
    details: 'authorId jest wymagany i musi być liczbą'
  });
}
if (bodyPreview.length > 255) {
  return res.status(400).json({ ... 'bodyPreview max 255 znaków' });
}
```

Brak wycieku stack trace — centralny error handler:
```typescript
// errorHandler.ts — NIGDY nie wysyła err.stack do klienta
res.status(status).json({ error, code, details });
// Stack trace tylko w logach serwera (console.error(err))
```

Obsługa błędów SQL (Prisma codes) i Mongo (ValidationError):
```typescript
if (err instanceof PrismaClientKnownRequestError) { /* mapowanie P2002, P2003 */ }
if (err.name === 'ValidationError') { /* Mongoose validation */ }
if (err.name === 'MongoServerError') { /* MongoDB native errors */ }
```

Rate limiting — [backend/pg-service/src/index.ts](backend/pg-service/src/index.ts):
```typescript
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minut
  max: 100,                    // 100 żądań per okno
  message: { error: 'Too Many Requests', code: 429, details: '...' },
  standardHeaders: true,       // Nagłówki RateLimit-Limit, RateLimit-Remaining
});
app.use('/api/', apiLimiter);
```

Zagrożenia zabezpieczone:
- **SQL Injection** — parametryzowane zapytania Prisma + `$queryRaw` tagged template
- **NoSQL Injection** — Mongoose walidacja typów przed zapisem
- **Stack trace leak** — centralny error handler bez `err.stack` w odpowiedzi
- **Brute force** — rate limiting (429 z nagłówkami)
- **Self-follow** — blokada po stronie serwera (nie tylko frontend)

**Pytania potencjalne:**
- *"Jak chronisz przed SQL Injection?"* — Parametryzowane zapytania. Prisma nigdy nie sklejał stringów. `$queryRaw` jako tagged template.
- *"Dlaczego nie wysyłasz stack trace do klienta?"* — Ujawnia strukturę kodu, ścieżki plików, wersje bibliotek — pomaga atakującym.
- *"Co to rate limiting i po co?"* — Ogranicza liczbę żądań per IP/okno czasowe. Chroni przed brute force i DoS.

---

## F1 — Schemat PostgreSQL: users, follows, posts, reactions, comments

**Wymaganie:**
PostgreSQL: `users`; `follows` (follower, followee, unique); `posts` (author, body preview, created_at); `reactions` jako wiersze lub zliczenia aktualizowane transakcyjnie; `komentarze` z wątkiem (`parent_id`).

**Implementacja:**

Schemat — [backend/pg-service/prisma/schema.prisma](backend/pg-service/prisma/schema.prisma):

```prisma
model User {
  id        Int      @id @default(autoincrement())
  username  String   @unique
  email     String   @unique
  createdAt DateTime @default(now())
  -- Nowe pola (migracja 3):
  bio, avatarUrl, displayName, location, isVerified
  -- Relacje:
  posts, comments, reactions, followers, following
}

model Follow {
  followerId Int
  followeeId Int
  @@unique([followerId, followeeId])  -- Blokada duplikatów
  -- relacje do User (dwa FK do tej samej tabeli)
}

model Post {
  authorId    Int
  bodyPreview String @db.VarChar(255)  -- max 255 znaków
  createdAt   DateTime @default(now())
}

model Comment {
  parentId Int?    -- NULL = komentarz root, non-NULL = odpowiedź (wątek)
  -- Relacja self-referential:
  parent  Comment?  @relation("CommentThread", ...)
  replies Comment[] @relation("CommentThread")
  -- ON DELETE CASCADE (usunięcie posta = usunięcie komentarzy)
}

model Reaction {
  @@unique([postId, userId])  -- Jeden użytkownik = jedna reakcja na post
  type String  -- "like", "heart", "laugh", itp.
}
```

Reactions jako wiersze — każda reakcja to osobny wiersz. Upsert gwarantuje idempotentność:
```typescript
await prisma.reaction.upsert({
  where: { postId_userId: { postId, userId } },  // Unique constraint
  create: { postId, userId, type },
  update: { type }  // Zmiana typu reakcji
});
```

**Pytania potencjalne:**
- *"Dlaczego `@@unique([postId, userId])` w Reaction?"* — Jeden użytkownik może mieć tylko jedną reakcję na post (można ją zmienić, ale nie zduplikować).
- *"Jak działa `parent_id` w komentarzach?"* — NULL = komentarz główny. Non-NULL = odpowiedź na komentarz o danym ID. Rekurencja pozwala na dowolne zagnieżdżenie wątków.

---

## F2 — Schemat MongoDB: user_feed_entries, rich_posts, activity_daily

**Wymaganie:**
MongoDB: `user_feed_entries` (userId, postId, score, insertedAt); `rich_posts` (postId, attachments[], poll); `activity_daily` aggregates. Pipeline: top autorów tygodnia / rozkład reakcji (T7).

**Implementacja:**

Trzy modele Mongoose — [backend/mongo-service/src/models/](backend/mongo-service/src/models/):

**UserFeedEntry** — wpis feedu dla followera:
```typescript
{
  userId: Number,      // ID obserwującego (klucz paginacji)
  postId: Number,      // ID posta z PG
  score: Number,       // Wynik algorytmiczny 0-100
  insertedAt: Date     // Timestamp wstawienia
}
// Indeks złożony: { userId: 1, insertedAt: -1 }
```

**RichPost** — rozszerzone dane posta:
```typescript
{
  postId: Number,          // Referencja do PG Post.id
  authorId: Number,
  attachments: [           // Subdokument (tablica zagnieżdżona)
    { url: String, type: 'image'|'video'|'link' }
  ],
  poll: {                  // Opcjonalna ankieta
    question: String,
    options: [String]
  }
}
```

**ActivityDaily** — agregaty aktywności dziennej:
```typescript
{
  day: Date,                            // Data (truncated to day)
  authorId: Number,
  postsCreated: Number,                 // Liczba postów w tym dniu
  reactionsGiven: Map<string, number>   // { "like": 10, "heart": 5 }
}
// Indeks unique: { day: 1, authorId: 1 }
```

Pipeline top autorów tygodnia i rozkład reakcji opisane w T7 powyżej.

---

## F3 — API funkcjonalne: posty, follow, reakcje, feed z cursorem

**Wymaganie:**
Tworzenie postu, lista postów z filtrem (autor, hashtag). Follow/unfollow. Dodanie reakcji idempotentne. Pobranie feedu z cursorem.

**Implementacja:**

**Tworzenie posta** (POST /api/posts) — [backend/pg-service/src/postRoutes.ts](backend/pg-service/src/postRoutes.ts):
- Walidacja: `authorId` wymagany, `bodyPreview` max 255 znaków
- INSERT do PostgreSQL
- HTTP POST do mongo-service (fan-out feedu)
- Kompensacja przy błędzie mongo

**Lista postów z filtrem** (GET /api/posts):
```typescript
// Dynamiczny WHERE bez sklejania stringów
const where: Prisma.PostWhereInput = {};
if (authorId)  where.authorId = Number(authorId);
if (hashtag)   where.bodyPreview = { contains: `#${hashtag}`, mode: 'insensitive' };
// include: author (eager loading)
```

**Follow/Unfollow** (POST/DELETE /api/users/:id/follow):
```typescript
// Follow — z blokadą self-follow
if (followerId === followeeId) {
  return res.status(400).json({
    error: 'Bad Request', code: 'SELF_FOLLOW_NOT_ALLOWED',
    details: 'Nie możesz obserwować samego siebie.'
  });
}
await prisma.follow.create({ data: { followerId, followeeId } });
// 23505 → 409 Conflict (już obserwujesz)
```

**Reakcja idempotentna** (POST /api/posts/:id/reactions):
```typescript
// Upsert — ta sama operacja wielokrotnie daje ten sam wynik
await prisma.reaction.upsert({
  where: { postId_userId: { postId, userId } },
  create: { postId, userId, type },
  update: { type }  // Zmiana typu (nie duplikacja)
});
// Fire-and-forget do mongo (aktualizacja ActivityDaily stats)
```

**Feed z cursorem** (GET /api/feed/:userId?cursor=&limit=):
```typescript
// Cursor-based pagination — zamiast OFFSET używamy wartości insertedAt
const query: FilterQuery<IUserFeedEntry> = { userId };
if (cursor) {
  query.insertedAt = { $lt: new Date(cursor) };  // Dokumenty starsze niż cursor
}
const entries = await UserFeedEntry.find(query)
  .sort({ insertedAt: -1 })
  .limit(limit)
  .populate('richPost');  // Dołącza RichPost do każdego wpisu

// Następny cursor = insertedAt ostatniego elementu
const nextCursor = entries.length === limit
  ? entries[entries.length - 1].insertedAt.toISOString()
  : null;
```

**Pytania potencjalne:**
- *"Co to idempotentność reakcji?"* — Ta sama operacja wielokrotnie = ten sam efekt. `upsert` z unique constraint zapewnia, że `POST /reactions { type: "like" }` wywołany 10 razy da jeden "like".
- *"Dlaczego cursor zamiast OFFSET?"* — OFFSET `LIMIT 20 OFFSET 100` wymaga przeskanowania 120 dokumentów. Cursor (`WHERE insertedAt < X`) używa indeksu — O(log n) zamiast O(n). Przy dużych zbiorach danych cursor jest znacznie szybszy.

---

## F4 — Ograniczenia: self-follow, limit treści, kaskada, rate limit

**Wymaganie:**
Blokada self-follow. Limit długości treści. Usunięcie postu usuwa wpisy feedu (kaskada w Mongo lub job). Rate limit zwracany jako 429 z nagłówkiem lub kodem.

**Implementacja:**

**Blokada self-follow** — [backend/pg-service/src/userRoutes.ts](backend/pg-service/src/userRoutes.ts):
```typescript
if (followerId === followeeId) {
  return res.status(400).json({
    error: 'Bad Request', code: 'SELF_FOLLOW_NOT_ALLOWED',
    details: 'Nie możesz obserwować samego siebie.'
  });
}
```

**Limit długości treści** — walidacja + schemat Prisma:
```typescript
// Walidacja w trasie
if (!bodyPreview || bodyPreview.length > 255) { return 400 }
// Schemat Prisma
bodyPreview String @db.VarChar(255)  // PostgreSQL enforces at DB level
```

**Kaskadowe usuwanie feedu po usunięciu posta:**
1. PG: `ON DELETE CASCADE` w schema.prisma usuwa Comment i Reaction
2. Mongo: pg-service wysyła `DELETE /api/internal/rich-posts/:postId` do mongo-service
3. mongo-service usuwa RichPost + wszystkie UserFeedEntry dla tego posta:
```typescript
// mongo-service/internalRoutes.ts — DELETE /api/internal/rich-posts/:postId
await RichPost.deleteOne({ postId });
await UserFeedEntry.deleteMany({ postId });  // Kaskada w Mongo
```
Fire-and-forget (nie blokuje odpowiedzi DELETE /api/posts):
```typescript
fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts/${postId}`, { method: 'DELETE' })
  .catch(err => console.error('Błąd usuwania feedu:', err));
res.status(204).send();
```

**Rate limiting** (429 + nagłówki) — [backend/pg-service/src/index.ts](backend/pg-service/src/index.ts):
```typescript
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,   // RateLimit-Limit: 100, RateLimit-Remaining: 99, ...
  legacyHeaders: false,
  message: { error: 'Too Many Requests', code: 429, details: '...' }
}));
```
Odpowiedź 429 zawiera nagłówki `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

**Pytania potencjalne:**
- *"Usunięcie feedu jest fire-and-forget — co jeśli Mongo się nie powiedzie?"* — Feed będzie zawierał "zombie" wpisy (post usunięty z PG, wpis feedu pozostaje). Jest to świadomy trade-off: usunięcie posta jest natychmiastowe, czyszczenie feedu asynchroniczne. W systemie produkcyjnym byłby job naprawiający niespójności.
- *"Jakie nagłówki zwraca rate limiter?"* — `RateLimit-Limit` (max), `RateLimit-Remaining` (ile zostało), `RateLimit-Reset` (kiedy się zeruje).

---

## F5 — Fan-out: insert PG + rich + feed z kompensacją (T8c)

**Wymaganie:**
Utworzenie postu: insert PG + aktualizacja dokumentu rich + fan-out wpisów feedu dla obserwujących (uproszczony model) z kompensacją przy częściowym niepowodzeniu (T8c).

**Co to znaczy fan-out:**
Gdy użytkownik A publikuje post, wpis trafia do feedu KAŻDEGO z jego obserwujących. To "fan-out on write" — wpisujemy N dokumentów (jeden per follower) w momencie publikacji, dzięki czemu odczyt feedu jest O(1).

**Implementacja — pełny przepływ:**

Krok 1: pg-service pobiera followersów i zapisuje post:
```typescript
// 1. Zapis do PG
const createdPost = await prisma.post.create({ data: { authorId, bodyPreview } });

// 2. Pobierz followersów (kogo ma powiadomić)
const followers = await prisma.follow.findMany({
  where: { followeeId: authorId },
  select: { followerId: true }
});
const followerIds = followers.map(f => f.followerId);  // [101, 102, 103]
```

Krok 2: pg-service → mongo-service (HTTP POST):
```typescript
await fetch(`${MONGO_SERVICE_URL}/api/internal/rich-posts`, {
  method: 'POST',
  body: JSON.stringify({
    postId: createdPost.id,
    authorId,
    attachments: attachments || [],
    poll: poll || undefined,
    followerIds  // Lista ID użytkowników do fan-outu
  })
});
```

Krok 3: mongo-service wykonuje 3 operacje:
```typescript
// internalRoutes.ts — POST /api/internal/rich-posts
// 3a. Zapisz RichPost (rozszerzone dane)
await RichPost.create({ postId, authorId, attachments, poll });

// 3b. Fan-out: utwórz wpis feedu dla KAŻDEGO followera
const feedEntries = followerIds.map(userId => ({
  userId,     // Follower otrzymuje post
  postId,
  score: 1,   // Domyślny wynik algorytmiczny
  insertedAt: new Date()
}));
await UserFeedEntry.insertMany(feedEntries);  // Batch insert (efektywne)

// 3c. Aktualizuj statystyki aktywności (ActivityDaily)
const today = new Date(); today.setHours(0, 0, 0, 0);
await ActivityDaily.updateOne(
  { day: today, authorId },
  { $inc: { postsCreated: 1 } },
  { upsert: true }
);
```

Kompensacja jeśli Krok 2/3 się nie powiedzie:
```typescript
// Powrót do pg-service (catch blok):
if (createdPost) {
  await prisma.post.delete({ where: { id: createdPost.id } });
  // Post "znika" — klient widzi błąd, post nie istnieje
}
```

**Pytania potencjalne:**
- *"Co to fan-out on write vs fan-out on read?"* — On write: wpisujemy do feedu każdego followera przy publikacji (szybki odczyt, wolny zapis, problematyczne dla użytkowników z milionami followersów). On read: obliczamy feed przy odczycie na podstawie listy followersów (wolny odczyt, szybki zapis). My używamy uproszczonego on-write.
- *"Dlaczego `insertMany` zamiast pętli `create`?"* — `insertMany` to jeden roundtrip do MongoDB. Pętla `create` to N roundtripów. Dla 1000 followersów różnica jest znacząca.
- *"Jak działa kompensacja?"* — Używamy wzorca Saga. Jeśli operacja w Mongo się nie uda, "cofamy" operację w PG przez jawne DELETE. Nie ma 2-phase commit między różnymi silnikami baz danych.

---

## Podsumowanie Architektury

```
┌──────────────────────────────────────────────┐
│              Klient (port 8080)               │
│          Nginx API Gateway (reverse proxy)    │
│  CORS, healthcheck, routing per endpointu     │
└────────────┬─────────────────────┬────────────┘
             │                     │
             ▼                     ▼
   ┌──────────────────┐   ┌──────────────────┐
   │   pg-service     │   │  mongo-service   │
   │   (port 3001)    │   │  (port 3002)     │
   │                  │   │                  │
   │ Prisma ORM       │   │ Mongoose ODM     │
   │ Express routes   │──→│ Native MongoClient│
   │ Error handler    │   │ Aggregation      │
   │ Rate limiting    │   │ Feed + Analytics │
   └────────┬─────────┘   └────────┬─────────┘
            │                      │
            ▼                      ▼
   ┌──────────────────┐   ┌──────────────────┐
   │   PostgreSQL 15  │   │   MongoDB 6      │
   │                  │   │                  │
   │ User, Follow     │   │ RichPost         │
   │ Post, Comment    │   │ UserFeedEntry    │
   │ Reaction         │   │ ActivityDaily    │
   │ (ACID, relacyjne)│   │ system_logs      │
   └──────────────────┘   └──────────────────┘
```

**Wzorce architektoniczne użyte:**
- **Singleton** — PrismaClient, MongoClient, Mongoose connection
- **Saga (kompensacja)** — przy tworzeniu posta (T10, F5)
- **Fan-out on write** — wpisy feedu tworzone przy publikacji
- **Cursor-based pagination** — feed (nie OFFSET)
- **API Gateway** — Nginx jako single entry point
- **Fire-and-forget** — powiadomienia między serwisami (reaction, delete)
- **Aggregation pipeline** — analityka obliczana w bazie (nie w kodzie)

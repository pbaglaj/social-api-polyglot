# Bezpieczeństwo OAuth2 / OIDC — architektura, przepływy i demo

Warstwa bezpieczeństwa projektu: **Authorization Server (Keycloak)**, **Resource Server**
(mikroserwisy `pg-service`/`mongo-service` za API Gateway) oraz **trzech klientów OAuth2** o różnych
grant types. Dokument łączy opis architektury z gotowym scenariuszem demo do obrony.

## Cel i zakres

Wielomodułowy system (Docker Compose) z warstwą OAuth2/OIDC. Istniejące mikroserwisy social-network
pełnią rolę **Resource Servera** chronionego tokenami JWT. **Authorization Server** to **Keycloak**
(realm `SocialPolyglot`). Trzech klientów konsumuje API: **SPA** (PKCE), **SSR** (confidential) i
**M2M worker** (Client Credentials). Na wyższą ocenę: **cztery role** zamiast dwóch oraz integracja z
**Google** (Identity Brokering + Google Calendar).

## Komponenty i porty

| Komponent | Rola w OAuth2 | Host | Sieć docker |
|-----------|---------------|------|-------------|
| Keycloak | Authorization Server (OIDC) | `:8090` | `keycloak:8080` |
| API Gateway (nginx) | wejście do Resource Server | `:8080` | `api-gateway:80` |
| pg-service / mongo-service | Resource Server (walidacja JWT) | — | `:3001` / `:3002` |
| **frontend (SPA)** | Client #1 — Authorization Code **+ PKCE** | `:5173` | — (edge) |
| **ssr-client** | Client #2 — Authorization Code **(confidential)** | `:4000` | `ssr-client:4000` |
| **analytics-worker** | Client #3 — **Client Credentials** (M2M) | — | internal |
| `backend-admin` | klient techniczny → Keycloak Admin API | — | internal |

Realm: **`SocialPolyglot`** · discovery:
`http://localhost:8090/realms/SocialPolyglot/.well-known/openid-configuration`
Userzy testowi: **`admin/admin`** (Admin+User), **`user/user`** (User), **`mod/mod`** (Moderator+User).
Sekrety klientów: `ssr-client-secret`, `b2b-client-secret`, `backend-admin-secret`.

## Role (realm roles)

| Rola | Kto | Uprawnienia |
|------|-----|-------------|
| `User` | użytkownicy (domyślna) | feed, własne posty, reakcje, komentarze, follow |
| `Moderator` | moderacja | jak User + kasowanie dowolnych postów, `attach` tagów |
| `Admin` | administracja | pełny dostęp + tworzenie tagów + zarządzanie userami (Keycloak Admin API) |
| `analytics` | konto serwisowe M2M | **wyłącznie** endpointy `/api/analytics/*` |

## Klienci (least-privilege — każdy pod swój flow)

| Klient | `publicClient` | Auth Code | PKCE | Client Credentials | Uprawnienia |
|--------|:---:|:---:|:---:|:---:|-------------|
| `spa-client` | ✅ public | ✅ | ✅ S256 | ❌ | role zalogowanego usera |
| `ssr-client` | ❌ confidential | ✅ | ❌ | ✅ (SA) | SA: rola `User` |
| `b2b-client` | ❌ confidential | ❌ | ❌ | ✅ | SA: **tylko** `analytics` |
| `backend-admin` | ❌ confidential | ❌ | ❌ | ✅ | SA: `realm-management` (zarządzanie userami) |

> Pointa: SPA (publiczny) nie ma sekretu ani password-grant — tylko PKCE. Worker nie ma żadnego
> flow interaktywnego — tylko Client Credentials i **wyłącznie** rolę `analytics`.

## Przepływy per klient

### Client #1 — SPA (Authorization Code + PKCE) — `apps/frontend/`
React + Vite, `react-oidc-context`. Token w przeglądarce (localStorage). UI po angielsku.
1. „Sign in with Keycloak" → `signinRedirect()` → Keycloak (`:8090`).
2. Powrót na `http://localhost:5173/?code=…`; biblioteka wymienia `code` na token (PKCE, bez sekretu).
3. Każde wywołanie API dokleja `Authorization: Bearer <access_token>` (`src/api.ts`).
4. UI ukrywa akcje wg ról (`useWhoami` → `GET /api/admin/me`): Admin panel i tworzenie tagów tylko dla `Admin`.
5. Sekcja „Google Calendar" woła `GET /api/google/calendar` (Faza 4) po zalogowaniu kontem Google.

### Client #2 — SSR (Authorization Code, confidential) — `apps/ssr-client/`
Express + EJS. **Tokeny nigdy nie trafiają do przeglądarki** — żyją w sesji serwera (`express-session`, cookie httpOnly).
- `GET /login` → 302 na Keycloak (front-channel, host `:8090`).
- `GET /callback` → wymiana `code`→token **back-channel** na internal `keycloak:8080` z `client_secret`.
- Landing (`/`): dane publiczne tokenem **service-accountu** (`ssr-client`, rola `User`). Dashboard (`/dashboard`): dane usera.
- `GET /logout` → czyszczenie sesji + RP-initiated logout.

### Client #3 — M2M worker (Client Credentials) — `apps/backend/analytics-worker/`
Skrypt Node bez UI. Pobiera token przez `grant_type=client_credentials` (`b2b-client`) na `keycloak:8080`,
cyklicznie (domyślnie co 60 s) agreguje `/api/analytics/{trending,top-authors-weekly,reaction-distribution}`.
Retry na starcie, re-fetch tokenu przy `401`, graceful shutdown na `SIGTERM`. **Dowód least-privilege:**
na starcie loguje próbę `GET /api/feed/1` → oczekiwane `403`.

## Walidacja JWT w Resource Server

Middleware `src/middlewares/auth.ts` w obu serwisach (biblioteka **`jose`**):
- Klucze publiczne z **JWKS** (`KEYCLOAK_JWKS_URI`, internal `keycloak:8080`), cache + rotacja po `kid`.
- **Multi-issuer allowlist** (`KEYCLOAK_ALLOWED_ISSUERS`): akceptujemy `localhost:8090` (SPA/przeglądarka)
  i `keycloak:8080` (M2M/SSR z sieci wewnętrznej) — ten sam realm, te same klucze.
- `requireAuth` weryfikuje podpis/issuer/expiry; `requireRole(...)` sprawdza `realm_access.roles` (RBAC).
- **JIT provisioning** (`provisionUser`, pg-service): mapuje `sub` z JWT na lokalny `User.id` (int),
  dolinkowując pre-seedowane konta po username/email. Kontrolery używają `req.appUser.id`, nie ID z body.
- **Tryb testowy:** przy `NODE_ENV=test` auth jest pass-through (`ENFORCE=false`).

### Mapa RBAC (skrót)

| Endpoint | Wymagana rola |
|----------|---------------|
| `/api/posts/*`, `/api/users/*`, `/api/stats/*`, `/api/notifications/*` | `User`/`Admin`/`Moderator` |
| `GET /api/tags` | `User`+ · `POST /api/tags` | `Admin` · `POST /api/tags/attach` | `Admin`/`Moderator` |
| `/api/admin/*` (oprócz `/me`) | `Admin` |
| `/api/feed/:userId` | `User`/`Admin`/`Moderator` |
| `/api/analytics/*` | `analytics`/`User`/`Admin`/`Moderator` |
| `/api/internal/*` (mongo-service) | brak auth — ruch serwis↔serwis, niewystawiony przez gateway |

## Zarządzanie użytkownikami przez backend (Admin REST API)

`pg-service` deleguje operacje do **Keycloak Admin REST API** klientem `backend-admin` (Client
Credentials). Komponent API sam waliduje tokeny klientów (JWKS, `jose`) — wszystkie endpointy poniżej
wymagają roli `Admin`.

| Funkcja | Endpoint | Delegacja do Keycloak |
|---------|----------|-----------------------|
| Lista userów | `GET /api/admin/users` | `GET /users` |
| **Zakładanie konta + rola** | `POST /api/admin/users` (`roles[]`) | `POST /users` + `role-mappings/realm` |
| Nadanie/odebranie roli | `POST`/`DELETE /api/admin/users/:id/roles` | `role-mappings/realm` |
| Reset hasła (admin ustawia) | `PUT /api/admin/users/:id/password` | `PUT /users/:id/reset-password` |
| **Odzyskiwanie hasła (recovery)** | `POST /api/admin/users/:id/recover-password` | `execute-actions-email [UPDATE_PASSWORD]`, a bez SMTP fallback na `requiredActions` |
| **Włączenie 2FA/MFA (TOTP)** | `POST /api/admin/users/:id/mfa` | `requiredActions [CONFIGURE_TOTP]` (+ mail jeśli SMTP) |
| Wyłączenie 2FA/MFA | `DELETE /api/admin/users/:id/mfa` | usuwa poświadczenia `otp` + zdejmuje `requiredActions` |

`recover-password` i `mfa` działają **bez skonfigurowanego SMTP** — wymuszają akcję (`UPDATE_PASSWORD` /
`CONFIGURE_TOTP`) przy najbliższym logowaniu na natywnym ekranie Keycloak; gdy SMTP jest ustawiony,
dodatkowo wychodzi mail z linkiem. Polityka TOTP (`otpPolicyType: totp`) jest zdefiniowana w realmie.

## Faza 4 — Google Identity Brokering + Calendar (działa, zweryfikowane E2E)

`GET /api/google/calendar` (`googleController.ts` + `services/googleBroker.ts`): pobiera Google Access
Token z Keycloak Broker API (tokenem zalogowanego usera) i woła Google Calendar API, mapując wydarzenia
na pozycje feedu. W SPA panel „Google Calendar" (`components/GoogleCalendar.tsx`). Brak logowania przez
Google / brak konfiguracji IdP → `503 GOOGLE_NOT_CONFIGURED` (nie 500).

Realm ma IdP `google` z `enabled:true`, `storeToken:true`, `addReadTokenRoleOnCreate:true`;
`clientId`/`clientSecret` to placeholdery `${GOOGLE_CLIENT_ID}`/`${GOOGLE_CLIENT_SECRET}` podstawiane
przy imporcie ze zmiennych środowiskowych kontenera keycloak (z `.env`).

Najczęstsze powody „Google nie działa mimo wpisanych creds":
- **Zmienne nie docierają do kontenera Keycloak** → placeholder zostaje dosłowny. Compose przekazuje teraz `GOOGLE_CLIENT_ID/SECRET` do usługi `keycloak`.
- **Realm importuje się tylko raz** (`IGNORE_EXISTING`) — po zmianie `.env`/`realm-export.json` potrzebny czysty re-import (niżej).
- **Brak roli `broker read-token`** → broker API zwraca `400` → `503`. Daje ją flaga IdP `addReadTokenRoleOnCreate:true`;
  konta powiązane z Google **przed** dodaniem flagi trzeba doposażyć ręcznie i zalogować ponownie.
- **Niezgodność issuera (host↔internal)** → `googleBroker.ts` odtwarza origin nagłówkami `X-Forwarded-*`
  (z claimu `iss` zwalidowanego tokenu); Keycloak z `KC_PROXY_HEADERS=xforwarded` im ufa.
- **Brak egressu** → `fetch failed (EAI_AGAIN)` → `500`. Sieć `internal` ma `internal:true`, więc `pg-service` jest też w sieci `edge` (wyjście do `googleapis.com`).

**Aktywacja (wymaga Twoich credentials):**
1. Google Cloud Console → OAuth 2.0 Client (Web), redirect URI `http://localhost:8090/realms/SocialPolyglot/broker/google/endpoint`, scope m.in. `calendar.readonly`.
2. Wpisz `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` w `apps/backend/.env` (nie w realmie — tam placeholdery).
3. Czysty re-import realmu, zaloguj się przez Google, wywołaj endpoint.

---

## Uruchomienie

```bash
cd apps/backend
cp .env.example .env                 # zawiera GOOGLE_CLIENT_ID/SECRET dla IdP
cp secrets/postgres_password.txt.example secrets/postgres_password.txt
cp secrets/mongo_password.txt.example    secrets/mongo_password.txt
docker compose up -d --build         # gateway :8080, keycloak :8090, SPA :5173, SSR :4000
docker compose ps                    # ~40 s na Keycloak
```

> Czysty re-import realmu (po edycji `realm-export.json`/`.env`):
> `docker compose rm -sfv keycloak keycloak-db && docker volume rm backend_keycloakdata && docker compose up -d keycloak`

## Scenariusz DEMO (~10 min, każdy krok = jedno wymaganie)

1. **AS żyje:** `http://localhost:8090` → `admin/admin` (realm master) → realm `SocialPolyglot` →
   pokaż Clients (4), Realm roles (4), Users, Identity providers (`google`); discovery `.well-known/openid-configuration`.
2. **RS waliduje tokeny:**
   ```bash
   GW=http://localhost:8080
   curl -s -o /dev/null -w "brak=%{http_code}\n" $GW/api/analytics/trending                                  # 401
   curl -s -o /dev/null -w "zly=%{http_code}\n" -H "Authorization: Bearer abc.def.ghi" $GW/api/analytics/trending  # 401
   ```
3. **Client #3 M2M + least-privilege:**
   ```bash
   KC=http://localhost:8090; GW=http://localhost:8080
   B2B=$(curl -s -X POST $KC/realms/SocialPolyglot/protocol/openid-connect/token \
     -d grant_type=client_credentials -d client_id=b2b-client -d client_secret=b2b-client-secret \
     | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
   curl -s -o /dev/null -w "analytics=%{http_code}\n" -H "Authorization: Bearer $B2B" $GW/api/analytics/trending  # 200
   curl -s -o /dev/null -w "feed=%{http_code}\n"      -H "Authorization: Bearer $B2B" $GW/api/feed/1             # 403
   docker compose logs analytics-worker   # cykliczne raporty + feed=403 na starcie
   ```
4. **Client #1 SPA (PKCE) + RBAC:** `:5173` → login `user/user` (w DevTools pokaż wymianę `code`→token bez
   `client_secret`) → CRUD (post, reakcja, komentarz, follow, feed, statystyki). Wyloguj, `admin/admin` → pojawia się Admin panel + tworzenie tagów.
5. **Zarządzanie userami przez AS:** panel Admina SPA (lub curl tokenem admina) → `POST /api/admin/users`,
   `POST/DELETE /api/admin/users/:id/roles`, `PUT /api/admin/users/:id/password`,
   `POST /api/admin/users/:id/recover-password` (odzyskiwanie hasła),
   `POST` / `DELETE /api/admin/users/:id/mfa` (włącz/wyłącz 2FA-TOTP) — wszystko delegowane do Keycloak Admin API.
6. **Client #2 SSR (confidential):** `:4000` → landing (token SA) → `/login` → `/dashboard` (token usera).
   Pointa: tokeny w sesji serwera, wymiana `code`→token back-channel z sekretem.
7. **Wyższa ocena — Google:** w SPA zaloguj się **przez Google** (Identity Brokering) → panel „Google Calendar" →
   „Get upcoming events" → `200 { source, count, events[] }`.

## Szybka weryfikacja (PowerShell, Windows)

```powershell
$KC="http://localhost:8090"; $GW="http://localhost:8080"
$tok = (Invoke-RestMethod -Method Post "$KC/realms/SocialPolyglot/protocol/openid-connect/token" `
  -Body @{ grant_type='client_credentials'; client_id='b2b-client'; client_secret='b2b-client-secret' }).access_token
$H = @{ Authorization = "Bearer $tok" }
(Invoke-WebRequest "$GW/api/analytics/trending" -Headers $H).StatusCode   # 200
try { Invoke-WebRequest "$GW/api/feed/1" -Headers $H } catch { $_.Exception.Response.StatusCode.value__ }  # 403
```

**Macierz oczekiwanych kodów:**

| Żądanie | Wynik | Dowód |
|---------|:-----:|-------|
| `/api/analytics/trending` bez tokenu | `401` | walidacja tokenu działa |
| `/api/analytics/trending` token b2b | `200` | M2M ma swój zakres |
| `/api/feed/1` token b2b | `403` | least-privilege (RBAC) |
| `/api/posts` token usera | `2xx` | rola `User` ma CRUD |
| `/api/admin/users` token usera | `403` | tylko Admin zarządza userami |
| `/api/admin/users` token admina | `200` | delegacja do Keycloak Admin API |

**Testy automatyczne** (auth pass-through przy `NODE_ENV=test`):
```bash
cd apps/backend/pg-service    && npm test
cd apps/backend/mongo-service && npm test
```

> Tokeny użytkownika zdobywa się przez przeglądarkę — `spa-client` ma celowo wyłączony Direct Access
> Grants (least-privilege). Do testów CLI ról człowieka można tymczasowo włączyć password-grant w panelu i cofnąć.

## Mapa wymagań → realizacja

| Wymaganie | Status | Gdzie |
|-----------|--------|-------|
| Resource Server (CRUD API) | ✅ | `/api/posts,users,tags,feed,…` przez gateway `:8080` |
| ≥ 2 role | ✅ **4 role** (Admin, User, Moderator, analytics) | realm-export.json; `requireRole(...)` |
| API waliduje tokeny (klucze serwera) | ✅ JWKS (`jose`) | `*/src/middlewares/auth.ts` |
| Zarządzanie userami przez AS (+ rola, reset, MFA) | ✅ | backend → Keycloak Admin API: `POST /api/admin/users`, `…/roles`, `…/password`, `…/recover-password`, `…/mfa` |
| Client #1 SPA (wszystkie endpointy) | ✅ React+Vite, PKCE | `apps/frontend/` |
| Client #2 SSR (wybrane endpointy) | ✅ Express+EJS, confidential | `apps/ssr-client/` |
| Client #3 B2B/M2M (wybrane endpointy) | ✅ Client Credentials | `apps/backend/analytics-worker/` |
| Keycloak jako AS; minimalne uprawnienia per klient | ✅ least-privilege | tabela klientów wyżej |
| API zewnętrzne chronione OAuth2 (wyższa ocena) | ✅ Google Identity Brokering + Calendar | `/api/google/calendar` |

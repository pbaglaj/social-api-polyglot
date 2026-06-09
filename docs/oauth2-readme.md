# Bezpieczeństwo OAuth2 / OIDC — architektura i przepływy

Dokument opisuje warstwę bezpieczeństwa projektu: **Authorization Server (Keycloak)**,
**Resource Server** (mikroserwisy `pg-service` / `mongo-service` za API Gateway) oraz
**trzech klientów OAuth2** o różnych grant types. Realizuje wymagania z
`project-oauth2-security.md`.

## Komponenty i porty

| Komponent | Rola w OAuth2 | Adres (host) | Adres (sieć docker) |
|-----------|---------------|--------------|----------------------|
| Keycloak | Authorization Server (OIDC) | `http://localhost:8090` | `http://keycloak:8080` |
| API Gateway (nginx) | wejście do Resource Server | `http://localhost:8080` | `http://api-gateway:80` |
| pg-service | Resource Server | — | `http://pg-service:3001` |
| mongo-service | Resource Server | — | `http://mongo-service:3002` |
| **frontend (SPA)** | Client #1 (PKCE) | `http://localhost:5173` | — (edge) |
| **ssr-client** | Client #2 (confidential) | `http://localhost:4000` | `http://ssr-client:4000` |
| **analytics-worker** | Client #3 (M2M) | — (internal) | — |

Realm: **`SocialPolyglot`**. OIDC discovery:
`http://localhost:8090/realms/SocialPolyglot/.well-known/openid-configuration`.

## Role (realm roles)

| Rola | Kto | Uprawnienia |
|------|-----|-------------|
| `User` | użytkownicy (domyślna przy rejestracji) | feed, posty (własne), reakcje, komentarze, follow |
| `Moderator` | moderacja | jak User + kasowanie dowolnych postów, `attach` tagów |
| `Admin` | administracja | pełny dostęp + tworzenie tagów + zarządzanie userami (Keycloak Admin API) |
| `analytics` | konto serwisowe M2M | **wyłącznie** endpointy `/api/analytics/*` |

## Klienci OAuth2 (least-privilege, każdy pod swój flow)

| Klient | Typ | Grant / Flow | Sekret | Uprawnienia |
|--------|-----|--------------|--------|-------------|
| `spa-client` | public | **Authorization Code + PKCE (S256)** | — | role zalogowanego użytkownika |
| `ssr-client` | confidential | **Authorization Code** (+ service account) | `ssr-client-secret` | SA: rola `User` (dane publiczne) |
| `b2b-client` | confidential | **Client Credentials** | `b2b-client-secret` | SA: **tylko** `analytics` |
| `backend-admin` | confidential | **Client Credentials** | `backend-admin-secret` | SA: `realm-management` (manage/view users) |

## Przepływy per klient

### Client #1 — SPA (Authorization Code + PKCE) — `apps/frontend/`
React + Vite, biblioteka `react-oidc-context`. Token żyje w przeglądarce (localStorage).
**UI w języku angielskim, bez emoji.** Wykorzystuje wszystkie endpointy API (wymóg projektu).

**Układ (app-shell w stylu Facebooka):** górny pasek (logo → Home, chipy ról, awatar →
mój profil, „Log out") + lewa nawigacja przełączająca sekcje. Centralna kolumna z kartami.
- Główne: **Home** (composer „What's on your mind?" + lista postów: reakcje, wątki
  komentarzy, kasowanie), **Your feed** (mongo, paginacja kursorowa), **Users** (follow),
  **My profile**.
- **Tools:** Tags, Notifications, Stats, Analytics, Google Calendar oraz **Admin panel**
  (tylko `Admin`).
- **Profil użytkownika** (klik w usera w liście / w autora posta lub komentarza, albo awatar
  w pasku): nagłówek z licznikami **Posts / Followers / Following / Reactions**
  (`GET /api/stats/user/:id`) + posty danej osoby (`GET /api/posts?authorId=`) + follow.
- Listy użytkowników i postów pokazują domyślnie 10 pozycji z przyciskiem **„Show more"**.

Przepływ logowania:
1. Użytkownik klika „Sign in with Keycloak" → `signinRedirect()` → przeglądarka leci na
   Keycloak (`:8090`).
2. Po zalogowaniu Keycloak wraca na `http://localhost:5173/?code=…`; biblioteka wymienia
   `code` na token (PKCE — bez sekretu, bo klient publiczny).
3. Każde wywołanie API dokleja `Authorization: Bearer <access_token>` (patrz `src/api.ts`).
4. UI ukrywa akcje wg ról (`useWhoami` → `GET /api/admin/me`): Admin panel i tworzenie
   tagów tylko dla `Admin`, `attach` dla `Admin`/`Moderator`.
5. Sekcja **„Google Calendar"** woła `GET /api/google/calendar` (Faza 4) — działa po
   zalogowaniu kontem Google na ekranie Keycloak (Identity Brokering).

### Client #2 — SSR (Authorization Code, confidential) — `apps/ssr-client/`
Express + EJS. **Tokeny nigdy nie trafiają do przeglądarki** — żyją w sesji serwera
(`express-session`, cookie httpOnly).
- `GET /login` → 302 na Keycloak (front-channel, **host** URL `:8090`).
- `GET /callback` → wymiana `code`→token **back-channel** na **internal** URL
  `keycloak:8080` z `client_secret`. Token zapisany w sesji.
- Landing (`/`): dane publiczne pobierane tokenem **service-accountu** (`ssr-client`,
  Client Credentials, rola `User`). Dashboard (`/dashboard`): dane spersonalizowane
  tokenem **użytkownika**.
- `GET /logout` → czyszczenie sesji + RP-initiated logout.

> Dwa adresy Keycloaka są celowe: przeglądarka musi widzieć `localhost:8090`, a serwer w
> sieci docker rozmawia po `keycloak:8080`. Tokeny z obu issuerów są akceptowane (niżej).

### Client #3 — M2M worker (Client Credentials) — `apps/backend/analytics-worker/`
Skrypt Node bez UI. Pobiera token przez `grant_type=client_credentials`
(`b2b-client` + sekret) na `keycloak:8080`, cyklicznie (domyślnie co 60 s) agreguje
`/api/analytics/{trending,top-authors-weekly,reaction-distribution}` z mongo-service.
- Retry na starcie (czeka aż Keycloak wstanie), re-fetch tokenu przy `401`, graceful
  shutdown na `SIGTERM`.
- **Dowód least-privilege:** na starcie loguje próbę `GET /api/feed/1` → oczekiwane `403`
  (rola `analytics` nie ma wstępu do feedu użytkownika).

## Walidacja JWT w Resource Server

Middleware `src/middlewares/auth.ts` w obu serwisach (biblioteka **`jose`**):
- Klucze publiczne pobierane z **JWKS** (`KEYCLOAK_JWKS_URI`, internal `keycloak:8080`),
  cache + rotacja po `kid`.
- **Multi-issuer allowlist** (`KEYCLOAK_ALLOWED_ISSUERS`): akceptujemy zarówno
  `http://localhost:8090/realms/SocialPolyglot` (tokeny z przeglądarki/SPA) jak i
  `http://keycloak:8080/realms/SocialPolyglot` (tokeny M2M/SSR z sieci wewnętrznej) — ten
  sam realm, te same klucze podpisujące.
- `requireAuth` weryfikuje podpis/issuer/expiry; `requireRole(...)` sprawdza
  `realm_access.roles` (RBAC).
- **JIT provisioning** (`provisionUser`, pg-service): mapuje `sub` z JWT na lokalny
  `User.id` (int), dolinkowując pre-seedowane konta po username/email. Kontrolery używają
  `req.appUser.id` zamiast ID z body — użytkownik działa tylko we własnym imieniu.
- **Tryb testowy:** przy `NODE_ENV=test` auth jest pass-through (`ENFORCE=false`), więc
  testy jednostkowe nie wymagają realnych tokenów.

## Mapa RBAC (skrót)

| Endpoint | Wymagana rola |
|----------|---------------|
| `/api/posts/*`, `/api/users/*`, `/api/stats/*`, `/api/notifications/*` | `User`/`Admin`/`Moderator` |
| `/api/tags` (GET) | `User`+ |
| `POST /api/tags` | `Admin` |
| `POST /api/tags/attach` | `Admin`/`Moderator` |
| `/api/admin/*` (oprócz `/me`) | `Admin` |
| `/api/feed/:userId` | `User`/`Admin`/`Moderator` |
| `/api/analytics/*` | `analytics`/`User`/`Admin`/`Moderator` |
| `/api/google/calendar` (szkielet) | `User`+ |
| `/api/internal/*` (mongo-service) | brak auth — ruch serwis↔serwis, niewystawiony przez gateway |

## Zarządzanie użytkownikami przez backend (Admin REST API)

`pg-service` deleguje operacje do **Keycloak Admin REST API** klientem `backend-admin`
(Client Credentials). Endpointy `/api/admin/users*`: lista, zakładanie konta z rolami,
nadawanie/odbieranie ról, reset hasła. Funkcje rejestracji, resetu hasła i **MFA/TOTP** są
włączone w realmie i obsługiwane na natywnych ekranach Keycloak.

## Faza 4 — Google Identity Brokering + Calendar (DZIAŁA, zweryfikowane E2E)

Endpoint `GET /api/google/calendar` (`googleController.ts` + `services/googleBroker.ts`):
pobiera Google Access Token z Keycloak Broker API (tokenem zalogowanego użytkownika) i
woła Google Calendar API, mapując nadchodzące wydarzenia na pozycje feedu. W SPA jest panel
**„Google Calendar"** (`components/GoogleCalendar.tsx`). Gdy user nie zalogował się przez
Google / IdP nie jest skonfigurowany → `503 GOOGLE_NOT_CONFIGURED` (nie 500).

Zweryfikowane E2E: po zalogowaniu przez Google `GET /api/google/calendar` przez gateway
zwraca `200` z realnymi wydarzeniami (`{ source, count, events[] }`).

Realm ma już IdP `google` z `enabled:true`, `storeToken:true`,
`addReadTokenRoleOnCreate:true`, a `clientId`/`clientSecret` to **placeholdery**
`${GOOGLE_CLIENT_ID}` / `${GOOGLE_CLIENT_SECRET}` podstawiane przy imporcie ze **zmiennych
środowiskowych kontenera keycloak** (przekazywanych z `.env` w `docker-compose.yml`).
Najczęstsze powody „Google nie działa mimo wpisanych creds":
- **Zmienne nie docierały do kontenera Keycloak** → placeholder zostaje dosłowny
  (`clientId = ${GOOGLE_CLIENT_ID}`), Google odrzuca logowanie. Compose przekazuje teraz
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` do usługi `keycloak`.
- **Realm importuje się tylko raz** (strategia `IGNORE_EXISTING`). Po zmianie `.env` lub
  `realm-export.json` zmiany **nie wejdą** dopóki nie zrobisz czystego re-importu (niżej).
- **Brak roli `broker read-token`** → broker token API zwraca `400`, więc endpoint daje
  `503 GOOGLE_NOT_CONFIGURED` mimo poprawnego logowania przez Google. Aby SPA mogła odczytać
  zapisany token Google, token użytkownika musi zawierać rolę `read-token` klienta `broker`.
  Daje ją flaga IdP **`addReadTokenRoleOnCreate:true`** („Stored Tokens Readable") — jest już
  w `realm-export.json`, więc po **czystym re-imporcie** nowo powiązani użytkownicy dostają ją
  automatycznie. Konta powiązane z Google **przed** dodaniem flagi trzeba doposażyć ręcznie
  (Keycloak Admin → user → Role mapping → assign client role `broker read-token`) i ponownie
  zalogować, żeby świeży token zawierał tę rolę.
- **Niezgodność issuera (host↔internal)** → broker token API odrzuca token jako „Invalid
  token" (`400`) → znów `503`. Token SPA ma issuer publiczny (`localhost:8090`), a backend
  woła broker po sieci docker (`keycloak:8080`), gdzie Keycloak wylicza issuer z hosta
  żądania. `googleBroker.ts` odtwarza więc oryginalny origin nagłówkami `X-Forwarded-*`
  (z claimu `iss` zwalidowanego już tokenu) — Keycloak z `KC_PROXY_HEADERS=xforwarded` im ufa.
- **Brak egressu do internetu** → wywołanie Google Calendar API rzuca `fetch failed`
  (`EAI_AGAIN`) → `500`. Sieć `internal` ma `internal:true` (brak NAT), więc `pg-service`
  jest też w sieci `edge`, która daje wyjście na zewnątrz do `googleapis.com`.

**Aktywacja (wymaga Twoich credentials):**
1. Google Cloud Console → OAuth 2.0 Client (typ Web), authorized redirect URI:
   `http://localhost:8090/realms/SocialPolyglot/broker/google/endpoint`. Scope m.in.
   `https://www.googleapis.com/auth/calendar.readonly`.
2. Wpisz `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` w `apps/backend/.env`
   (realm-export.json używa ich jako placeholderów — nie wpisuj sekretu w realmie).
3. Czysty re-import realmu (patrz niżej), zaloguj się przez Google, wywołaj endpoint.
   Weryfikacja podstawienia:
   `GET {KC}/admin/realms/SocialPolyglot/identity-provider/instances/google` → `clientId`
   powinien być realnym `...apps.googleusercontent.com`, nie `${GOOGLE_CLIENT_ID}`.

## Uruchomienie i smoke test

```bash
cd apps/backend
cp .env.example .env                 # env (m.in. GOOGLE_CLIENT_ID/SECRET)
# Pliki secrets/*.txt są gitignorowane — po świeżym clone trzeba je odtworzyć,
# inaczej Postgres/Mongo nie wystartują (a za nimi api-gateway/frontend):
cp secrets/postgres_password.txt.example secrets/postgres_password.txt
cp secrets/mongo_password.txt.example    secrets/mongo_password.txt
docker compose up -d --build         # gateway :8080, keycloak :8090, SPA :5173, SSR :4000
```

Czysty re-import realmu (gdy zmieniasz `realm-export.json` — strategia `IGNORE_EXISTING`):
```bash
docker compose rm -sfv keycloak keycloak-db && docker volume rm backend_keycloakdata
docker compose up -d keycloak
```

Test M2M (bez przeglądarki):
```bash
KC=http://localhost:8090; GW=http://localhost:8080
TOKEN=$(curl -s -X POST $KC/realms/SocialPolyglot/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=b2b-client -d client_secret=b2b-client-secret \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -o /dev/null -w "analytics=%{http_code}\n" -H "Authorization: Bearer $TOKEN" $GW/api/analytics/trending  # 200
curl -s -o /dev/null -w "feed=%{http_code}\n"      -H "Authorization: Bearer $TOKEN" $GW/api/feed/1             # 403
```

- **SPA:** `http://localhost:5173` → zaloguj (`user/user` lub `admin/admin`) → CRUD; Admin
  panel widoczny tylko dla `admin`.
- **SSR:** `http://localhost:4000` → landing (publiczne dane) + `/login` → dashboard.
- **Worker:** `docker compose logs analytics-worker` → raporty analityczne + `feed=403`.
- **Google Calendar:** zaloguj się w SPA **przez Google** (ekran Keycloak → „Google") →
  sekcja „Google Calendar" → „Get upcoming events" → lista wydarzeń (`200`).

Userzy testowi w realmie: `admin/admin` (Admin+User), `user/user` (User),
`mod/mod` (Moderator+User).

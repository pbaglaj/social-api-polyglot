# OAuth2 / Keycloak — postęp i kontekst do kontynuacji

> Plik roboczy. Wymagania źródłowe: `project-oauth2-security.md` (linie 1–9 = wymagania, 13+ = plan faz).
> Branch: `project/oauth2-security`. Ostatnia aktualizacja: 2026-06-03.

## TL;DR — gdzie jesteśmy

| Faza | Zakres | Status |
|------|--------|--------|
| **1** | Keycloak + import realm `SocialPolyglot` | ✅ DONE, zweryfikowane |
| **2** | Resource Server: walidacja JWT + RBAC + zarządzanie userami (Keycloak Admin REST API) | ✅ DONE, zweryfikowane E2E |
| **3a** | Client SPA (React + Vite, PKCE) | 🟡 W TRAKCIE — scaffolding (package.json, vite, tsconfig, index.html). Brakuje kodu React. |
| **3b** | Client SSR (Express + EJS, Authorization Code confidential) | ⬜ TODO |
| **3c** | Client M2M (`apps/backend/analytics-worker`, Client Credentials) | ⬜ TODO |
| **4** | Google Identity Brokering + Google Calendar w feedzie | ⬜ TODO (wymaga Twoich Google OAuth credentials) |
| **5** | Gateway/docs/testy E2E, ewentualnie k8s dla Keycloak | ⬜ TODO |

Lista zadań żyje też w narzędziu Task (TaskList) — ID 1–7 odpowiadają fazom.

---

## Jak uruchomić (stan obecny)

```bash
# .env i sekrety są gitignorowane — lokalnie JUŻ utworzone:
#   apps/backend/.env (kopia .env.example)
#   apps/backend/secrets/postgres_password.txt = "secret"
#   apps/backend/secrets/mongo_password.txt    = "secret"

cd apps/backend
docker compose up -d          # Keycloak gotowy po ~40s
```

- **Keycloak panel:** http://localhost:8090  (admin / admin — bootstrap admin, realm `master`)
- **Realm aplikacji:** `SocialPolyglot`, OIDC discovery: http://localhost:8090/realms/SocialPolyglot/.well-known/openid-configuration
- **API Gateway (nginx):** http://localhost:8080
- **Userzy testowi w realmie:** `admin/admin` (role Admin+User), `user/user` (User), `mod/mod` (Moderator+User)

### Szybki test RBAC (M2M, nie wymaga przeglądarki)
```bash
KC=http://localhost:8090; GW=http://localhost:8080
B2B=$(curl -s -X POST $KC/realms/SocialPolyglot/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=b2b-client -d client_secret=b2b-client-secret \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -o /dev/null -w "analytics=%{http_code}\n" -H "Authorization: Bearer $B2B" $GW/api/analytics/trending  # 200
curl -s -o /dev/null -w "feed=%{http_code}\n"      -H "Authorization: Bearer $B2B" $GW/api/feed/1             # 403
```

> Tokeny **użytkownika** (user/admin) zdobywa się przez przeglądarkę (Authorization Code + PKCE).
> `spa-client` ma **wyłączony** Direct Access Grants (zgodnie z least-privilege). Do testów CLI można
> tymczasowo włączyć go w panelu i cofnąć — patrz „Pułapki" niżej.

---

## Architektura bezpieczeństwa — kluczowe decyzje

### Keycloak (Authorization Server)
- Obraz `quay.io/keycloak/keycloak:26.1`, `start-dev --import-realm`, osobna baza `keycloak-db` (Postgres, wolumen `keycloakdata`).
- Sieci: `edge` (port 8090 na hosta dla przeglądarki) + `internal` (jako `keycloak:8080` dla backendu).
- Realm + role + klienci + userzy importowani z **`apps/backend/keycloak/realm-export.json`**.
- Włączone out-of-the-box: rejestracja, reset hasła, OTP/TOTP (MFA), `rememberMe`. `verifyEmail=false` (brak SMTP — można dołożyć `smtpServer`).

### Klienci OAuth2 (każdy minimalny pod swój flow)
| Klient | Typ / Flow | Uprawnienia | Sekret |
|--------|-----------|-------------|--------|
| `spa-client` | public, **Authorization Code + PKCE (S256)** | role usera z konta | — (public) |
| `ssr-client` | **confidential, Authorization Code** + service account | SA ma rolę `User` (czytanie) | `ssr-client-secret` |
| `b2b-client` | **confidential, Client Credentials** | SA ma **tylko** rolę `analytics` | `b2b-client-secret` |
| `backend-admin` | confidential, Client Credentials | SA ma `realm-management`: manage/view/query-users | `backend-admin-secret` |

- Role realm: **Admin, User, Moderator, analytics**. `defaultRoles` zawiera `User` (rejestracja → User).
- redirect URIs: SPA `http://localhost:5173/*` (+ 8080), SSR `http://localhost:4000/*`.

### Walidacja JWT (Resource Server) — `jose`
- Middleware: `pg-service/src/middlewares/auth.ts` i `mongo-service/src/middlewares/auth.ts`.
- JWKS pobierane **wewnątrz dockera** z `KEYCLOAK_JWKS_URI=http://keycloak:8080/.../certs`.
- **Multi-issuer allowlist** (`KEYCLOAK_ALLOWED_ISSUERS`): akceptujemy `http://localhost:8090/...` (tokeny z przeglądarki/SPA) **oraz** `http://keycloak:8080/...` (tokeny M2M/SSR z sieci wewnętrznej) — ten sam realm, te same klucze.
- `requireAuth` / `requireRole(...)` + RBAC z `realm_access.roles`.
- **Tryb test:** gdy `NODE_ENV=test` auth jest pass-through, a kontrolery mają fallback na ID z body → istniejące testy jednostkowe nie wymagają zmian.

### JIT provisioning (most Keycloak ↔ relacyjne dane)
- Dodana kolumna `User.keycloakId` (migracja `20260602120000_add_keycloak_id`).
- `provisionUser` (pg-service) mapuje `sub` z JWT na lokalny `User.id` (int), dolinkowuje istniejące konta po username/email. Kontrolery używają `req.appUser.id` zamiast ID z body (user działa tylko we własnym imieniu; Admin/Moderator kasuje dowolny post).

### RBAC — mapa endpointów
- **pg-service** (`/api/*`): cały ruch wymaga roli człowieka `User|Admin|Moderator` (M2M `analytics` NIE ma tu wstępu).
  - tworzenie tagów → `Admin`; `attach` tagu → `Admin|Moderator`; `/api/admin/*` → `Admin` (oprócz `/api/admin/me`).
- **mongo-service**: `/api/feed/*` → `User|Admin|Moderator`; `/api/analytics/*` → `analytics|User|Admin|Moderator`.
  - `/api/internal/*` celowo **bez** auth (ruch serwis↔serwis w sieci internal, nie wystawiony przez gateway).
- **nginx** dorzucony routing `/api/admin → pg-service`.

### Zarządzanie userami przez backend
- `pg-service/src/services/keycloakAdmin.ts` — klient Keycloak Admin REST API (Client Credentials `backend-admin`, cache tokenu).
- `pg-service/src/controllers/adminController.ts` + `routes/adminRoutes.ts`:
  - `GET /api/admin/me`, `GET/POST /api/admin/users`, `POST/DELETE /api/admin/users/:id/roles`, `PUT /api/admin/users/:id/password`.

---

## ⚠️ Pułapki, które już rozwiązaliśmy (NIE powtarzać błędów)

1. **`fullScopeAllowed` musi być `true` dla klientów service-account**, inaczej role NIE trafiają do tokenu.
   Dotyczyło `b2b-client` (rola `analytics`) i `backend-admin` (role `realm-management`). Oba mają w eksporcie `fullScopeAllowed: true`. Service accounty i tak dostają tylko swoje role, więc least-privilege zachowane.
2. **Re-import realm:** stan realmu żyje w bazie `keycloak-db`, a strategia importu to `IGNORE_EXISTING`.
   Sam restart kontenera `keycloak` **nie** przeładuje zmian w `realm-export.json`. Trzeba:
   ```bash
   docker compose rm -sfv keycloak keycloak-db
   docker volume rm backend_keycloakdata
   docker compose up -d keycloak
   ```
3. **`scopeMappings` w realm-export się nie zaimportowało** — porzucone na rzecz `fullScopeAllowed`.
4. Na żywym realmie zostały ręczne zmiany z testów (`backend-admin.fullScopeAllowed=true` — już też w eksporcie; `spa-client` direct grants cofnięte). Czysty re-import (pkt 2) wyrówna stan z plikiem. W KC istnieje testowy user `testnowy/haslo123` — można skasować.
5. Plik `.env` musi zawierać sekcje Keycloak/OAuth2 (są w `.env.example`). Lokalnie już skopiowane.

---

## Pliki dodane/zmienione w tej sesji

**Nowe:**
- `apps/backend/keycloak/realm-export.json` — realm, role, 4 klienci, userzy, stub Google IdP.
- `apps/backend/pg-service/src/middlewares/auth.ts`, `services/keycloakAdmin.ts`, `controllers/adminController.ts`, `routes/adminRoutes.ts`
- `apps/backend/pg-service/prisma/migrations/20260602120000_add_keycloak_id/migration.sql`
- `apps/backend/mongo-service/src/middlewares/auth.ts`
- `apps/frontend/{package.json, vite.config.ts, tsconfig.json, index.html}` — scaffold SPA (kod React jeszcze nie napisany)

**Zmienione:** `docker-compose.yml` (+keycloak, +keycloak-db, +env JWT), `.env.example`, `nginx.conf` (+/api/admin), `schema.prisma` (+keycloakId), pg-service routes/controllers/index/postService, mongo-service feed/analytics routes, oba `package.json` (+`jose`).

---

## CO DALEJ — konkretne następne kroki

### ▶️ Faza 3a — dokończyć SPA (React) — ZACZNIJ TU JUTRO
Katalog `apps/frontend/`. Scaffold gotowy. Do napisania:
- `src/main.tsx` — `AuthProvider` z `react-oidc-context`:
  - `authority: import.meta.env.VITE_KEYCLOAK_AUTHORITY ?? 'http://localhost:8090/realms/SocialPolyglot'`
  - `client_id: 'spa-client'`, `redirect_uri: window.location.origin + '/'`, `response_type: 'code'`, `scope: 'openid profile email'`, `post_logout_redirect_uri: window.location.origin`.
  - `onSigninCallback` żeby wyczyścić query z URL.
- `src/config.ts` — `API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8080/api'`.
- `src/api.ts` — fetch wrapper dołączający `Authorization: Bearer ${auth.user?.access_token}`.
- `src/App.tsx` + komponenty: login/logout + whoami (role), feed, posty (lista/utwórz/usuń/reakcja/komentarze), users+follow, tagi (lista + create dla Admina + attach), powiadomienia, statystyki, **panel Admina** (lista userów KC, zakładanie usera, przypisywanie ról) — odpowiednik starego `app.js` (jest w historii git, commit przed tą sesją) ale z tokenem i ukrywaniem akcji wg ról.
- `src/styles.css` (stary plik usunięty — w historii git do podejrzenia).
- `Dockerfile` (multi-stage: `node build` → `nginx:alpine` serwujący `dist`, z SPA-fallback `try_files ... /index.html`), `.dockerignore`, własny `nginx.conf`.
- Dodać usługę `frontend` (lub `spa-client`) do `docker-compose.yml`: sieć `edge`, port `5173:80`, build z `./frontend`. `redirectUris` w realmie już obejmują `http://localhost:5173/*`.
- Build SPA: `npm install` w `apps/frontend`, potem `npm run build`.

### Faza 3b — SSR (`apps/ssr-client/`)
- Express + EJS. **Authorization Code po stronie serwera** klientem `ssr-client` (confidential, sekret `ssr-client-secret`). Tokeny w sesji serwerowej (`express-session`).
- Implementacja flow **ręcznie** (rekomendacja — unika niezgodności issuer między hostami): front-channel redirect na `http://localhost:8090/...auth`, wymiana code→token back-channel na `http://keycloak:8080/...token` (sieć internal). Akceptowane przez backend (issuer allowlist).
- Landing page: publiczne posty/profile — serwer pobiera dane z API używając tokenu **swojego service accountu** (`ssr-client` SA ma rolę `User`) przez Client Credentials, a zalogowany user widzi spersonalizowane dane.
- Dockerfile + usługa w compose (port 4000, sieci edge+internal).

### Faza 3c — Worker M2M (`apps/backend/analytics-worker/`)
- Mały skrypt Node: Client Credentials (`b2b-client` + `b2b-client-secret`) na `http://keycloak:8080/.../token`, cyklicznie (setInterval) uderza w `http://mongo-service:3002/api/analytics/{trending,top-authors-weekly,reaction-distribution}` z tokenem, loguje agregat. Retry na starcie (czeka aż Keycloak wstanie).
- Dockerfile + usługa w compose (sieć internal; `depends_on` keycloak `service_started`). Graceful shutdown SIGTERM.

### Faza 4 — Google (wyższa ocena) — wymaga Twoich credentials
- W Google Cloud Console: OAuth 2.0 Client (Web), redirect `http://localhost:8090/realms/SocialPolyglot/broker/google/endpoint`. Scope m.in. `https://www.googleapis.com/auth/calendar.readonly`.
- Stub IdP `google` jest już w `realm-export.json` (`enabled:false`, `storeToken:true`) — wstaw `clientId`/`clientSecret` i `enabled:true`.
- Backend (pg-service): endpoint pobierający Google Access Token z Keycloak broker API
  (`GET {KC}/realms/SocialPolyglot/broker/google/token`, z tokenem usera) → wywołanie Google Calendar API → zwrotka do feedu.

### Faza 5 — finisz
- Doc: README/`docs/OBRONA.md` — diagram flow OAuth2, grant types, scopes, weryfikacja JWT, tabela klientów.
- Pełny smoke test `docker compose up` od zera (po czystym re-imporcie realmu).
- Opcjonalnie: manifesty k8s dla keycloak + keycloak-db (`k8s/base/`).

---

## Uwaga o testach
Auth jest pass-through przy `NODE_ENV=test`, więc `pg-service`/`mongo-service` testy powinny przechodzić bez zmian.
**Nie zweryfikowano jeszcze uruchomienia pełnego suite testów w tej sesji** — warto odpalić `npm test` w obu serwisach (wymaga testowej bazy) zanim zamkniesz fazę 5.

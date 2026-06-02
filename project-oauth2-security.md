Cel projektu
Celem projektu zaliczeniowego jest stworzenie wielomodułowego (opartego o konteneryzację i Docker Compose) systemu wykorzystujacego w warstwie bezpieczeństawa protokół OAuth2. Składowe aplikacji:

Resource Server - API typu CRUD udostępniane różnym klientom (na ocenę dostateczną) lub bardziej rozbudowane API (np. dodatkowe zapytania na ocenę co najmniej dobrą). Dwie role: Admin i User (na ocenę dostateczną) lub więcej (na ocenę co najmniej dobrą). Dodatkowo na ocenę co najmniej dobrą funkcjonalności związane z zarządzaniem użytkownikami: zakładanie nowego użytkownika i przypisywanie go do określoej roli, odzyskiwanie hasła, 2FA/MFA. Funkcjonalności te realizowane są finalnie przez Authorization Server za pomocą dedykowanego do tego API. Komponent API musi walidować tokeny klientów (walidacja za pomocą kluczy serwera lub przez endpoint do inspekcji)
Client nr 1 - aplikacja typu SPA (React, Angular, Vue) wykorzystującą wszystkie endpointy i funkcjonalnośći z API
Client nr 2 - aplikacja typu Server Side Rendering wykorzystującą wybrane endpointy i funkcjonalnośći z API
Client nr 3 - aplikacja backend-2-backend wykorzystującą wybrane endpointy i funkcjonalnośći z API
Authorization Server - Keycloak - każdy Client musi mieć minimalne uprawnienia zgdone z danym OAuth2 Flow
(na ocenę co najmniej dobrą) wykorzystanie API zewnętrznego chronionego przez OAuth2 np. Google OAuth2, por. Guide to using OAuth2 to access google apis, Spotify OAuth2



Połączenie Twojego istniejącego projektu social-api-polyglot z wymogami projektu zaliczeniowego ma ogromny sens i jest wręcz idealnym scenariuszem.

Twój obecny projekt to zaawansowana architektura mikroserwisowa (Node.js, PostgreSQL, MongoDB, API Gateway w Nginx) spięta przez Docker Compose i przygotowana pod Kubernetes. Posiada już domeny, które świetnie nadają się na "Resource Server" (użytkownicy, posty, tagi, powiadomienia, statystyki). Jedyne, czego mu brakuje do spełnienia wymogów uczelnianych, to warstwa bezpieczeństwa (Keycloak) oraz odpowiednio wydzieleni klienci.

Oto szczegółowy plan implementacji, który pozwoli Ci przekształcić ten projekt w system spełniający wymagania na najwyższą ocenę.

Faza 1: Uruchomienie i konfiguracja Authorization Server (Keycloak)
Twój pierwszy krok to wpięcie serwera tożsamości do obecnej infrastruktury.

Docker Compose: Dodaj usługę keycloak (np. obraz quay.io/keycloak/keycloak:latest) do Twojego pliku apps/backend/docker-compose.yml. Będzie on potrzebował bazy danych (najlepiej dodać kolejną bazę PostgreSQL specjalnie dla Keycloaka).

Konfiguracja Realmu i Ról: W panelu Keycloak stwórz nowy Realm (np. SocialPolyglot). Utwórz dwie wymagane role: Admin oraz User.

Zarządzanie kontami: Włącz w Keycloak obsługę MFA/2FA, samodzielną rejestrację, weryfikację email oraz odzyskiwanie hasła. Keycloak obsługuje te funkcje "out-of-the-box" na swoich własnych ekranach logowania, co pozwala szybko zrealizować wymagania na dobrą ocenę.

Konfiguracja Klientów: W Realmie stwórz trzech klientów OAuth2 odpowiadających wymogom:

spa-client – z włączonym logowaniem publicznym (Flow: Authorization Code with PKCE).

ssr-client – z włączonym uwierzytelnianiem poufnym / Confidential (Flow: Authorization Code).

b2b-client – przeznaczony do komunikacji maszyna-maszyna (Flow: Client Credentials).

Faza 2: Adaptacja Mikroserwisów jako "Resource Server"
Twoje obecne serwisy (pg-service i mongo-service) oraz API Gateway staną się Resource Serverem chronionym przez tokeny JWT generowane przez Keycloak.

Walidacja Tokenów:

Opcja B (Bardziej standardowa): Dodaj middleware w swoich aplikacjach Node.js (np. bibliotekę express-jwt oraz jwks-rsa). Będą one pobierać klucze publiczne z Keycloaka i samodzielnie weryfikować kryptograficznie tokeny podpisane przez AS.

Kontrola Dostępu (RBAC): Zaktualizuj kontrolery (np. postController.ts, userController.ts), by odczytywały role z payloadu JWT i na ich podstawie przyznawały dostęp.

Użytkownik (User) może odczytywać feed i dodawać/edytować swoje posty.

Administrator (Admin) może dodawać nowe tagi (masz już do tego endpointy), kasować dowolne posty, a także używać API Keycloaka (Admin REST API) do zarządzania innymi użytkownikami i przypisywania im ról z poziomu Twojego backendu.

Faza 3: Budowa Klientów (Clients)
Wymóg zaliczeniowy jasno określa konieczność stworzenia 3 różnych typów aplikacji konsumujących API.

Client nr 1 (SPA): * W katalogu apps/frontend masz obecnie surowe HTML/JS/CSS. Zamień to na nowoczesną aplikację SPA, używając React, Vue lub Angular.

Wykorzystaj bibliotekę (np. oidc-client-ts lub react-oidc-context), aby zaimplementować Authorization Code Flow with PKCE.

Ten klient musi mieć zaimplementowane ekrany CRUD (dodawanie/edycja postów, przeglądanie feedu, statystyki) dla ról User i Admin.

Client nr 2 (SSR):

Utwórz nowy katalog, np. apps/ssr-client, oparty o framework Next.js, Nuxt lub Express + EJS.

Uwierzytelnianie musi dziać się po stronie serwera – serwer SSR zdobywa tokeny dla sesji przeglądarki użytkownika.

Aplikacja może być okrojona funkcjonalnie, np. służyć jedynie jako strona docelowa (landing page) wyświetlająca publiczne posty oraz profile użytkowników (wykorzystanie "wybranych endpointów").

Client nr 3 (M2M / Backend-2-Backend):

Możesz stworzyć mały skrypt Node.js, np. w folderze apps/backend/analytics-worker.

Zaimplementuj pobieranie tokena bezpośrednio na podstawie client_id i client_secret (bez udziału człowieka).

Skrypt może cyklicznie uderzać do endpointów z folderu mongo-service (np. statystyki trendów, logi) w celu agregacji danych lub wysyłania dziennych raportów powiadomień e-mail.

Faza 4: Integracja z Zewnętrznym API (Zadanie na wyższą ocenę)
Aby spełnić wymóg wykorzystania API zewnętrznego chronionego przez OAuth2:

Zewnętrzne uwierzytelnianie + działanie z API w tle: Skonfiguruj w Keycloak logowanie przez Google (tzw. Identity Brokering). Dzięki temu Keycloak zdobędzie od Google nie tylko profil użytkownika, ale też "Google Access Token".

Użycie z poziomu Twojego Resource Servera: Skonfiguruj Keycloak, aby zapisywał te zewnętrzne tokeny. Zmodyfikuj swój backend, by odpytywał Keycloak o ten token Google i wykonywał dodatkowe zapytania (np. pobieranie nadchodzących wydarzeń z Google Calendar i wyświetlanie ich w Twoim społecznościowym Feedzie).

Alternatywa (Spotify API): Pozwól użytkownikowi powiązać konto SPA ze Spotify, pobierz Access Token od Spotify i stwórz w backendzie endpoint, który pobiera "Aktualnie odsłuchiwany utwór", dodając go automatycznie do tworzonego RichPost.

Dlaczego ta ścieżka to gwarancja sukcesu?
Masz już doskonale zorganizowany projekt pod kątem CI/CD (.github/workflows, .gitlab-ci.yml), testów (pliki z __tests__ i integration) oraz konfiguracji bazy (knex, prisma, mongoose).

Dzięki temu zamiast spędzać godziny na pisaniu nudnych zapytań do bazy i wymyślaniu domeny, będziesz mógł w 100% skupić się na tym, o co faktycznie chodzi w tym projekcie zaliczeniowym: skonfigurowaniu poprawnej komunikacji OAuth2 (wymiana tokenów, grant type'y, scopes, weryfikacja JWT) pomiędzy odseparowanymi komponentami w środowisku Dockerowym.
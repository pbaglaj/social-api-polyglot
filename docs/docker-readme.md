Projekt Docker — aplikacja wieloserwisowa w Docker Compose

Projekt polega na przygotowaniu działającej aplikacji wieloserwisowej uruchamianej z użyciem Docker, Dockerfile i Docker Compose. Główny nacisk położony jest na architekturę uruchomieniową: obrazy, sieci, wolumeny, sekrety, healthchecki, reverse proxy i szybkie sprawdzenie działania.

Projekt powinien dać się sprawdzić w około 20 minut na osobę. Repozytorium musi zawierać CHECKLIST.md z instrukcją uruchomienia od zera, listą usług i portów, komendami testowymi, przykładowymi wynikami oraz informacją, które wymagania dodatkowe zostały wykonane.

Projekt Docker — aplikacja wieloserwisowa w Docker Compose
Przygotuj aplikację wieloserwisową uruchamianą przez Docker Compose. Funkcjonalność aplikacji ma być ograniczona i pomocnicza; oceniana jest przede wszystkim architektura kontenerowa oraz możliwość szybkiego sprawdzenia działania projektu.

Maksymalna punktacja: 25 pkt

Wymagania wspólne (dla wszystkich projektów)
Wymagania architektoniczne — Docker / Docker Compose
Suma wag w tej grupie: 80%.

Docker Compose — kompletna architektura
Projekt zawiera docker-compose.yml uruchamiający minimum 4 usługi: frontend lub reverse proxy, backend, bazę danych oraz cache/kolejkę/workera. Sprawdzenie: docker compose config i docker compose ps.
12%
Dockerfile i obrazy aplikacyjne
Główne usługi aplikacyjne są budowane z własnych Dockerfile. Minimum jeden Dockerfile używa multi-stage build, ma .dockerignore i nie uruchamia aplikacji jako root. Sprawdzenie: krótka inspekcja plików.
16%
Sieci, reverse proxy i izolacja
Compose definiuje osobne sieci dla ruchu zewnętrznego i wewnętrznego. Ruch zewnętrzny przechodzi przez Nginx lub Traefik. Baza danych nie może mieć portu wystawionego na hosta.
14%
Wolumeny
Baza danych używa named volume. Jeżeli projekt używa plików konfiguracyjnych lub trybu developerskiego, powinien używać bind mount zgodnie z przeznaczeniem. Sprawdzenie: docker volume ls oraz docker compose config.
8%
Konfiguracja i sekrety
Projekt zawiera .env.example. Dane niepoufne są przekazywane przez zmienne środowiskowe, a hasła nie są hardkodowane w kodzie ani w Dockerfile. Preferowane użycie Docker Compose secrets.
10%
Healthchecki i zależności
Backend, baza danych i cache/kolejka mają healthcheck albo równoważny mechanizm sprawdzania gotowości. Usługi zależne startują po usługach wymaganych do działania.
8%
Dokumentacja i szybka weryfikacja
README.md lub CHECKLIST.md zawiera diagram architektury, opis usług, instrukcję uruchomienia, komendy testowe i oczekiwane wyniki. Projekt musi dać się sprawdzić bez zgadywania.
8%
Tagowanie lub publikacja obrazów
Obrazy aplikacyjne są tagowane wersją lub SHA commita. Jeżeli obrazy są publikowane do rejestru, linki/tagi muszą być podane w dokumentacji.
4%
Rzeczy dodatkowe spoza zajęć
Elementy nieomawiane bezpośrednio na zajęciach, ale przydatne przy konfiguracji lub wdrażaniu aplikacji. Suma wag: +10%.

Limity zasobów
W docker-compose.yml ustawiono limity CPU/pamięci dla głównych usług albo opisano ograniczenia zasobów w sposób zgodny z używaną wersją Compose.
3%
Rotacja logów
Dla usług aplikacyjnych skonfigurowano politykę logowania ograniczającą rozmiar logów, np. max-size i max-file.
2%
Graceful shutdown
Backend lub worker obsługuje zamknięcie procesu, np. SIGTERM, i domyka połączenia do bazy/cache. W Compose ustawiono sensowny stop_grace_period.
3%
Profile środowisk
Projekt używa profiles albo osobnych plików Compose do rozdzielenia trybu podstawowego, developerskiego lub narzędzi pomocniczych.
2%
Wymagania specyficzne dla tego projektu
Minimalna funkcjonalność aplikacji
Aplikacja ma jeden główny zasób biznesowy, np. produkty, zadania, wpisy lub zamówienia. Musi obsługiwać co najmniej dodanie danych, odczyt listy danych oraz endpoint /health. Sprawdzenie: 2-3 komendy curl z CHECKLIST.md.
10%
Trwałość danych aplikacji
Dane zapisane przez aplikację muszą przetrwać restart środowiska wykonany przez docker compose down && docker compose up -d, bez użycia -v. Sprawdzenie: dodać rekord, zrestartować środowisko, odczytać rekord.
5%
Cache, kolejka albo worker
Projekt zawiera jeden dodatkowy komponent wspierający aplikację: Redis, RabbitMQ, worker albo inny proces pomocniczy. Musi być jasny dowód działania, np. log workera, nagłówek cache albo zmiana statusu zadania.
5%
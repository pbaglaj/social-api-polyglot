Pliki haseł używane jako Docker Compose secrets.

Format: jeden sekret = jeden plik tekstowy. Bez znaku końca linii.

Same pliki `*.txt` są **gitignorowane** (patrz `.gitignore` w korzeniu projektu), więc po
świeżym `git clone` ich NIE MA. Bez nich Docker tworzy w punkcie montowania pusty katalog,
przez co Postgres/MongoDB nie odczytają hasła i kontenery padają (a wraz z nimi cały łańcuch
zależności: pg-service → api-gateway → frontend). Dlatego **przed pierwszym uruchomieniem**
skopiuj pliki przykładowe (analogicznie do `.env.example` → `.env`):

```bash
cd apps/backend/secrets
cp postgres_password.txt.example postgres_password.txt
cp mongo_password.txt.example   mongo_password.txt
```

Pliki `*.txt.example` zawierają hasło rozwojowe (`secret`) i są wersjonowane. Dla środowiska
produkcyjnego nadpisz `*.txt` losowymi wartościami i nie commituj ich do repozytorium.

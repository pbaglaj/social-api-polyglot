Projekt Kubernetes — aplikacja wieloserwisowa z CI/CD

Projekt polega na przygotowaniu działającej aplikacji wieloserwisowej uruchamianej w Kubernetes oraz wdrażanej przez pipeline CI/CD w GitHub Actions. Wariant Kubernetes jest trudniejszy od wariantu Docker: wymaga manifestów klastra, trwałego storage, Ingressa, sond, limitów zasobów, securityContext i automatycznego wdrożenia.

Projekt powinien dać się sprawdzić w około 20 minut na osobę. Repozytorium musi zawierać CHECKLIST.md z instrukcją uruchomienia na kind, minikube albo k3d, listą zasobów Kubernetes, komendami kubectl, przykładowymi wynikami i linkiem do ostatniego udanego workflow GitHub Actions.

Przygotuj aplikację wieloserwisową uruchamianą w Kubernetes oraz wdrażaną przez GitHub Actions. Funkcjonalność aplikacji ma być ograniczona i pomocnicza; oceniana jest przede wszystkim architektura wdrożeniowa w klastrze oraz automatyzacja CI/CD.

Maksymalna punktacja: 40 pkt

Wymagania architektoniczne — Kubernetes i CI/CD
Suma wag w tej grupie: 80%.

Manifesty Kubernetes
Projekt zawiera katalog k8s/ albo Helm/Kustomize. Manifesty obejmują minimum: Namespace, Deployment, StatefulSet lub równoważny zasób dla bazy, Service, Ingress, ConfigMap, Secret, PVC.
12%
Deploymenty i rolling update
Frontend/API/worker działają jako Deployment. Backend ma minimum 2 repliki i strategię aktualizacji rolling update. Sprawdzenie: kubectl get deploy i kubectl rollout status.
10%
Baza danych i trwałość w Kubernetes
Baza danych działa jako StatefulSet albo przez jasno uzasadniony zasób zapewniający trwałość. Musi używać PersistentVolumeClaim.
12%
Services, Ingress i izolacja
Komunikacja wewnętrzna odbywa się przez Service. Ruch zewnętrzny przechodzi przez Ingress. Baza danych, cache i worker nie są wystawione na zewnątrz klastra.
10%
ConfigMap i Secret
Konfiguracja niepoufna jest w ConfigMap, a dane poufne w Secret. Hasła i tokeny nie mogą być zapisane jawnie w kodzie aplikacji ani w README jako prawdziwe wartości produkcyjne.
8%
Probes i zasoby
Główne kontenery mają readinessProbe i livenessProbe oraz ustawione resources.requests i resources.limits. Sprawdzenie: szybka analiza manifestów i kubectl describe pod.
10%
SecurityContext oraz initContainer albo Job
Kontenery aplikacyjne działają jako non-root i mają podstawowy securityContext. Projekt używa initContainer albo Job do migracji bazy, inicjalizacji danych lub oczekiwania na zależności.
8%
CI/CD GitHub Actions
Repozytorium zawiera workflow, który buduje obraz, uruchamia testy lub podstawową walidację, publikuje obraz do rejestru i wykonuje deploy przez kubectl, Helm albo Kustomize. Workflow sprawdza rollout po wdrożeniu.
10%
Rzeczy dodatkowe spoza zajęć
Elementy nieomawiane bezpośrednio na zajęciach, ale przydatne przy konfiguracji lub wdrażaniu aplikacji. Suma wag: +10%.

NetworkPolicy
Projekt definiuje NetworkPolicy, które ograniczają ruch między podami, np. baza przyjmuje ruch tylko z backendu lub workera.
2.5%
PodDisruptionBudget
Dla backendu dodano PodDisruptionBudget, który chroni minimalną dostępność replik podczas aktualizacji lub prac utrzymaniowych klastra.
2.5%
Helm albo Kustomize
Projekt używa Helm albo Kustomize do parametryzacji manifestów i obsługuje minimum dwa środowiska, np. dev i prod.
2.5%
Obserwowalność
Aplikacja udostępnia /metrics, adnotacje dla Prometheusa albo inną prostą formę obserwowalności oraz instrukcję sprawdzenia metryk/logów.
2.5%
Wymagania specyficzne dla tego projektu
Minimalna funkcjonalność aplikacji
Aplikacja ma jeden główny zasób biznesowy i obsługuje co najmniej dodanie danych, odczyt danych oraz endpoint /health lub /ready. Sprawdzenie: 2-3 komendy curl po wdrożeniu.
10%
Trwałość danych aplikacji
Dane aplikacji są zapisywane w bazie danych działającej w Kubernetes i pozostają dostępne po restarcie poda bazy. Sprawdzenie: dodać rekord, usunąć pod bazy, odczytać rekord po odtworzeniu poda.
5%
Cache, kolejka albo worker
Projekt zawiera dodatkowy komponent architektury, np. Redis, RabbitMQ albo worker. Musi być prosty dowód działania w CHECKLIST.md.
5%
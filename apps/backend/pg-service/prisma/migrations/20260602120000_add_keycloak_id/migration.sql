-- Migracja addytywna: powiazanie lokalnego usera z tozsamoscia w Keycloak (OAuth2).
-- keycloakId = claim "sub" z JWT. NULL-able, bo istniejace (seedowane) wiersze
-- nie maja jeszcze powiazania - zostanie ono dolinkowane przy pierwszym logowaniu
-- (JIT provisioning) gdy username/email sie zgadza.

ALTER TABLE "User" ADD COLUMN "keycloakId" TEXT;
CREATE UNIQUE INDEX "User_keycloakId_key" ON "User"("keycloakId");

-- Migracja addytywna: rozszerzenie profilu uzytkownika o dodatkowe pola.
-- Czysto addytywna - same ADD COLUMN, bez DROP/ALTER istniejacych kolumn.
-- Nowe kolumny sa NULL-able albo maja DEFAULT, wiec istniejace wiersze
-- nie wymagaja backfillu.

ALTER TABLE "User" ADD COLUMN "bio" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "displayName" VARCHAR(50);
ALTER TABLE "User" ADD COLUMN "location" VARCHAR(100);
ALTER TABLE "User" ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Migracja addytywna: znacznik edycji posta.
-- editedAt = moment ostatniej edycji tresci. NULL-able, bez DEFAULT:
-- istniejace wiersze maja NULL (nigdy nie edytowane), a frontend pokazuje
-- dopisek "(edited)" tylko gdy editedAt jest niepuste.

ALTER TABLE "Post" ADD COLUMN "editedAt" TIMESTAMP(3);

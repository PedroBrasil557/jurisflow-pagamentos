-- Backfill ANTES da constraint: alinha as linhas existentes a invariante.
-- 1) Texto sem id que RESOLVE para um conjunto registrado (match por nome
--    normalizado) -> vincula o FK.
UPDATE "process" p
SET "housing_complex_id" = hc."id"
FROM "housing_complex" hc
WHERE p."housing_complex_id" IS NULL
  AND btrim(p."housing_complex") <> ''
  AND upper(btrim(hc."name")) = upper(btrim(p."housing_complex"));
--> statement-breakpoint
-- 2) Texto sem id que NAO resolve (conjunto nao cadastrado) -> limpa o texto, pois
--    "conjunto sem registro" e estado invalido (decisao de dominio).
UPDATE "process"
SET "housing_complex" = ''
WHERE "housing_complex_id" IS NULL
  AND btrim("housing_complex") <> '';
--> statement-breakpoint
-- 3) Id sem texto (defensivo) -> preenche o texto a partir do registro.
UPDATE "process" p
SET "housing_complex" = hc."name"
FROM "housing_complex" hc
WHERE p."housing_complex_id" = hc."id"
  AND btrim(p."housing_complex") = '';
--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_housing_complex_link_chk" CHECK (("process"."housing_complex_id" IS NULL) = (btrim("process"."housing_complex") = ''));
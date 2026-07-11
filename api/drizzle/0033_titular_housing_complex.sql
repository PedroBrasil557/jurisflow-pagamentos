ALTER TABLE "titular_contrato_caixa" ADD COLUMN "housing_complex_id" text;--> statement-breakpoint
ALTER TABLE "titular_contrato_caixa" ADD CONSTRAINT "titular_contrato_caixa_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: liga cada titular ao conjunto (housing_complex) cujo NOME casa com o
-- `empreendimento`, pelo mesmo match normalizado dos processos
-- (resolveHousingComplexIdOrThrow: upper(trim(...))). Idempotente (so preenche
-- NULLs). Empreendimento sem conjunto cadastrado fica NULL (visivel so p/ admin).
UPDATE "titular_contrato_caixa" AS t
SET "housing_complex_id" = hc."id"
FROM "housing_complex" AS hc
WHERE upper(trim(hc."name")) = upper(trim(t."empreendimento"))
  AND t."housing_complex_id" IS NULL;--> statement-breakpoint
CREATE INDEX "titular_housing_complex_idx" ON "titular_contrato_caixa" USING btree ("housing_complex_id");

CREATE TYPE "public"."titular_averbacao" AS ENUM('sim', 'nao', 'indeterminado');--> statement-breakpoint
ALTER TABLE "titular_contrato_caixa" ADD COLUMN "averbacao" "titular_averbacao";--> statement-breakpoint
ALTER TABLE "titular_contrato_caixa" ADD COLUMN "averbacao_checked_at" timestamp;--> statement-breakpoint
CREATE INDEX "titular_averbacao_idx" ON "titular_contrato_caixa" USING btree ("averbacao");

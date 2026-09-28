-- Modulo Pagamentos (financeiro). Contrato: docs/pagamentos/CONTRATO.md
CREATE SEQUENCE "finance_closing_code_seq";
--> statement-breakpoint
CREATE TYPE "public"."finance_closing_status" AS ENUM('ATIVO', 'ESTORNADO');--> statement-breakpoint
CREATE TYPE "public"."finance_line_rubric" AS ENUM('TRIBUTO_PROVISIONADO', 'PARTICIPACAO', 'PROVISAO_APOIO', 'RESERVA_CERTIDAO', 'DISTRIBUICAO', 'DISTRIBUICAO_SALDO');--> statement-breakpoint
CREATE TYPE "public"."finance_receipt_kind" AS ENUM('HONORARIOS_CONTRATUAIS', 'SUCUMBENCIA', 'MULTA');--> statement-breakpoint
CREATE TYPE "public"."finance_receipt_status" AS ENUM('PREVISTO', 'LIBERADO', 'CONFERIDO', 'FECHADO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "public"."finance_recipient_kind" AS ENUM('PESSOA_FISICA', 'PESSOA_JURIDICA');--> statement-breakpoint
CREATE TYPE "public"."finance_record_status" AS ENUM('ATIVO', 'ESTORNADO');--> statement-breakpoint
CREATE TYPE "public"."finance_reference_date_source" AS ENUM('CADASTRO_PROCESSO', 'INFORMADA');--> statement-breakpoint
CREATE TYPE "public"."finance_reserve_movement_kind" AS ENUM('CONSTITUICAO', 'DESPESA', 'TRANSFERENCIA');--> statement-breakpoint
CREATE TYPE "public"."finance_reserve_pool" AS ENUM('CERTIDAO', 'TRIBUTO', 'APOIO');--> statement-breakpoint
CREATE TYPE "public"."finance_rule_role" AS ENUM('PARTICIPACAO', 'LIDERANCA', 'PROSPECTADOR', 'DISTRIBUICAO', 'DISTRIBUICAO_SALDO');--> statement-breakpoint
CREATE TYPE "public"."finance_rule_status" AS ENUM('RASCUNHO', 'PUBLICADA', 'REVOGADA');--> statement-breakpoint
CREATE TABLE "finance_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text,
	"payout_id" text,
	"reserve_movement_id" text,
	"bucket_name" text NOT NULL,
	"object_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_in_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" text,
	"remove_reason" text,
	CONSTRAINT "finance_attachment_owner_chk" CHECK (num_nonnulls("finance_attachment"."receipt_id", "finance_attachment"."payout_id", "finance_attachment"."reserve_movement_id") = 1)
);--> statement-breakpoint
CREATE TABLE "finance_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "finance_closing" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text DEFAULT ('FEC-' || lpad(nextval('finance_closing_code_seq')::text, 6, '0')) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "finance_closing_status" DEFAULT 'ATIVO' NOT NULL,
	"algorithm_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"config_snapshot" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"receipt_count" integer NOT NULL,
	"gross_cents" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_user_id" text,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "finance_closing_period_chk" CHECK ("finance_closing"."period_end" >= "finance_closing"."period_start"),
	CONSTRAINT "finance_closing_count_chk" CHECK ("finance_closing"."receipt_count" > 0),
	CONSTRAINT "finance_closing_reversal_chk" CHECK ("finance_closing"."status" = 'ATIVO' OR ("finance_closing"."reversed_at" IS NOT NULL AND btrim(coalesce("finance_closing"."reversal_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_closing_item" (
	"id" text PRIMARY KEY NOT NULL,
	"closing_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"receipt_snapshot" jsonb NOT NULL,
	"calculation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "finance_closing_line" (
	"id" text PRIMARY KEY NOT NULL,
	"closing_id" text NOT NULL,
	"closing_item_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"process_id" text NOT NULL,
	"housing_complex_id" text,
	"release_date" date NOT NULL,
	"sequence" integer NOT NULL,
	"rubric" "finance_line_rubric" NOT NULL,
	"recipient_id" text,
	"rule_id" text,
	"rule_revision" integer,
	"basis_points" integer,
	"basis_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "finance_closing_line_amount_chk" CHECK ("finance_closing_line"."amount_cents" >= 0)
);--> statement-breakpoint
CREATE TABLE "finance_payout" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "finance_record_status" DEFAULT 'ATIVO' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_user_id" text,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "finance_payout_amount_chk" CHECK ("finance_payout"."amount_cents" > 0),
	CONSTRAINT "finance_payout_reference_chk" CHECK (btrim("finance_payout"."reference") <> ''),
	CONSTRAINT "finance_payout_reversal_chk" CHECK ("finance_payout"."status" = 'ATIVO' OR ("finance_payout"."reversed_at" IS NOT NULL AND btrim(coalesce("finance_payout"."reversal_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_payout_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"payout_id" text NOT NULL,
	"closing_line_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "finance_payout_allocation_amount_chk" CHECK ("finance_payout_allocation"."amount_cents" > 0)
);--> statement-breakpoint
CREATE TABLE "finance_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"kind" "finance_receipt_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "finance_receipt_status" DEFAULT 'PREVISTO' NOT NULL,
	"release_date" date,
	"reference" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference_date" date NOT NULL,
	"reference_date_source" "finance_reference_date_source" NOT NULL,
	"reference_date_ambiguous" boolean DEFAULT false NOT NULL,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by_user_id" text,
	"verified_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "finance_receipt_amount_chk" CHECK ("finance_receipt"."amount_cents" > 0),
	CONSTRAINT "finance_receipt_release_chk" CHECK ("finance_receipt"."status" IN ('PREVISTO', 'CANCELADO') OR "finance_receipt"."release_date" IS NOT NULL),
	CONSTRAINT "finance_receipt_verified_chk" CHECK ("finance_receipt"."status" NOT IN ('CONFERIDO', 'FECHADO') OR "finance_receipt"."verified_at" IS NOT NULL),
	CONSTRAINT "finance_receipt_cancel_chk" CHECK ("finance_receipt"."status" <> 'CANCELADO' OR ("finance_receipt"."cancelled_at" IS NOT NULL AND btrim(coalesce("finance_receipt"."cancel_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "finance_recipient_kind" NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"payment_note" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"user_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_recipient_name_chk" CHECK (btrim("finance_recipient"."name") <> '')
);--> statement-breakpoint
CREATE TABLE "finance_reserve_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"pool" "finance_reserve_pool" NOT NULL,
	"kind" "finance_reserve_movement_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"process_id" text,
	"closing_id" text,
	"receipt_id" text,
	"movement_date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"status" "finance_record_status" DEFAULT 'ATIVO' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_user_id" text,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "finance_reserve_movement_amount_chk" CHECK ("finance_reserve_movement"."amount_cents" > 0),
	CONSTRAINT "finance_reserve_movement_scope_chk" CHECK (("finance_reserve_movement"."pool" <> 'CERTIDAO' OR "finance_reserve_movement"."process_id" IS NOT NULL) AND ("finance_reserve_movement"."pool" <> 'TRIBUTO' OR "finance_reserve_movement"."closing_id" IS NOT NULL)),
	CONSTRAINT "finance_reserve_movement_constitution_chk" CHECK ("finance_reserve_movement"."kind" <> 'CONSTITUICAO' OR ("finance_reserve_movement"."closing_id" IS NOT NULL AND "finance_reserve_movement"."receipt_id" IS NOT NULL)),
	CONSTRAINT "finance_reserve_movement_reversal_chk" CHECK ("finance_reserve_movement"."status" = 'ATIVO' OR ("finance_reserve_movement"."reversed_at" IS NOT NULL AND btrim(coalesce("finance_reserve_movement"."reversal_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"role" "finance_rule_role" NOT NULL,
	"housing_complex_id" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"basis_points" integer,
	"cascade_order" integer,
	"status" "finance_rule_status" DEFAULT 'RASCUNHO' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"supersedes_rule_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"revoke_reason" text,
	CONSTRAINT "finance_rule_validity_chk" CHECK ("finance_rule"."valid_to" IS NULL OR "finance_rule"."valid_to" >= "finance_rule"."valid_from"),
	CONSTRAINT "finance_rule_bps_chk" CHECK (("finance_rule"."role" = 'DISTRIBUICAO_SALDO' AND "finance_rule"."basis_points" IS NULL) OR ("finance_rule"."role" <> 'DISTRIBUICAO_SALDO' AND "finance_rule"."basis_points" BETWEEN 1 AND 10000)),
	CONSTRAINT "finance_rule_order_chk" CHECK (("finance_rule"."role" = 'DISTRIBUICAO' AND "finance_rule"."cascade_order" >= 1) OR ("finance_rule"."role" <> 'DISTRIBUICAO' AND "finance_rule"."cascade_order" IS NULL)),
	CONSTRAINT "finance_rule_published_chk" CHECK ("finance_rule"."status" = 'RASCUNHO' OR "finance_rule"."published_at" IS NOT NULL),
	CONSTRAINT "finance_rule_revoked_chk" CHECK ("finance_rule"."status" <> 'REVOGADA' OR ("finance_rule"."revoked_at" IS NOT NULL AND btrim(coalesce("finance_rule"."revoke_reason", '')) <> ''))
);--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_payout_id_finance_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."finance_payout"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_reserve_movement_id_finance_reserve_movement_id_fk" FOREIGN KEY ("reserve_movement_id") REFERENCES "public"."finance_reserve_movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_removed_by_user_id_user_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_audit_log" ADD CONSTRAINT "finance_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing" ADD CONSTRAINT "finance_closing_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing" ADD CONSTRAINT "finance_closing_reversed_by_user_id_user_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_item" ADD CONSTRAINT "finance_closing_item_closing_id_finance_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."finance_closing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_item" ADD CONSTRAINT "finance_closing_item_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_closing_id_finance_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."finance_closing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_closing_item_id_finance_closing_item_id_fk" FOREIGN KEY ("closing_item_id") REFERENCES "public"."finance_closing_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_recipient_id_finance_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."finance_recipient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_rule_id_finance_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."finance_rule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout" ADD CONSTRAINT "finance_payout_recipient_id_finance_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."finance_recipient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout" ADD CONSTRAINT "finance_payout_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout" ADD CONSTRAINT "finance_payout_reversed_by_user_id_user_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout_allocation" ADD CONSTRAINT "finance_payout_allocation_payout_id_finance_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."finance_payout"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout_allocation" ADD CONSTRAINT "finance_payout_allocation_closing_line_id_finance_closing_line_id_fk" FOREIGN KEY ("closing_line_id") REFERENCES "public"."finance_closing_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_verified_by_user_id_user_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_recipient" ADD CONSTRAINT "finance_recipient_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_recipient" ADD CONSTRAINT "finance_recipient_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_closing_id_finance_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."finance_closing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_reversed_by_user_id_user_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_recipient_id_finance_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."finance_recipient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_attachment_object_idx" ON "finance_attachment" USING btree ("bucket_name","object_key");--> statement-breakpoint
CREATE INDEX "finance_attachment_receipt_idx" ON "finance_attachment" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "finance_attachment_payout_idx" ON "finance_attachment" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "finance_attachment_reserve_idx" ON "finance_attachment" USING btree ("reserve_movement_id");--> statement-breakpoint
CREATE INDEX "finance_audit_log_entity_idx" ON "finance_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "finance_audit_log_created_at_idx" ON "finance_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_code_idx" ON "finance_closing" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_idempotency_idx" ON "finance_closing" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "finance_closing_status_idx" ON "finance_closing" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_item_closing_receipt_idx" ON "finance_closing_item" USING btree ("closing_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_item_active_receipt_idx" ON "finance_closing_item" USING btree ("receipt_id") WHERE "finance_closing_item"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_line_item_seq_idx" ON "finance_closing_line" USING btree ("closing_item_id","sequence");--> statement-breakpoint
CREATE INDEX "finance_closing_line_closing_idx" ON "finance_closing_line" USING btree ("closing_id");--> statement-breakpoint
CREATE INDEX "finance_closing_line_recipient_idx" ON "finance_closing_line" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "finance_closing_line_process_idx" ON "finance_closing_line" USING btree ("process_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_payout_idempotency_idx" ON "finance_payout" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "finance_payout_recipient_idx" ON "finance_payout" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_payout_allocation_payout_line_idx" ON "finance_payout_allocation" USING btree ("payout_id","closing_line_id");--> statement-breakpoint
CREATE INDEX "finance_payout_allocation_line_idx" ON "finance_payout_allocation" USING btree ("closing_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_receipt_idempotency_idx" ON "finance_receipt" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "finance_receipt_process_idx" ON "finance_receipt" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "finance_receipt_status_idx" ON "finance_receipt" USING btree ("status");--> statement-breakpoint
CREATE INDEX "finance_receipt_release_date_idx" ON "finance_receipt" USING btree ("release_date");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_recipient_document_idx" ON "finance_recipient" USING btree ("document") WHERE "finance_recipient"."document" <> '';--> statement-breakpoint
CREATE INDEX "finance_recipient_name_idx" ON "finance_recipient" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reserve_movement_idempotency_idx" ON "finance_reserve_movement" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reserve_certidao_once_idx" ON "finance_reserve_movement" USING btree ("process_id") WHERE "finance_reserve_movement"."pool" = 'CERTIDAO' AND "finance_reserve_movement"."kind" = 'CONSTITUICAO' AND "finance_reserve_movement"."status" = 'ATIVO';--> statement-breakpoint
CREATE INDEX "finance_reserve_movement_pool_idx" ON "finance_reserve_movement" USING btree ("pool");--> statement-breakpoint
CREATE INDEX "finance_reserve_movement_process_idx" ON "finance_reserve_movement" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "finance_reserve_movement_closing_idx" ON "finance_reserve_movement" USING btree ("closing_id");--> statement-breakpoint
CREATE INDEX "finance_rule_recipient_idx" ON "finance_rule" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "finance_rule_status_idx" ON "finance_rule" USING btree ("status");--> statement-breakpoint
CREATE INDEX "finance_rule_housing_complex_idx" ON "finance_rule" USING btree ("housing_complex_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Integridade financeira no banco (defesa em profundidade; o servico tambem valida
-- e serializa com travas). Registros financeiros nao sao apagados: corrigem-se por
-- estorno/ajuste com motivo.
CREATE FUNCTION finance_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registro financeiro imutavel (%): % nao permitido.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_closing_line_immutable BEFORE UPDATE OR DELETE ON finance_closing_line
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER finance_audit_log_immutable BEFORE UPDATE OR DELETE ON finance_audit_log
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER finance_recipient_no_delete BEFORE DELETE ON finance_recipient
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
--> statement-breakpoint
CREATE FUNCTION finance_closing_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fechamento nao pode ser apagado; use estorno.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.code, NEW.period_start, NEW.period_end, NEW.algorithm_version, NEW.input_hash,
      NEW.rules_snapshot, NEW.config_snapshot, NEW.totals, NEW.receipt_count, NEW.gross_cents,
      NEW.idempotency_key, NEW.notes, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.code, OLD.period_start, OLD.period_end, OLD.algorithm_version, OLD.input_hash,
      OLD.rules_snapshot, OLD.config_snapshot, OLD.totals, OLD.receipt_count, OLD.gross_cents,
      OLD.idempotency_key, OLD.notes, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Snapshot do fechamento e imutavel.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ESTORNADO' THEN
    RAISE EXCEPTION 'Fechamento estornado nao pode ser alterado.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_closing_guard BEFORE UPDATE OR DELETE ON finance_closing
  FOR EACH ROW EXECUTE FUNCTION finance_closing_guard();
--> statement-breakpoint
CREATE FUNCTION finance_closing_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Item de fechamento nao pode ser apagado.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.closing_id, NEW.receipt_id, NEW.receipt_snapshot, NEW.calculation, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.closing_id, OLD.receipt_id, OLD.receipt_snapshot, OLD.calculation, OLD.created_at)
     OR (OLD.is_active = false AND NEW.is_active = true) THEN
    RAISE EXCEPTION 'Item de fechamento e imutavel (so pode ser desativado no estorno).' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_closing_item_guard BEFORE UPDATE OR DELETE ON finance_closing_item
  FOR EACH ROW EXECUTE FUNCTION finance_closing_item_guard();
--> statement-breakpoint
CREATE FUNCTION finance_status_record_guard() RETURNS trigger AS $$
BEGIN
  -- Baixa / movimento de reserva: sem DELETE; so ATIVO -> ESTORNADO com dados do estorno.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registro financeiro nao pode ser apagado; use estorno.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ESTORNADO' OR NEW.status <> 'ESTORNADO'
     OR (to_jsonb(NEW) - ARRAY['status', 'reversed_by_user_id', 'reversed_at', 'reversal_reason'])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status', 'reversed_by_user_id', 'reversed_at', 'reversal_reason']) THEN
    RAISE EXCEPTION 'Registro financeiro so pode ser estornado.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_payout_guard BEFORE UPDATE OR DELETE ON finance_payout
  FOR EACH ROW EXECUTE FUNCTION finance_status_record_guard();
--> statement-breakpoint
CREATE TRIGGER finance_reserve_movement_guard BEFORE UPDATE OR DELETE ON finance_reserve_movement
  FOR EACH ROW EXECUTE FUNCTION finance_status_record_guard();
--> statement-breakpoint
CREATE FUNCTION finance_payout_allocation_guard() RETURNS trigger AS $$
DECLARE
  line_amount bigint;
  line_recipient text;
  line_rubric finance_line_rubric;
  closing_status finance_closing_status;
  payout_recipient text;
  allocated bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Alocacao de baixa nao pode ser apagada.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_active = false OR NEW.is_active <> false
       OR (NEW.id, NEW.payout_id, NEW.closing_line_id, NEW.amount_cents)
          IS DISTINCT FROM (OLD.id, OLD.payout_id, OLD.closing_line_id, OLD.amount_cents) THEN
      RAISE EXCEPTION 'Alocacao de baixa so pode ser desativada.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- Trava a linha: alocacoes concorrentes na mesma linha serializam aqui.
  SELECT l.amount_cents, l.recipient_id, l.rubric
    INTO line_amount, line_recipient, line_rubric
    FROM finance_closing_line l
    WHERE l.id = NEW.closing_line_id
    FOR UPDATE;
  SELECT c.status INTO closing_status
    FROM finance_closing_line l JOIN finance_closing c ON c.id = l.closing_id
    WHERE l.id = NEW.closing_line_id;
  SELECT recipient_id INTO payout_recipient FROM finance_payout WHERE id = NEW.payout_id;
  IF closing_status <> 'ATIVO' THEN
    RAISE EXCEPTION 'Baixa so pode ser alocada em fechamento ativo.' USING ERRCODE = 'check_violation';
  END IF;
  IF line_recipient IS DISTINCT FROM payout_recipient
     OR line_rubric NOT IN ('PARTICIPACAO', 'DISTRIBUICAO', 'DISTRIBUICAO_SALDO') THEN
    RAISE EXCEPTION 'Linha nao e valor devido a este destinatario.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO allocated
    FROM finance_payout_allocation
    WHERE closing_line_id = NEW.closing_line_id AND is_active;
  IF allocated + NEW.amount_cents > line_amount THEN
    RAISE EXCEPTION 'Baixa excede o valor devido da linha.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_payout_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON finance_payout_allocation
  FOR EACH ROW EXECUTE FUNCTION finance_payout_allocation_guard();
--> statement-breakpoint
CREATE FUNCTION finance_reserve_balance_check() RETURNS trigger AS $$
DECLARE
  balance bigint;
BEGIN
  SELECT coalesce(sum(CASE WHEN kind = 'CONSTITUICAO' THEN amount_cents ELSE -amount_cents END), 0)
    INTO balance
    FROM finance_reserve_movement m
    WHERE m.status = 'ATIVO' AND m.pool = NEW.pool
      AND (NEW.pool <> 'CERTIDAO' OR m.process_id = NEW.process_id)
      AND (NEW.pool <> 'TRIBUTO' OR m.closing_id = NEW.closing_id);
  IF balance < 0 THEN
    RAISE EXCEPTION 'Saldo da reserva % ficaria negativo.', NEW.pool USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_reserve_balance_check AFTER INSERT OR UPDATE ON finance_reserve_movement
  FOR EACH ROW EXECUTE FUNCTION finance_reserve_balance_check();
--> statement-breakpoint
CREATE FUNCTION finance_receipt_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Recebimento nao pode ser apagado; use cancelamento.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'FECHADO'
     AND (NEW.process_id, NEW.kind, NEW.amount_cents, NEW.release_date, NEW.reference_date)
         IS DISTINCT FROM (OLD.process_id, OLD.kind, OLD.amount_cents, OLD.release_date, OLD.reference_date) THEN
    RAISE EXCEPTION 'Recebimento fechado nao pode ter valores alterados.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Recebimento cancelado nao pode ser alterado.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_receipt_guard BEFORE UPDATE OR DELETE ON finance_receipt
  FOR EACH ROW EXECUTE FUNCTION finance_receipt_guard();
--> statement-breakpoint
CREATE FUNCTION finance_rule_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'RASCUNHO' THEN
      RAISE EXCEPTION 'Regra publicada nao pode ser apagada; revogue.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'REVOGADA' THEN
    RAISE EXCEPTION 'Regra revogada nao pode ser alterada.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'PUBLICADA'
     AND (NEW.status <> 'REVOGADA'
          OR (to_jsonb(NEW) - ARRAY['status', 'revoked_at', 'revoked_by_user_id', 'revoke_reason', 'updated_at'])
             IS DISTINCT FROM
             (to_jsonb(OLD) - ARRAY['status', 'revoked_at', 'revoked_by_user_id', 'revoke_reason', 'updated_at'])) THEN
    RAISE EXCEPTION 'Regra publicada e imutavel; crie nova revisao.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_rule_guard BEFORE UPDATE OR DELETE ON finance_rule
  FOR EACH ROW EXECUTE FUNCTION finance_rule_guard();

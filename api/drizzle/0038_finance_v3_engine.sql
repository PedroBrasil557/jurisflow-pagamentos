-- Modulo Pagamentos V3 (motor por etapas configuraveis). Contrato: docs/pagamentos/CONTRATO.md
-- SEGURANCA: esta migration reestrutura as tabelas financeiras da 0037, que nunca
-- tiveram servico/rota. Ela ABORTA se qualquer uma delas tiver linhas, portanto nao
-- pode apagar dado financeiro. finance_recipient e finance_audit_log sao mantidas.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_rule', 'finance_receipt', 'finance_closing',
    'finance_closing_item', 'finance_closing_line', 'finance_payout',
    'finance_payout_allocation', 'finance_reserve_movement', 'finance_attachment'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Migration 0038 abortada: % contem % linha(s); revisao manual necessaria.', t, n;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DROP TABLE "finance_attachment";--> statement-breakpoint
DROP TABLE "finance_payout_allocation";--> statement-breakpoint
DROP TABLE "finance_payout";--> statement-breakpoint
DROP TABLE "finance_reserve_movement";--> statement-breakpoint
DROP TABLE "finance_closing_line";--> statement-breakpoint
DROP TABLE "finance_closing_item";--> statement-breakpoint
DROP TABLE "finance_closing";--> statement-breakpoint
DROP TABLE "finance_receipt";--> statement-breakpoint
DROP TABLE "finance_rule";--> statement-breakpoint
DROP FUNCTION "finance_payout_allocation_guard"();--> statement-breakpoint
DROP TYPE "public"."finance_rule_role";--> statement-breakpoint
DROP TYPE "public"."finance_rule_status";--> statement-breakpoint
DROP TYPE "public"."finance_receipt_status";--> statement-breakpoint
DROP TYPE "public"."finance_line_rubric";--> statement-breakpoint
DROP TYPE "public"."finance_reserve_pool";--> statement-breakpoint
DROP TYPE "public"."finance_reference_date_source";--> statement-breakpoint
CREATE TYPE "public"."finance_config_origin" AS ENUM('MANUAL', 'IMPORTACAO');--> statement-breakpoint
CREATE TYPE "public"."finance_credit_status" AS ENUM('ABERTO', 'PARCIALMENTE_PAGO', 'PAGO', 'ESTORNADO');--> statement-breakpoint
CREATE TYPE "public"."finance_receipt_status" AS ENUM('RASCUNHO', 'EM_PREVIA', 'BLOQUEADO', 'APTO', 'FECHADO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "public"."finance_rule_nature" AS ENUM('CREDITO', 'PROVISAO', 'RESERVA');--> statement-breakpoint
CREATE TYPE "public"."finance_rule_stage" AS ENUM('PROVISAO_RECEITA', 'DEDUCAO_LIQUIDA', 'RESERVA', 'PARTICIPACAO_RESULTADO', 'DISTRIBUICAO_FINAL');--> statement-breakpoint
CREATE TYPE "public"."finance_rule_status" AS ENUM('ATIVA', 'REVOGADA');--> statement-breakpoint
CREATE TYPE "public"."finance_step_kind" AS ENUM('RECEITA_TOTAL', 'PROVISAO_RECEITA', 'TOTAL_PROVISOES', 'RECEITA_LIQUIDA', 'DEDUCAO_LIQUIDA', 'RESERVA', 'TOTAL_DEDUCOES', 'RESULTADO_1', 'PARTICIPACAO_RESULTADO', 'RESULTADO_2', 'DISTRIBUICAO_FINAL', 'SALDO_FINAL');--> statement-breakpoint
CREATE TYPE "public"."finance_uniqueness" AS ENUM('NENHUMA', 'UNICA_POR_PROCESSO');--> statement-breakpoint
CREATE TYPE "public"."finance_value_type" AS ENUM('PERCENTUAL', 'VALOR_FIXO');--> statement-breakpoint
CREATE TABLE "finance_adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_adjustment_amount_chk" CHECK ("finance_adjustment"."amount_cents" <> 0),
	CONSTRAINT "finance_adjustment_reason_chk" CHECK (btrim("finance_adjustment"."reason") <> '')
);--> statement-breakpoint
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
CREATE TABLE "finance_closing" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text DEFAULT ('FEC-' || lpad(nextval('finance_closing_code_seq')::text, 6, '0')) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "finance_closing_status" DEFAULT 'ATIVO' NOT NULL,
	"algorithm_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"receipt_count" integer NOT NULL,
	"gross_cents" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
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
	"calculation_hash" text NOT NULL,
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
	"step_order" integer NOT NULL,
	"code" text NOT NULL,
	"kind" "finance_step_kind" NOT NULL,
	"description" text NOT NULL,
	"base_key" text,
	"base_cents" bigint,
	"rule_id" text,
	"rule_lineage_id" text,
	"rule_version" integer,
	"value_type" "finance_value_type",
	"basis_points" integer,
	"fixed_cents" bigint,
	"formula" text NOT NULL,
	"exact_cents" text,
	"rounding" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"nature" "finance_rule_nature",
	"recipient_id" text,
	"pool_key" text,
	"pool_label" text,
	"work_type" text,
	"is_allocation" boolean NOT NULL,
	"note" text
);--> statement-breakpoint
CREATE TABLE "finance_credit" (
	"id" text PRIMARY KEY NOT NULL,
	"closing_id" text NOT NULL,
	"closing_line_id" text NOT NULL,
	"receipt_id" text NOT NULL,
	"process_id" text NOT NULL,
	"housing_complex_id" text,
	"recipient_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"adjusted_cents" bigint DEFAULT 0 NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"status" "finance_credit_status" DEFAULT 'ABERTO' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_credit_amount_chk" CHECK ("finance_credit"."amount_cents" > 0),
	CONSTRAINT "finance_credit_paid_chk" CHECK ("finance_credit"."paid_cents" >= 0 AND "finance_credit"."paid_cents" <= "finance_credit"."amount_cents" + "finance_credit"."adjusted_cents"),
	CONSTRAINT "finance_credit_due_chk" CHECK ("finance_credit"."amount_cents" + "finance_credit"."adjusted_cents" >= 0)
);--> statement-breakpoint
CREATE TABLE "finance_import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "finance_payout" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"reference" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"status" "finance_record_status" DEFAULT 'ATIVO' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_user_id" text,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "finance_payout_amount_chk" CHECK ("finance_payout"."amount_cents" > 0),
	CONSTRAINT "finance_payout_reference_chk" CHECK (btrim("finance_payout"."reference") <> ''),
	CONSTRAINT "finance_payout_reversal_chk" CHECK ("finance_payout"."status" = 'ATIVO' OR ("finance_payout"."reversed_at" IS NOT NULL AND btrim(coalesce("finance_payout"."reversal_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"kind" "finance_receipt_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "finance_receipt_status" DEFAULT 'RASCUNHO' NOT NULL,
	"release_date" date,
	"reference" text DEFAULT '' NOT NULL,
	"origin_description" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"client_registration_date" date,
	"last_calculation" jsonb,
	"last_calculation_hash" text,
	"last_calculated_at" timestamp with time zone,
	"approved_calculation_hash" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "finance_receipt_amount_chk" CHECK ("finance_receipt"."amount_cents" > 0),
	CONSTRAINT "finance_receipt_release_chk" CHECK ("finance_receipt"."status" NOT IN ('EM_PREVIA', 'APTO', 'FECHADO') OR "finance_receipt"."release_date" IS NOT NULL),
	CONSTRAINT "finance_receipt_calculated_chk" CHECK ("finance_receipt"."status" NOT IN ('EM_PREVIA', 'BLOQUEADO', 'APTO', 'FECHADO') OR "finance_receipt"."last_calculation" IS NOT NULL),
	CONSTRAINT "finance_receipt_approved_chk" CHECK ("finance_receipt"."status" NOT IN ('APTO', 'FECHADO') OR ("finance_receipt"."approved_at" IS NOT NULL AND "finance_receipt"."approved_calculation_hash" IS NOT NULL)),
	CONSTRAINT "finance_receipt_cancel_chk" CHECK ("finance_receipt"."status" <> 'CANCELADO' OR ("finance_receipt"."cancelled_at" IS NOT NULL AND btrim(coalesce("finance_receipt"."cancel_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_reserve_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"pool_key" text NOT NULL,
	"pool_label" text NOT NULL,
	"nature" "finance_rule_nature" NOT NULL,
	"kind" "finance_reserve_movement_kind" NOT NULL,
	"unique_per_process" boolean DEFAULT false NOT NULL,
	"amount_cents" bigint NOT NULL,
	"process_id" text,
	"closing_id" text,
	"receipt_id" text,
	"closing_line_id" text,
	"movement_date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"status" "finance_record_status" DEFAULT 'ATIVO' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_user_id" text,
	"reversed_at" timestamp with time zone,
	"reversal_reason" text,
	CONSTRAINT "finance_reserve_movement_amount_chk" CHECK ("finance_reserve_movement"."amount_cents" > 0),
	CONSTRAINT "finance_reserve_movement_nature_chk" CHECK ("finance_reserve_movement"."nature" IN ('PROVISAO', 'RESERVA')),
	CONSTRAINT "finance_reserve_movement_constitution_chk" CHECK ("finance_reserve_movement"."kind" <> 'CONSTITUICAO' OR ("finance_reserve_movement"."closing_id" IS NOT NULL AND "finance_reserve_movement"."receipt_id" IS NOT NULL AND "finance_reserve_movement"."process_id" IS NOT NULL AND "finance_reserve_movement"."closing_line_id" IS NOT NULL)),
	CONSTRAINT "finance_reserve_movement_origin_chk" CHECK ("finance_reserve_movement"."kind" = 'CONSTITUICAO' OR btrim("finance_reserve_movement"."description") <> ''),
	CONSTRAINT "finance_reserve_movement_unique_chk" CHECK (NOT "finance_reserve_movement"."unique_per_process" OR "finance_reserve_movement"."process_id" IS NOT NULL),
	CONSTRAINT "finance_reserve_movement_reversal_chk" CHECK ("finance_reserve_movement"."status" = 'ATIVO' OR ("finance_reserve_movement"."reversed_at" IS NOT NULL AND btrim(coalesce("finance_reserve_movement"."reversal_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"lineage_id" text NOT NULL,
	"version" integer NOT NULL,
	"stage" "finance_rule_stage" NOT NULL,
	"nature" "finance_rule_nature" NOT NULL,
	"recipient_id" text,
	"pool_key" text,
	"pool_label" text,
	"work_type" text DEFAULT '' NOT NULL,
	"value_type" "finance_value_type" NOT NULL,
	"basis_points" integer,
	"fixed_cents" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uniqueness" "finance_uniqueness" DEFAULT 'NENHUMA' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"origin" "finance_config_origin" DEFAULT 'MANUAL' NOT NULL,
	"import_batch_id" text,
	"status" "finance_rule_status" DEFAULT 'ATIVA' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"revoke_reason" text,
	CONSTRAINT "finance_rule_validity_chk" CHECK ("finance_rule"."valid_to" IS NULL OR "finance_rule"."valid_to" >= "finance_rule"."valid_from"),
	CONSTRAINT "finance_rule_value_chk" CHECK (("finance_rule"."value_type" = 'PERCENTUAL' AND "finance_rule"."fixed_cents" IS NULL AND ("finance_rule"."basis_points" IS NULL OR "finance_rule"."basis_points" BETWEEN 0 AND 10000)) OR ("finance_rule"."value_type" = 'VALOR_FIXO' AND "finance_rule"."basis_points" IS NULL AND ("finance_rule"."fixed_cents" IS NULL OR "finance_rule"."fixed_cents" >= 0))),
	CONSTRAINT "finance_rule_nature_chk" CHECK (("finance_rule"."nature" = 'CREDITO' AND "finance_rule"."recipient_id" IS NOT NULL AND "finance_rule"."pool_key" IS NULL) OR ("finance_rule"."nature" <> 'CREDITO' AND "finance_rule"."recipient_id" IS NULL AND btrim(coalesce("finance_rule"."pool_key", '')) <> '' AND btrim(coalesce("finance_rule"."pool_label", '')) <> '')),
	CONSTRAINT "finance_rule_stage_nature_chk" CHECK (("finance_rule"."stage" = 'PROVISAO_RECEITA' AND "finance_rule"."nature" = 'PROVISAO') OR ("finance_rule"."stage" = 'DEDUCAO_LIQUIDA' AND "finance_rule"."nature" IN ('CREDITO', 'PROVISAO')) OR ("finance_rule"."stage" = 'RESERVA' AND "finance_rule"."nature" = 'RESERVA') OR ("finance_rule"."stage" IN ('PARTICIPACAO_RESULTADO', 'DISTRIBUICAO_FINAL') AND "finance_rule"."nature" = 'CREDITO')),
	CONSTRAINT "finance_rule_final_percent_chk" CHECK ("finance_rule"."stage" <> 'DISTRIBUICAO_FINAL' OR "finance_rule"."value_type" = 'PERCENTUAL'),
	CONSTRAINT "finance_rule_uniqueness_chk" CHECK ("finance_rule"."uniqueness" = 'NENHUMA' OR "finance_rule"."stage" = 'RESERVA'),
	CONSTRAINT "finance_rule_order_chk" CHECK ("finance_rule"."sort_order" >= 0),
	CONSTRAINT "finance_rule_version_chk" CHECK ("finance_rule"."version" >= 1),
	CONSTRAINT "finance_rule_revoked_chk" CHECK ("finance_rule"."status" = 'ATIVA' OR ("finance_rule"."revoked_at" IS NOT NULL AND btrim(coalesce("finance_rule"."revoke_reason", '')) <> ''))
);--> statement-breakpoint
CREATE TABLE "finance_rule_housing_complex" (
	"rule_id" text NOT NULL,
	"housing_complex_id" text NOT NULL,
	CONSTRAINT "finance_rule_housing_complex_rule_id_housing_complex_id_pk" PRIMARY KEY("rule_id","housing_complex_id")
);--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_credit_id_finance_credit_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."finance_credit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_adjustment" ADD CONSTRAINT "finance_adjustment_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_payout_id_finance_payout_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."finance_payout"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_reserve_movement_id_finance_reserve_movement_id_fk" FOREIGN KEY ("reserve_movement_id") REFERENCES "public"."finance_reserve_movement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_attachment" ADD CONSTRAINT "finance_attachment_removed_by_user_id_user_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing" ADD CONSTRAINT "finance_closing_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing" ADD CONSTRAINT "finance_closing_reversed_by_user_id_user_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_item" ADD CONSTRAINT "finance_closing_item_closing_id_finance_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."finance_closing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_item" ADD CONSTRAINT "finance_closing_item_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_closing_id_finance_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."finance_closing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_closing_item_id_finance_closing_item_id_fk" FOREIGN KEY ("closing_item_id") REFERENCES "public"."finance_closing_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_rule_id_finance_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."finance_rule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_closing_line" ADD CONSTRAINT "finance_closing_line_recipient_id_finance_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."finance_recipient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_credit" ADD CONSTRAINT "finance_credit_closing_id_finance_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."finance_closing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_credit" ADD CONSTRAINT "finance_credit_closing_line_id_finance_closing_line_id_fk" FOREIGN KEY ("closing_line_id") REFERENCES "public"."finance_closing_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_credit" ADD CONSTRAINT "finance_credit_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_credit" ADD CONSTRAINT "finance_credit_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_credit" ADD CONSTRAINT "finance_credit_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_credit" ADD CONSTRAINT "finance_credit_recipient_id_finance_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."finance_recipient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_import_batch" ADD CONSTRAINT "finance_import_batch_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout" ADD CONSTRAINT "finance_payout_credit_id_finance_credit_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."finance_credit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout" ADD CONSTRAINT "finance_payout_recipient_id_finance_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."finance_recipient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout" ADD CONSTRAINT "finance_payout_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_payout" ADD CONSTRAINT "finance_payout_reversed_by_user_id_user_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_receipt" ADD CONSTRAINT "finance_receipt_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_closing_id_finance_closing_id_fk" FOREIGN KEY ("closing_id") REFERENCES "public"."finance_closing"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_receipt_id_finance_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."finance_receipt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_closing_line_id_finance_closing_line_id_fk" FOREIGN KEY ("closing_line_id") REFERENCES "public"."finance_closing_line"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_reserve_movement" ADD CONSTRAINT "finance_reserve_movement_reversed_by_user_id_user_id_fk" FOREIGN KEY ("reversed_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_recipient_id_finance_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."finance_recipient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_import_batch_id_finance_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."finance_import_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule" ADD CONSTRAINT "finance_rule_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule_housing_complex" ADD CONSTRAINT "finance_rule_housing_complex_rule_id_finance_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."finance_rule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_rule_housing_complex" ADD CONSTRAINT "finance_rule_housing_complex_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_adjustment_idempotency_idx" ON "finance_adjustment" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "finance_adjustment_credit_idx" ON "finance_adjustment" USING btree ("credit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_attachment_object_idx" ON "finance_attachment" USING btree ("bucket_name","object_key");--> statement-breakpoint
CREATE INDEX "finance_attachment_receipt_idx" ON "finance_attachment" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "finance_attachment_payout_idx" ON "finance_attachment" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "finance_attachment_reserve_idx" ON "finance_attachment" USING btree ("reserve_movement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_code_idx" ON "finance_closing" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_idempotency_idx" ON "finance_closing" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "finance_closing_status_idx" ON "finance_closing" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_item_closing_receipt_idx" ON "finance_closing_item" USING btree ("closing_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_item_active_receipt_idx" ON "finance_closing_item" USING btree ("receipt_id") WHERE "finance_closing_item"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closing_line_item_order_idx" ON "finance_closing_line" USING btree ("closing_item_id","step_order");--> statement-breakpoint
CREATE INDEX "finance_closing_line_closing_idx" ON "finance_closing_line" USING btree ("closing_id");--> statement-breakpoint
CREATE INDEX "finance_closing_line_recipient_idx" ON "finance_closing_line" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "finance_closing_line_process_idx" ON "finance_closing_line" USING btree ("process_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_credit_line_idx" ON "finance_credit" USING btree ("closing_line_id");--> statement-breakpoint
CREATE INDEX "finance_credit_recipient_idx" ON "finance_credit" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "finance_credit_closing_idx" ON "finance_credit" USING btree ("closing_id");--> statement-breakpoint
CREATE INDEX "finance_credit_process_idx" ON "finance_credit" USING btree ("process_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_import_batch_idempotency_idx" ON "finance_import_batch" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_payout_idempotency_idx" ON "finance_payout" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "finance_payout_credit_idx" ON "finance_payout" USING btree ("credit_id");--> statement-breakpoint
CREATE INDEX "finance_payout_recipient_idx" ON "finance_payout" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "finance_payout_paid_on_idx" ON "finance_payout" USING btree ("paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_receipt_idempotency_idx" ON "finance_receipt" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "finance_receipt_process_idx" ON "finance_receipt" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "finance_receipt_status_idx" ON "finance_receipt" USING btree ("status");--> statement-breakpoint
CREATE INDEX "finance_receipt_release_date_idx" ON "finance_receipt" USING btree ("release_date");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reserve_movement_idempotency_idx" ON "finance_reserve_movement" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reserve_unique_constitution_idx" ON "finance_reserve_movement" USING btree ("pool_key","process_id") WHERE "finance_reserve_movement"."kind" = 'CONSTITUICAO' AND "finance_reserve_movement"."status" = 'ATIVO' AND "finance_reserve_movement"."unique_per_process";--> statement-breakpoint
CREATE INDEX "finance_reserve_movement_pool_idx" ON "finance_reserve_movement" USING btree ("pool_key");--> statement-breakpoint
CREATE INDEX "finance_reserve_movement_process_idx" ON "finance_reserve_movement" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "finance_reserve_movement_closing_idx" ON "finance_reserve_movement" USING btree ("closing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_rule_lineage_version_idx" ON "finance_rule" USING btree ("lineage_id","version");--> statement-breakpoint
CREATE INDEX "finance_rule_recipient_idx" ON "finance_rule" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "finance_rule_status_idx" ON "finance_rule" USING btree ("status");--> statement-breakpoint
CREATE INDEX "finance_rule_hc_complex_idx" ON "finance_rule_housing_complex" USING btree ("housing_complex_id");--> statement-breakpoint
ALTER TABLE "finance_recipient" ADD COLUMN "origin" "finance_config_origin" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_recipient" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "finance_recipient" ADD CONSTRAINT "finance_recipient_import_batch_id_finance_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."finance_import_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Integridade no banco (defesa em profundidade; o servico tambem valida).
CREATE TRIGGER finance_closing_line_immutable BEFORE UPDATE OR DELETE ON finance_closing_line
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER finance_import_batch_immutable BEFORE UPDATE OR DELETE ON finance_import_batch
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER finance_rule_housing_complex_immutable BEFORE UPDATE OR DELETE ON finance_rule_housing_complex
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER finance_adjustment_immutable BEFORE UPDATE OR DELETE ON finance_adjustment
  FOR EACH ROW EXECUTE FUNCTION finance_forbid_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finance_closing_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fechamento nao pode ser apagado; use estorno.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'reversed_by_user_id', 'reversed_at', 'reversal_reason'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'reversed_by_user_id', 'reversed_at', 'reversal_reason']) THEN
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
CREATE OR REPLACE FUNCTION finance_closing_item_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Item de fechamento nao pode ser apagado.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'is_active') IS DISTINCT FROM (to_jsonb(OLD) - 'is_active')
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
CREATE TRIGGER finance_reserve_movement_guard BEFORE UPDATE OR DELETE ON finance_reserve_movement
  FOR EACH ROW EXECUTE FUNCTION finance_status_record_guard();
--> statement-breakpoint
CREATE TRIGGER finance_payout_guard BEFORE UPDATE OR DELETE ON finance_payout
  FOR EACH ROW EXECUTE FUNCTION finance_status_record_guard();
--> statement-breakpoint
-- Regra: versao ATIVA so pode ser revogada ou ter a vigencia ENCERRADA (valid_to
-- menor); nunca apagada ou alterada (nova versao = nova linha).
CREATE OR REPLACE FUNCTION finance_rule_guard() RETURNS trigger AS $$
DECLARE
  frozen text[] := ARRAY['status', 'revoked_at', 'revoked_by_user_id', 'revoke_reason', 'valid_to'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Regra nao pode ser apagada; revogue ou encerre a vigencia.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'REVOGADA' THEN
    RAISE EXCEPTION 'Regra revogada nao pode ser alterada.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - frozen) IS DISTINCT FROM (to_jsonb(OLD) - frozen) THEN
    RAISE EXCEPTION 'Versao de regra e imutavel; crie uma nova versao.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.valid_to IS DISTINCT FROM OLD.valid_to
     AND (NEW.valid_to IS NULL OR (OLD.valid_to IS NOT NULL AND NEW.valid_to >= OLD.valid_to)) THEN
    RAISE EXCEPTION 'Vigencia so pode ser encerrada mais cedo, nunca estendida.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_rule_guard BEFORE UPDATE OR DELETE ON finance_rule
  FOR EACH ROW EXECUTE FUNCTION finance_rule_guard();
--> statement-breakpoint
-- Recebimento: maquina de estados V3 §23 no banco.
CREATE OR REPLACE FUNCTION finance_receipt_guard() RETURNS trigger AS $$
DECLARE
  allowed text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Recebimento nao pode ser apagado; use cancelamento.' USING ERRCODE = 'restrict_violation';
  END IF;
  allowed := CASE OLD.status::text
    WHEN 'RASCUNHO' THEN ARRAY['RASCUNHO', 'EM_PREVIA', 'BLOQUEADO', 'CANCELADO']
    WHEN 'EM_PREVIA' THEN ARRAY['EM_PREVIA', 'BLOQUEADO', 'APTO', 'RASCUNHO', 'CANCELADO']
    WHEN 'BLOQUEADO' THEN ARRAY['BLOQUEADO', 'EM_PREVIA', 'RASCUNHO', 'CANCELADO']
    WHEN 'APTO' THEN ARRAY['APTO', 'FECHADO', 'EM_PREVIA', 'BLOQUEADO', 'RASCUNHO', 'CANCELADO']
    WHEN 'FECHADO' THEN ARRAY['FECHADO', 'EM_PREVIA']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW.status::text = ANY (allowed)) THEN
    RAISE EXCEPTION 'Transicao de recebimento invalida: % -> %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'FECHADO'
     AND (NEW.process_id, NEW.kind, NEW.amount_cents, NEW.release_date, NEW.client_registration_date)
         IS DISTINCT FROM (OLD.process_id, OLD.kind, OLD.amount_cents, OLD.release_date, OLD.client_registration_date) THEN
    RAISE EXCEPTION 'Recebimento fechado nao pode ter valores alterados.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_receipt_guard BEFORE UPDATE OR DELETE ON finance_receipt
  FOR EACH ROW EXECUTE FUNCTION finance_receipt_guard();
--> statement-breakpoint
-- Credito: so paid/adjusted/status/updated_at mudam; ESTORNADO e final e exige
-- nada pago.
CREATE FUNCTION finance_credit_guard() RETURNS trigger AS $$
DECLARE
  mutable text[] := ARRAY['paid_cents', 'adjusted_cents', 'status', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Credito nao pode ser apagado.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'Credito e imutavel; use baixa, ajuste ou estorno.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'ESTORNADO' AND NEW.status <> 'ESTORNADO' THEN
    RAISE EXCEPTION 'Credito estornado nao pode ser reaberto.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'ESTORNADO' AND NEW.paid_cents > 0 THEN
    RAISE EXCEPTION 'Credito com baixa ativa nao pode ser estornado; estorne as baixas antes.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_credit_guard BEFORE UPDATE OR DELETE ON finance_credit
  FOR EACH ROW EXECUTE FUNCTION finance_credit_guard();
--> statement-breakpoint
-- Recalcula pago/ajustado/estado do credito a partir das baixas e ajustes.
CREATE FUNCTION finance_credit_refresh(target_credit_id text) RETURNS void AS $$
DECLARE
  paid bigint;
  adjusted bigint;
BEGIN
  SELECT coalesce(sum(amount_cents), 0) INTO paid
    FROM finance_payout WHERE credit_id = target_credit_id AND status = 'ATIVO';
  SELECT coalesce(sum(amount_cents), 0) INTO adjusted
    FROM finance_adjustment WHERE credit_id = target_credit_id;
  UPDATE finance_credit c
     SET paid_cents = paid,
         adjusted_cents = adjusted,
         updated_at = now(),
         status = CASE
           WHEN c.status = 'ESTORNADO' THEN 'ESTORNADO'::finance_credit_status
           WHEN paid <= 0 THEN (CASE WHEN c.amount_cents + adjusted = 0 THEN 'PAGO' ELSE 'ABERTO' END)::finance_credit_status
           WHEN paid >= c.amount_cents + adjusted THEN 'PAGO'::finance_credit_status
           ELSE 'PARCIALMENTE_PAGO'::finance_credit_status
         END
   WHERE c.id = target_credit_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Baixa: trava o credito, impede acumulado acima do devido (INV-06) e grava o saldo
-- apos a operacao. Serializa baixas concorrentes no mesmo credito.
CREATE FUNCTION finance_payout_before_insert() RETURNS trigger AS $$
DECLARE
  credit_row finance_credit%ROWTYPE;
  paid bigint;
  adjusted bigint;
  due bigint;
BEGIN
  SELECT * INTO credit_row FROM finance_credit WHERE id = NEW.credit_id FOR UPDATE;
  IF credit_row.status = 'ESTORNADO' THEN
    RAISE EXCEPTION 'Credito estornado nao aceita baixa.' USING ERRCODE = 'check_violation';
  END IF;
  IF credit_row.recipient_id <> NEW.recipient_id THEN
    RAISE EXCEPTION 'Baixa deve ser do mesmo recebedor do credito.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO paid
    FROM finance_payout WHERE credit_id = NEW.credit_id AND status = 'ATIVO';
  SELECT coalesce(sum(amount_cents), 0) INTO adjusted
    FROM finance_adjustment WHERE credit_id = NEW.credit_id;
  due := credit_row.amount_cents + adjusted;
  IF NEW.amount_cents > due - paid THEN
    RAISE EXCEPTION 'Baixa excede o saldo do credito.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.balance_after_cents := due - paid - NEW.amount_cents;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_payout_before_insert BEFORE INSERT ON finance_payout
  FOR EACH ROW EXECUTE FUNCTION finance_payout_before_insert();
--> statement-breakpoint
CREATE FUNCTION finance_payout_after_change() RETURNS trigger AS $$
BEGIN
  PERFORM finance_credit_refresh(NEW.credit_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_payout_after_change AFTER INSERT OR UPDATE ON finance_payout
  FOR EACH ROW EXECUTE FUNCTION finance_payout_after_change();
--> statement-breakpoint
-- Ajuste: trava o credito; devido nunca abaixo de zero nem abaixo do ja pago.
CREATE FUNCTION finance_adjustment_before_insert() RETURNS trigger AS $$
DECLARE
  credit_row finance_credit%ROWTYPE;
  paid bigint;
  adjusted bigint;
BEGIN
  SELECT * INTO credit_row FROM finance_credit WHERE id = NEW.credit_id FOR UPDATE;
  IF credit_row.status = 'ESTORNADO' THEN
    RAISE EXCEPTION 'Credito estornado nao aceita ajuste.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO paid
    FROM finance_payout WHERE credit_id = NEW.credit_id AND status = 'ATIVO';
  SELECT coalesce(sum(amount_cents), 0) INTO adjusted
    FROM finance_adjustment WHERE credit_id = NEW.credit_id;
  IF credit_row.amount_cents + adjusted + NEW.amount_cents < paid THEN
    RAISE EXCEPTION 'Ajuste deixaria o devido abaixo do ja pago.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_adjustment_before_insert BEFORE INSERT ON finance_adjustment
  FOR EACH ROW EXECUTE FUNCTION finance_adjustment_before_insert();
--> statement-breakpoint
CREATE FUNCTION finance_adjustment_after_insert() RETURNS trigger AS $$
BEGIN
  PERFORM finance_credit_refresh(NEW.credit_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_adjustment_after_insert AFTER INSERT ON finance_adjustment
  FOR EACH ROW EXECUTE FUNCTION finance_adjustment_after_insert();
--> statement-breakpoint
-- Reservas: serializa escritores da mesma reserva e impede saldo negativo global e
-- por processo ("sem criar saldo inexistente").
CREATE FUNCTION finance_reserve_lock() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('finance_reserve:' || NEW.pool_key));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_reserve_lock BEFORE INSERT OR UPDATE ON finance_reserve_movement
  FOR EACH ROW EXECUTE FUNCTION finance_reserve_lock();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION finance_reserve_balance_check() RETURNS trigger AS $$
DECLARE
  balance bigint;
BEGIN
  SELECT coalesce(sum(CASE WHEN kind = 'CONSTITUICAO' THEN amount_cents ELSE -amount_cents END), 0)
    INTO balance
    FROM finance_reserve_movement
    WHERE status = 'ATIVO' AND pool_key = NEW.pool_key;
  IF balance < 0 THEN
    RAISE EXCEPTION 'Saldo da reserva % ficaria negativo.', NEW.pool_label USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.process_id IS NOT NULL THEN
    SELECT coalesce(sum(CASE WHEN kind = 'CONSTITUICAO' THEN amount_cents ELSE -amount_cents END), 0)
      INTO balance
      FROM finance_reserve_movement
      WHERE status = 'ATIVO' AND pool_key = NEW.pool_key AND process_id = NEW.process_id;
    IF balance < 0 THEN
      RAISE EXCEPTION 'Saldo da reserva % do processo ficaria negativo.', NEW.pool_label USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER finance_reserve_balance_check AFTER INSERT OR UPDATE ON finance_reserve_movement
  FOR EACH ROW EXECUTE FUNCTION finance_reserve_balance_check();

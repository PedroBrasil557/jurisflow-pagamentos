CREATE TYPE "public"."quitacao_job_subject_type" AS ENUM('titular', 'process');--> statement-breakpoint
CREATE TYPE "public"."quitacao_job_status" AS ENUM('queued', 'running', 'done', 'dead');--> statement-breakpoint
CREATE TYPE "public"."quitacao_job_result" AS ENUM('quitado', 'nao_encontrado', 'erro');--> statement-breakpoint
CREATE TYPE "public"."titular_quitacao_status" AS ENUM('idle', 'pending', 'quitado', 'nao_encontrado', 'erro');--> statement-breakpoint
CREATE TYPE "public"."titular_documento_tipo" AS ENUM('termo_quitacao');--> statement-breakpoint
CREATE TYPE "public"."titular_documento_source" AS ENUM('rpa', 'manual');--> statement-breakpoint
CREATE TABLE "quitacao_job" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" "quitacao_job_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"cpf" text NOT NULL,
	"status" "quitacao_job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"lease_expires_at" timestamp,
	"lease_token" text,
	"result" "quitacao_job_result",
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quitacao_job_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"result" "quitacao_job_result",
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titular_contrato_caixa" (
	"id" text PRIMARY KEY NOT NULL,
	"uf" text NOT NULL,
	"municipio" text NOT NULL,
	"modalidade" text NOT NULL,
	"empreendimento" text NOT NULL,
	"mutuario_nome" text NOT NULL,
	"cpf" text NOT NULL,
	"pis" text,
	"data_assinatura" date,
	"logradouro" text,
	"numero_imovel" text,
	"complemento" text DEFAULT '' NOT NULL,
	"bairro" text,
	"quitacao_status" "titular_quitacao_status" DEFAULT 'idle' NOT NULL,
	"quitacao_message" text,
	"quitacao_last_checked_at" timestamp,
	"created_by_user_id" text,
	"import_batch_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titular_documento" (
	"id" text PRIMARY KEY NOT NULL,
	"titular_id" text NOT NULL,
	"tipo" "titular_documento_tipo" NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"source" "titular_documento_source" DEFAULT 'rpa' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quitacao_job_attempt" ADD CONSTRAINT "quitacao_job_attempt_job_id_quitacao_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."quitacao_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titular_contrato_caixa" ADD CONSTRAINT "titular_contrato_caixa_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titular_documento" ADD CONSTRAINT "titular_documento_titular_id_titular_contrato_caixa_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular_contrato_caixa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quitacao_job_claim_idx" ON "quitacao_job" USING btree ("status","run_after","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "quitacao_job_subject_idx" ON "quitacao_job" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "quitacao_job_cpf_idx" ON "quitacao_job" USING btree ("cpf");--> statement-breakpoint
CREATE INDEX "quitacao_job_attempt_job_idx" ON "quitacao_job_attempt" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "titular_cpf_idx" ON "titular_contrato_caixa" USING btree ("cpf");--> statement-breakpoint
CREATE INDEX "titular_quitacao_status_idx" ON "titular_contrato_caixa" USING btree ("quitacao_status");--> statement-breakpoint
CREATE INDEX "titular_empreendimento_idx" ON "titular_contrato_caixa" USING btree ("empreendimento");--> statement-breakpoint
CREATE INDEX "titular_uf_idx" ON "titular_contrato_caixa" USING btree ("uf");--> statement-breakpoint
CREATE INDEX "titular_municipio_idx" ON "titular_contrato_caixa" USING btree ("municipio");--> statement-breakpoint
CREATE UNIQUE INDEX "titular_natural_idx" ON "titular_contrato_caixa" USING btree ("cpf","empreendimento","complemento");--> statement-breakpoint
CREATE INDEX "titular_documento_titular_idx" ON "titular_documento" USING btree ("titular_id");--> statement-breakpoint
CREATE UNIQUE INDEX "titular_documento_titular_tipo_idx" ON "titular_documento" USING btree ("titular_id","tipo");

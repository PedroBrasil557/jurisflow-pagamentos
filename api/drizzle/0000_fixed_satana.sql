CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'attorney');--> statement-breakpoint
CREATE TYPE "public"."process_document_status" AS ENUM('PENDENTE', 'ANEXADO', 'OK_SEM_ARQUIVO', 'APROVADO', 'REJEITADO');--> statement-breakpoint
CREATE TYPE "public"."process_history_event_type" AS ENUM('CREATED', 'UPDATED', 'STATUS_CHANGED', 'CANCELLED', 'PDF_GENERATED', 'DOCUMENT_UPLOADED', 'DOCUMENT_REPLACED', 'DOCUMENT_DELETED', 'DOCUMENT_MARKED_OK_WITHOUT_FILE', 'DOCUMENT_UNMARKED_OK_WITHOUT_FILE', 'DOCUMENT_OBSERVATION_UPDATED');--> statement-breakpoint
CREATE TYPE "public"."process_status" AS ENUM('EM_DOCUMENTACAO', 'DOCUMENTACAO_PRONTA', 'EM_PROCESSO', 'FINALIZADO', 'CANCELADO');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"username" text,
	"display_username" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "housing_complex" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" "process_status" DEFAULT 'EM_DOCUMENTACAO' NOT NULL,
	"full_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"nationality" text NOT NULL,
	"marital_status" text NOT NULL,
	"profession" text NOT NULL,
	"owner_type" text NOT NULL,
	"cpf" text NOT NULL,
	"rg" text NOT NULL,
	"cadunico" text NOT NULL,
	"property_paid_off" text NOT NULL,
	"delivered_more_than_ten_years" text NOT NULL,
	"purchase_agreement_less_than_ten_years" text NOT NULL,
	"state" text NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"housing_complex" text NOT NULL,
	"street" text NOT NULL,
	"number" text NOT NULL,
	"complement" text NOT NULL,
	"zipcode" text NOT NULL,
	"email" text NOT NULL,
	"whatsapp" text NOT NULL,
	"witness_1_id" text NOT NULL,
	"witness_2_id" text NOT NULL,
	"observation" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"assigned_attorney_id" text,
	"legal_process_number" text,
	"cause_value" text,
	"protocol_date" date,
	"documentation_ready_at" timestamp,
	"started_at" timestamp,
	"finalized_at" timestamp,
	"cancelled_at" timestamp,
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "process_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "process_document" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"document_type_id" text NOT NULL,
	"status" "process_document_status" DEFAULT 'PENDENTE' NOT NULL,
	"observation" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_document_file" (
	"id" text PRIMARY KEY NOT NULL,
	"process_document_id" text NOT NULL,
	"bucket_name" text NOT NULL,
	"object_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_in_bytes" integer NOT NULL,
	"revision" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"replaced_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "process_document_type" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"allows_multiple_files" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_generated_document" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"model_key" text NOT NULL,
	"model_label" text NOT NULL,
	"bucket_name" text NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_in_bytes" integer NOT NULL,
	"page_count" integer NOT NULL,
	"data_snapshot" jsonb,
	"generated_by_user_id" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_history" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"event_type" "process_history_event_type" NOT NULL,
	"from_status" "process_status",
	"to_status" "process_status",
	"changed_fields" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_witness_1_id_user_id_fk" FOREIGN KEY ("witness_1_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_witness_2_id_user_id_fk" FOREIGN KEY ("witness_2_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_assigned_attorney_id_user_id_fk" FOREIGN KEY ("assigned_attorney_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_document" ADD CONSTRAINT "process_document_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_document" ADD CONSTRAINT "process_document_document_type_id_process_document_type_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."process_document_type"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_document_file" ADD CONSTRAINT "process_document_file_process_document_id_process_document_id_fk" FOREIGN KEY ("process_document_id") REFERENCES "public"."process_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_document_file" ADD CONSTRAINT "process_document_file_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_generated_document" ADD CONSTRAINT "process_generated_document_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_generated_document" ADD CONSTRAINT "process_generated_document_generated_by_user_id_user_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_history" ADD CONSTRAINT "process_history_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_history" ADD CONSTRAINT "process_history_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "housing_complex_name_idx" ON "housing_complex" USING btree ("name");--> statement-breakpoint
CREATE INDEX "process_status_idx" ON "process" USING btree ("status");--> statement-breakpoint
CREATE INDEX "process_created_by_user_id_idx" ON "process" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "process_assigned_attorney_id_idx" ON "process" USING btree ("assigned_attorney_id");--> statement-breakpoint
CREATE INDEX "process_witness_1_id_idx" ON "process" USING btree ("witness_1_id");--> statement-breakpoint
CREATE INDEX "process_witness_2_id_idx" ON "process" USING btree ("witness_2_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_document_process_type_idx" ON "process_document" USING btree ("process_id","document_type_id");--> statement-breakpoint
CREATE INDEX "process_document_status_idx" ON "process_document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "process_document_process_id_idx" ON "process_document" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "process_document_document_type_id_idx" ON "process_document" USING btree ("document_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_document_file_storage_object_idx" ON "process_document_file" USING btree ("bucket_name","object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "process_document_file_revision_idx" ON "process_document_file" USING btree ("process_document_id","revision");--> statement-breakpoint
CREATE INDEX "process_document_file_process_document_id_idx" ON "process_document_file" USING btree ("process_document_id");--> statement-breakpoint
CREATE INDEX "process_document_file_uploaded_by_user_id_idx" ON "process_document_file" USING btree ("uploaded_by_user_id");--> statement-breakpoint
CREATE INDEX "process_document_file_is_current_idx" ON "process_document_file" USING btree ("is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "process_document_type_key_idx" ON "process_document_type" USING btree ("key");--> statement-breakpoint
CREATE INDEX "process_document_type_sort_order_idx" ON "process_document_type" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "process_document_type_is_active_idx" ON "process_document_type" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "process_generated_document_storage_object_idx" ON "process_generated_document" USING btree ("bucket_name","object_key");--> statement-breakpoint
CREATE INDEX "process_generated_document_process_id_idx" ON "process_generated_document" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "process_generated_document_model_key_idx" ON "process_generated_document" USING btree ("model_key");--> statement-breakpoint
CREATE INDEX "process_generated_document_generated_by_user_id_idx" ON "process_generated_document" USING btree ("generated_by_user_id");--> statement-breakpoint
CREATE INDEX "process_generated_document_generated_at_idx" ON "process_generated_document" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "process_history_process_id_idx" ON "process_history" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "process_history_actor_user_id_idx" ON "process_history" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "process_history_event_type_idx" ON "process_history" USING btree ("event_type");
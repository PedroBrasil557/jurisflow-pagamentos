CREATE TABLE IF NOT EXISTS "process_batch_file" (
	"id" text PRIMARY KEY NOT NULL,
	"process_id" text NOT NULL,
	"bucket_name" text NOT NULL,
	"object_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_in_bytes" integer NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "process" ALTER COLUMN "status" SET DEFAULT 'CADASTRADO';--> statement-breakpoint
ALTER TABLE "process" ALTER COLUMN "delivered_more_than_ten_years" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "process" ALTER COLUMN "purchase_agreement_less_than_ten_years" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_contract_signed" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_full_name" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_birth_date" date;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_nationality" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_marital_status" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_profession" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_cpf" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_rg" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_cadunico" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_same_address" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_state" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_city" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_district" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_housing_complex" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_street" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_number" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_complement" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN IF NOT EXISTS "spouse_zipcode" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_batch_file_process_id_process_id_fk') THEN
    ALTER TABLE "process_batch_file" ADD CONSTRAINT "process_batch_file_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_batch_file_uploaded_by_user_id_user_id_fk') THEN
    ALTER TABLE "process_batch_file" ADD CONSTRAINT "process_batch_file_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "process_batch_file_storage_object_idx" ON "process_batch_file" USING btree ("bucket_name","object_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_batch_file_process_id_idx" ON "process_batch_file" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_batch_file_uploaded_by_user_id_idx" ON "process_batch_file" USING btree ("uploaded_by_user_id");

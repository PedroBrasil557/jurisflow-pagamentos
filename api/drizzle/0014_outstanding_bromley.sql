ALTER TYPE "public"."process_history_event_type" ADD VALUE 'CAIXA_OWNER_AUTO_SET';--> statement-breakpoint
ALTER TYPE "public"."process_history_event_type" ADD VALUE 'CAIXA_OWNER_REVIEW_REQUIRED';--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "owner_type_source" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "caixa_analysis_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "process_history" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
INSERT INTO "user" ("id", "name", "email", "role", "is_active", "must_change_password", "email_verified")
VALUES ('jurisflow-bot', 'JurisFlow Bot', 'bot@jurisflow.internal', 'user', false, false, true)
ON CONFLICT ("id") DO NOTHING;
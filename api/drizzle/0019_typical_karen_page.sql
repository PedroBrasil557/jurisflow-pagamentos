ALTER TABLE "process" ADD COLUMN "housing_complex_source" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "procuracao_conjunto_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "procuracao_conjunto_started_at" timestamp;
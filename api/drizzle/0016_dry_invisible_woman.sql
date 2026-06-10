ALTER TABLE "process" ADD COLUMN "caixa_quitacao_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "caixa_quitacao_message" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "caixa_quitacao_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "caixa_quitacao_attempts" integer DEFAULT 0 NOT NULL;
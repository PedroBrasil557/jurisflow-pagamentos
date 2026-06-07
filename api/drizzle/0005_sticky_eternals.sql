ALTER TABLE "process_batch_file" ADD COLUMN "split_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "process_batch_file" ADD COLUMN "split_message" text;--> statement-breakpoint
ALTER TABLE "process_batch_file" ADD COLUMN "split_updated_at" timestamp;
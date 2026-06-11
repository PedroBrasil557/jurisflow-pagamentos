ALTER TABLE "process_batch_file" ADD COLUMN "split_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "process_batch_file" ADD COLUMN "split_lease_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "process_batch_file" ADD COLUMN "split_lease_token" text;--> statement-breakpoint
ALTER TABLE "process_batch_file" ADD COLUMN "split_dead_letter_at" timestamp;--> statement-breakpoint
CREATE INDEX "process_batch_file_split_claim_idx" ON "process_batch_file" USING btree ("split_status","split_lease_expires_at");
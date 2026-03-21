ALTER TYPE "public"."process_history_event_type" ADD VALUE IF NOT EXISTS 'BATCH_UPLOADED';--> statement-breakpoint
ALTER TYPE "public"."process_history_event_type" ADD VALUE IF NOT EXISTS 'BATCH_DELETED';--> statement-breakpoint
ALTER TYPE "public"."process_status" ADD VALUE IF NOT EXISTS 'CADASTRADO' BEFORE 'EM_DOCUMENTACAO';--> statement-breakpoint
ALTER TYPE "public"."process_status" ADD VALUE IF NOT EXISTS 'EM_LOTE' BEFORE 'EM_DOCUMENTACAO';

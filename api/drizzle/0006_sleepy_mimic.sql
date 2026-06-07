ALTER TYPE "public"."process_status" ADD VALUE 'RASCUNHO' BEFORE 'CADASTRADO';--> statement-breakpoint
ALTER TABLE "process" ALTER COLUMN "birth_date" DROP NOT NULL;
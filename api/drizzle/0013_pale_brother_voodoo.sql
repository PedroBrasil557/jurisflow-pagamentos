CREATE TYPE "public"."ai_analysis_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TYPE "public"."ai_analysis_trigger_source" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TABLE "ai_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"process_id" text NOT NULL,
	"context" jsonb,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"decision" jsonb,
	"confidence" smallint,
	"status" "ai_analysis_status" NOT NULL,
	"error_message" text,
	"tokens_input" integer,
	"tokens_output" integer,
	"duration_ms" integer,
	"trigger_source" "ai_analysis_trigger_source" NOT NULL,
	"triggered_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_analysis" ADD CONSTRAINT "ai_analysis_process_id_process_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."process"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis" ADD CONSTRAINT "ai_analysis_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_analysis_process_id_created_at_idx" ON "ai_analysis" USING btree ("process_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_analysis_kind_created_at_idx" ON "ai_analysis" USING btree ("kind","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_ai_analysis_mutation"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'ai_analysis e append-only: UPDATE/DELETE nao e permitido';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "ai_analysis_no_update" BEFORE UPDATE ON "ai_analysis" FOR EACH ROW EXECUTE FUNCTION "prevent_ai_analysis_mutation"();--> statement-breakpoint
CREATE TRIGGER "ai_analysis_no_delete" BEFORE DELETE ON "ai_analysis" FOR EACH ROW EXECUTE FUNCTION "prevent_ai_analysis_mutation"();
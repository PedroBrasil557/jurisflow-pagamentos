CREATE TABLE "titular_terceiro" (
	"id" text PRIMARY KEY NOT NULL,
	"titular_id" text NOT NULL,
	"nome" text NOT NULL,
	"telefones" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "titular_terceiro" ADD CONSTRAINT "titular_terceiro_titular_id_titular_contrato_caixa_id_fk" FOREIGN KEY ("titular_id") REFERENCES "public"."titular_contrato_caixa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "titular_terceiro_titular_idx" ON "titular_terceiro" USING btree ("titular_id");

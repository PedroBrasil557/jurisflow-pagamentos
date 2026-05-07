CREATE TYPE "public"."process_scope" AS ENUM('own', 'housing_complex', 'all');--> statement-breakpoint
ALTER TYPE "public"."process_history_event_type" ADD VALUE 'DOCUMENTATION_ASSIGNEE_SET';--> statement-breakpoint
ALTER TYPE "public"."process_history_event_type" ADD VALUE 'DOCUMENTATION_ASSIGNEE_REMOVED';--> statement-breakpoint
CREATE TABLE "permission_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"process_scope" "process_scope" DEFAULT 'own' NOT NULL,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_housing_complex" (
	"profile_id" text NOT NULL,
	"housing_complex_id" text NOT NULL,
	CONSTRAINT "profile_housing_complex_profile_id_housing_complex_id_pk" PRIMARY KEY("profile_id","housing_complex_id")
);
--> statement-breakpoint
CREATE TABLE "user_housing_complex" (
	"user_id" text NOT NULL,
	"housing_complex_id" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by_user_id" text,
	CONSTRAINT "user_housing_complex_user_id_housing_complex_id_pk" PRIMARY KEY("user_id","housing_complex_id")
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"assigned_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "housing_complex_id" text;--> statement-breakpoint
ALTER TABLE "process" ADD COLUMN "documentation_assignee_id" text;--> statement-breakpoint
ALTER TABLE "profile_housing_complex" ADD CONSTRAINT "profile_housing_complex_profile_id_permission_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."permission_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_housing_complex" ADD CONSTRAINT "profile_housing_complex_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_housing_complex" ADD CONSTRAINT "user_housing_complex_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_housing_complex" ADD CONSTRAINT "user_housing_complex_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_housing_complex" ADD CONSTRAINT "user_housing_complex_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_profile_id_permission_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."permission_profile"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phc_profile_id_idx" ON "profile_housing_complex" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "phc_housing_complex_id_idx" ON "profile_housing_complex" USING btree ("housing_complex_id");--> statement-breakpoint
CREATE INDEX "uhc_user_id_idx" ON "user_housing_complex" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uhc_housing_complex_id_idx" ON "user_housing_complex" USING btree ("housing_complex_id");--> statement-breakpoint
CREATE INDEX "user_profile_profile_id_idx" ON "user_profile" USING btree ("profile_id");--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process" ADD CONSTRAINT "process_documentation_assignee_id_user_id_fk" FOREIGN KEY ("documentation_assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "process_housing_complex_id_idx" ON "process" USING btree ("housing_complex_id");--> statement-breakpoint
CREATE INDEX "process_documentation_assignee_id_idx" ON "process" USING btree ("documentation_assignee_id");--> statement-breakpoint

-- Backfill: vincular processos existentes a conjuntos cadastrados pelo nome
UPDATE "process" AS p
SET "housing_complex_id" = hc."id"
FROM "housing_complex" AS hc
WHERE upper(trim(p."housing_complex")) = upper(trim(hc."name"));--> statement-breakpoint

-- Seed: perfis de sistema
INSERT INTO "permission_profile" ("id", "name", "description", "is_system", "process_scope", "permissions", "created_at", "updated_at") VALUES
(
  'system_profile_default_user',
  'Usuário Padrão',
  'Perfil padrão para novos usuários. Permite criar e gerenciar processos próprios.',
  true,
  'own',
  '{"process":{"create":true,"viewOwn":true,"editOwn":true,"editAny":false,"startLegal":false,"editLegal":false,"finalize":false,"cancelOwn":true,"cancelAny":false,"markDocumentationReady":false,"uploadChecklist":false,"deleteChecklistFile":false,"viewBatch":true,"uploadBatch":true,"deleteBatch":false,"generatePdf":true},"sections":{"dashboard":true,"checklist":true,"documentation":false,"legalData":false,"history":true,"batch":true}}',
  now(),
  now()
),
(
  'system_profile_attorney',
  'Advogado',
  'Acesso completo a todos os processos, incluindo ações jurídicas.',
  true,
  'all',
  '{"process":{"create":true,"viewOwn":true,"editOwn":true,"editAny":true,"startLegal":true,"editLegal":true,"finalize":true,"cancelOwn":true,"cancelAny":true,"markDocumentationReady":true,"uploadChecklist":true,"deleteChecklistFile":true,"viewBatch":true,"uploadBatch":true,"deleteBatch":true,"generatePdf":true},"sections":{"dashboard":true,"checklist":true,"documentation":true,"legalData":true,"history":true,"batch":true}}',
  now(),
  now()
);--> statement-breakpoint

-- Seed: atribuir perfil Advogado a usuários com role='attorney'
INSERT INTO "user_profile" ("user_id", "profile_id", "assigned_at")
SELECT "id", 'system_profile_attorney', now()
FROM "user"
WHERE "role" = 'attorney'
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint

-- Seed: atribuir perfil Usuário Padrão a usuários com role='user'
INSERT INTO "user_profile" ("user_id", "profile_id", "assigned_at")
SELECT "id", 'system_profile_default_user', now()
FROM "user"
WHERE "role" = 'user'
ON CONFLICT ("user_id") DO NOTHING;
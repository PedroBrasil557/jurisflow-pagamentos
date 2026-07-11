CREATE TABLE "user_titular_uf" (
	"user_id" text NOT NULL,
	"uf" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by_user_id" text,
	CONSTRAINT "user_titular_uf_user_id_uf_pk" PRIMARY KEY("user_id","uf")
);
--> statement-breakpoint
CREATE TABLE "user_titular_municipio" (
	"user_id" text NOT NULL,
	"uf" text NOT NULL,
	"municipio" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by_user_id" text,
	CONSTRAINT "user_titular_municipio_user_id_uf_municipio_pk" PRIMARY KEY("user_id","uf","municipio")
);
--> statement-breakpoint
ALTER TABLE "user_titular_uf" ADD CONSTRAINT "user_titular_uf_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_titular_uf" ADD CONSTRAINT "user_titular_uf_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_titular_municipio" ADD CONSTRAINT "user_titular_municipio_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_titular_municipio" ADD CONSTRAINT "user_titular_municipio_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "utuf_user_id_idx" ON "user_titular_uf" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "utmun_user_id_idx" ON "user_titular_municipio" USING btree ("user_id");

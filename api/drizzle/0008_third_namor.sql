CREATE TABLE "housing_complex_file" (
	"id" text PRIMARY KEY NOT NULL,
	"housing_complex_id" text NOT NULL,
	"document_type_key" text NOT NULL,
	"bucket_name" text NOT NULL,
	"object_key" text NOT NULL,
	"original_file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_in_bytes" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"replaced_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "housing_complex_file" ADD CONSTRAINT "housing_complex_file_housing_complex_id_housing_complex_id_fk" FOREIGN KEY ("housing_complex_id") REFERENCES "public"."housing_complex"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_complex_file" ADD CONSTRAINT "housing_complex_file_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "housing_complex_file_storage_object_idx" ON "housing_complex_file" USING btree ("bucket_name","object_key");--> statement-breakpoint
CREATE INDEX "housing_complex_file_complex_id_idx" ON "housing_complex_file" USING btree ("housing_complex_id");--> statement-breakpoint
CREATE INDEX "housing_complex_file_complex_key_current_idx" ON "housing_complex_file" USING btree ("housing_complex_id","document_type_key","is_current");
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"anthropic_api_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

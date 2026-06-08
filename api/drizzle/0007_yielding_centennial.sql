CREATE TYPE "public"."login_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "ip_geo_cache" (
	"ip" text PRIMARY KEY NOT NULL,
	"city" text,
	"region" text,
	"country" text,
	"resolved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"identifier" text NOT NULL,
	"user_name" text,
	"status" "login_status" NOT NULL,
	"failure_reason" text,
	"ip_address" text,
	"user_agent" text,
	"city" text,
	"region" text,
	"country" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_event_userId_idx" ON "login_event" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_event_createdAt_idx" ON "login_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_event_status_idx" ON "login_event" USING btree ("status");
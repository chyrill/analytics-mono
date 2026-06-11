CREATE TABLE IF NOT EXISTS "zoho_events" (
	"id" text PRIMARY KEY NOT NULL,
	"activity_type" text,
	"contact_id" text,
	"contact_email" text,
	"subject" text,
	"description" text,
	"status" text,
	"priority" text,
	"due_date" timestamp with time zone,
	"start_datetime" timestamp with time zone,
	"end_datetime" timestamp with time zone,
	"duration_mins" integer,
	"call_direction" text,
	"call_result" text,
	"created_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zoho_deals" ADD COLUMN "raw" jsonb;
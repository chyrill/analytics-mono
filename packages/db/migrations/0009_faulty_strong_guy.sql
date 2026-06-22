CREATE TABLE IF NOT EXISTS "health_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'health' NOT NULL,
	"note_text" text NOT NULL,
	"label" text,
	"snapshot_id" uuid NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'health' NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cohort_counts" jsonb NOT NULL,
	"criteria_breakdown" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "health_notes" ADD CONSTRAINT "health_notes_snapshot_id_health_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."health_snapshots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

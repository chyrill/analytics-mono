CREATE TABLE IF NOT EXISTS "sync_checkpoints" (
	"source" text NOT NULL,
	"entity" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"last_job_id" uuid,
	CONSTRAINT "sync_checkpoints_source_entity_pk" PRIMARY KEY("source","entity")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"mode" text DEFAULT 'full' NOT NULL,
	"entities" text[],
	"status" text DEFAULT 'queued' NOT NULL,
	"records_fetched" integer DEFAULT 0,
	"records_upserted" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_last_job_id_sync_jobs_id_fk" FOREIGN KEY ("last_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

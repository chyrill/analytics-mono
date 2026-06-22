CREATE TABLE IF NOT EXISTS "health_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text DEFAULT 'health' NOT NULL,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cohort_counts" jsonb NOT NULL,
  "criteria_breakdown" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "health_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text DEFAULT 'health' NOT NULL,
  "note_text" text NOT NULL,
  "label" text,
  "snapshot_id" uuid NOT NULL,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone,
  CONSTRAINT "health_notes_snapshot_id_health_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."health_snapshots"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "health_notes_scope_created_at_idx" ON "health_notes" ("scope", "created_at");
CREATE INDEX IF NOT EXISTS "health_snapshots_scope_snapshot_at_idx" ON "health_snapshots" ("scope", "snapshot_at");

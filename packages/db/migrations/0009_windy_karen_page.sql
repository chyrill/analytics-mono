CREATE TABLE IF NOT EXISTS "supply_tracking_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"email" text NOT NULL,
	"source_id" text NOT NULL,
	"strength" text NOT NULL,
	"fill_index" integer NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"grams_target" numeric(10, 3) NOT NULL,
	"grams_actual" numeric(10, 3) NOT NULL,
	"total_repeats_effective" integer NOT NULL,
	"repeats_remaining_raw" integer NOT NULL,
	"repeats_remaining" integer NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"chain_start_date" date NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supply_tracking_history_chain_fill_idx" ON "supply_tracking_history" USING btree ("chain_id","fill_index");
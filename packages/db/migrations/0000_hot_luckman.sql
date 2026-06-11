CREATE TABLE IF NOT EXISTS "cart_sessions" (
	"source_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"is_converted" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"source_created_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"phone" varchar(32),
	"zoho_contact_id" varchar(64),
	"saleor_customer_id" varchar(64),
	"doc_app_patient_id" varchar(64),
	"reconciliation_status" varchar(32),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "funnel_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"event_name" varchar(128) NOT NULL,
	"email" text,
	"properties" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders_dispatched" (
	"source_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"order_total" numeric(10, 2),
	"order_date" date,
	"weight_22" numeric(10, 3),
	"weight_26" numeric(10, 3),
	"weight_29" numeric(10, 3),
	"source_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reconciliation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(32) NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"records_checked" integer DEFAULT 0 NOT NULL,
	"gaps_found" integer DEFAULT 0 NOT NULL,
	"duplicates_found" integer DEFAULT 0 NOT NULL,
	"mismatches_found" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saleor_orders" (
	"source_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"total_grams" numeric(10, 3) NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supply_tracking" (
	"source_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"interval_key" date NOT NULL,
	"supply_interval_total" numeric(10, 3),
	"supply_used_interval" numeric(10, 3),
	"supply_remaining_interval" numeric(10, 3),
	"supply_remaining_repeats" integer,
	"source_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zoho_contacts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"email" text,
	"first_name" varchar(128),
	"last_name" varchar(128),
	"phone" varchar(32),
	"member_status" text,
	"supply_date" date,
	"supply_expiration" date,
	"order_date" date,
	"total_orders_paid" integer,
	"consent_form_completed" boolean,
	"patient_age" integer,
	"ad_usecase" text,
	"created_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zoho_deals" (
	"source_id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"email" text,
	"deal_name" text,
	"stage" text,
	"amount" numeric,
	"probability" numeric,
	"lead_source" text,
	"closing_date" date,
	"created_at" timestamp with time zone,
	"modified_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);

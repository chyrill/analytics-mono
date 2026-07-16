CREATE TABLE IF NOT EXISTS "saleor_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text,
	"product_name" text,
	"variant_id" text,
	"variant_name" text,
	"strain" text,
	"thc_level" text,
	"cut" text,
	"grams" numeric(10, 3),
	"quantity" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saleor_order_lines" ADD CONSTRAINT "saleor_order_lines_order_id_saleor_orders_source_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saleor_orders"("source_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

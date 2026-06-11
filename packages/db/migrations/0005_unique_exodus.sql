ALTER TABLE "saleor_orders" ALTER COLUMN "total_grams" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "saleor_orders" ADD COLUMN "order_number" integer;--> statement-breakpoint
ALTER TABLE "saleor_orders" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "saleor_orders" ADD COLUMN "total_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "saleor_orders" ADD COLUMN "currency" varchar(10);--> statement-breakpoint
ALTER TABLE "saleor_orders" ADD COLUMN "contact_id" text;
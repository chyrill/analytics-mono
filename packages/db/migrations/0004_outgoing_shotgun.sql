ALTER TABLE "db_patients" ALTER COLUMN "patient_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "db_patients" ADD COLUMN "contact_id" varchar(255);--> statement-breakpoint
ALTER TABLE "db_patients" ADD COLUMN "zoho_customer_id" text;--> statement-breakpoint
ALTER TABLE "db_patients" ADD COLUMN "saleor_id" varchar(255);--> statement-breakpoint
ALTER TABLE "db_patients" ADD COLUMN "application_status" text;--> statement-breakpoint
ALTER TABLE "db_patients" ADD COLUMN "last_completed_form" text;--> statement-breakpoint
ALTER TABLE "db_patients" ADD COLUMN "phone_verified" boolean;--> statement-breakpoint
ALTER TABLE "db_patients" ADD COLUMN "consent_form_completed" boolean;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "dose_per_day_26" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "strength_concentration_26" text;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "max_dose_26" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "total_quantity_26" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "number_of_repeat_26" integer;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "supply_interval_26" integer;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "id_verified" text;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "diagnosis" text;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "last_notes_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "db_treatment_plans" ADD COLUMN "last_notes_edited_by" text;
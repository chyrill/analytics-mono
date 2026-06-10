import { pgTable, text, numeric, integer, date, timestamp } from "drizzle-orm/pg-core";

export const dbTreatmentPlans = pgTable("db_treatment_plans", {
    // DocApp TreatmentPlan.id (UUID stored as text)
    sourceId: text("source_id").primaryKey(),
    email: text("email").notNull(),
    patientId: text("patient_id"),          // clinic-assigned patientID
    drId: text("dr_id"),
    drName: text("dr_name"),
    consultationId: text("consultation_id"),
    outcome: text("outcome"),
    drNotes: text("dr_notes"),
    date: date("date"),
    type: text("type"),
    mentalHealthDocument: text("mental_health_document"),

    // THC 22% prescription fields
    dosePerDay22: numeric("dose_per_day_22", { precision: 10, scale: 3 }),
    strengthConcentration22: text("strength_concentration_22"),
    maxDose22: numeric("max_dose_22", { precision: 10, scale: 3 }),
    totalQuantity22: numeric("total_quantity_22", { precision: 10, scale: 3 }),
    numberOfRepeat22: integer("number_of_repeat_22"),
    supplyInterval22: integer("supply_interval_22"),

    // THC 26% prescription fields
    dosePerDay26: numeric("dose_per_day_26", { precision: 10, scale: 3 }),
    strengthConcentration26: text("strength_concentration_26"),
    maxDose26: numeric("max_dose_26", { precision: 10, scale: 3 }),
    totalQuantity26: numeric("total_quantity_26", { precision: 10, scale: 3 }),
    numberOfRepeat26: integer("number_of_repeat_26"),
    supplyInterval26: integer("supply_interval_26"),

    // THC 29% prescription fields
    dosePerDay29: numeric("dose_per_day_29", { precision: 10, scale: 3 }),
    strengthConcentration29: text("strength_concentration_29"),
    maxDose29: numeric("max_dose_29", { precision: 10, scale: 3 }),
    totalQuantity29: numeric("total_quantity_29", { precision: 10, scale: 3 }),
    numberOfRepeat29: integer("number_of_repeat_29"),
    supplyInterval29: integer("supply_interval_29"),

    // Metadata
    idVerified: text("id_verified"),
    source: text("source"),
    diagnosis: text("diagnosis"),
    lastNotesEditedAt: timestamp("last_notes_edited_at", { withTimezone: true }),
    lastNotesEditedBy: text("last_notes_edited_by"),

    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DbTreatmentPlan = typeof dbTreatmentPlans.$inferSelect;
export type NewDbTreatmentPlan = typeof dbTreatmentPlans.$inferInsert;

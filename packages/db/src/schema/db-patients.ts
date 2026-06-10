import { pgTable, text, boolean, integer, timestamp, varchar } from "drizzle-orm/pg-core";

export const dbPatients = pgTable("db_patients", {
    // DocApp Patient.id (UUID stored as text)
    sourceId: text("source_id").primaryKey(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    patientId: varchar("patient_id", { length: 255 }),
    zohoId: text("zoho_id"),
    contactId: varchar("contact_id", { length: 255 }),  // alternative Zoho contact ID
    zohoCustomerId: text("zoho_customer_id"),
    saleorId: varchar("saleor_id", { length: 255 }),
    returningPatient: boolean("returning_patient"),
    locked: boolean("locked"),
    drLocked: text("dr_locked"),
    state: text("state"),
    applicationStatus: text("application_status"),
    lastCompletedForm: text("last_completed_form"),
    dob: text("dob"),
    usedCannabisBefore: boolean("used_cannabis_before"),
    mobile: text("mobile"),
    phoneVerified: boolean("phone_verified"),
    consentFormCompleted: boolean("consent_form_completed"),
    riskRating: integer("risk_rating"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DbPatient = typeof dbPatients.$inferSelect;
export type NewDbPatient = typeof dbPatients.$inferInsert;

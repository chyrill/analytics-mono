import { pgTable, text, varchar, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  phone: varchar("phone", { length: 32 }),

  // Source system IDs — null until reconciled
  zohoContactId: varchar("zoho_contact_id", { length: 64 }),
  saleorCustomerId: varchar("saleor_customer_id", { length: 64 }),
  docAppPatientId: varchar("doc_app_patient_id", { length: 64 }),

  // 'matched' = present in all linked sources
  // 'gap'     = missing from one or more sources
  // 'duplicate' = same email appears multiple times in a source
  // 'mismatch'  = conflicting data between sources
  reconciliationStatus: varchar("reconciliation_status", { length: 32 }),

  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

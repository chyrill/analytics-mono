import { pgTable, text, varchar, integer, boolean, date, jsonb, timestamp } from "drizzle-orm/pg-core";

export const zohoContacts = pgTable("zoho_contacts", {
  // Zoho CRM Contact ID is the primary key
  id: varchar("id", { length: 64 }).primaryKey(),

  email: text("email"),
  firstName: varchar("first_name", { length: 128 }),
  lastName: varchar("last_name", { length: 128 }),
  phone: varchar("phone", { length: 32 }),

  // Patient journey fields
  memberStatus:          text("member_status"),
  supplyDate:            date("supply_date"),
  supplyExpiration:      date("supply_expiration"),
  orderDate:             date("order_date"),
  totalOrdersPaid:       integer("total_orders_paid"),
  consentFormCompleted:  boolean("consent_form_completed"),
  patientAge:            integer("patient_age"),
  adUsecase:             text("ad_usecase"),

  // Timestamps from Zoho
  createdAt:  timestamp("created_at",  { withTimezone: true }),
  modifiedAt: timestamp("modified_at", { withTimezone: true }),

  // Full raw Zoho API response stored for debugging/auditing
  raw: jsonb("raw"),

  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ZohoContact = typeof zohoContacts.$inferSelect;
export type NewZohoContact = typeof zohoContacts.$inferInsert;

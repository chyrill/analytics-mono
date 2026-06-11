import { pgTable, text, numeric, date, timestamp, jsonb } from "drizzle-orm/pg-core";

export const zohoDeals = pgTable("zoho_deals", {
  // Zoho CRM Deal ID
  sourceId: text("source_id").primaryKey(),

  // Link to contact
  contactId: text("contact_id"),   // Zoho Contact ID
  email: text("email"),         // denormalised from contact for easy joining

  // Deal core fields
  dealName: text("deal_name"),
  stage: text("stage"),
  amount: numeric("amount"),
  probability: numeric("probability"),
  leadSource: text("lead_source"),
  closingDate: date("closing_date"),

  // Timestamps from Zoho
  createdAt: timestamp("created_at", { withTimezone: true }),
  modifiedAt: timestamp("modified_at", { withTimezone: true }),

  // Full raw Zoho API response — no transformation, audit trail
  raw: jsonb("raw"),

  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ZohoDeal = typeof zohoDeals.$inferSelect;
export type NewZohoDeal = typeof zohoDeals.$inferInsert;

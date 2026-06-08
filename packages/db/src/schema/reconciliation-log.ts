import { pgTable, varchar, text, integer, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

export const reconciliationLog = pgTable("reconciliation_log", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Which ETL worker produced this log entry
  source: varchar("source", { length: 32 }).notNull(), // 'zoho' | 'saleor' | 'docapp'

  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  recordsChecked: integer("records_checked").notNull().default(0),
  gapsFound: integer("gaps_found").notNull().default(0),
  duplicatesFound: integer("duplicates_found").notNull().default(0),
  mismatchesFound: integer("mismatches_found").notNull().default(0),
  notes: text("notes"),
  details: jsonb("details"),
});

export type ReconciliationLog = typeof reconciliationLog.$inferSelect;
export type NewReconciliationLog = typeof reconciliationLog.$inferInsert;

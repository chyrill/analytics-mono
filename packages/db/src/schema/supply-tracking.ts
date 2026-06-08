import { pgTable, text, numeric, integer, date, timestamp } from "drizzle-orm/pg-core";

// Mirrors doc-app's user_login_supply_tracking table.
// Each row is one interval snapshot for a patient's treatment plan.
// interval_key = COALESCE(next_repeat_date, supply_interval_start, DATE_TRUNC('month', created_at))
// — computed at sync time so the API can DISTINCT ON (email, interval_key) directly.
export const supplyTracking = pgTable("supply_tracking", {
  sourceId:               text("source_id").primaryKey(),
  email:                  text("email").notNull(),
  intervalKey:            date("interval_key").notNull(),
  supplyIntervalTotal:    numeric("supply_interval_total", { precision: 10, scale: 3 }),
  supplyUsedInterval:     numeric("supply_used_interval",  { precision: 10, scale: 3 }),
  supplyRemainingInterval: numeric("supply_remaining_interval", { precision: 10, scale: 3 }),
  supplyRemainingRepeats: integer("supply_remaining_repeats"),
  sourceCreatedAt:        timestamp("source_created_at", { withTimezone: true }),
  syncedAt:               timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SupplyTracking = typeof supplyTracking.$inferSelect;
export type NewSupplyTracking = typeof supplyTracking.$inferInsert;

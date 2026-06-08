import { pgTable, text, numeric, timestamp } from "drizzle-orm/pg-core";

// Individual Saleor orders that carried product weight (fully-charged only).
// total_grams = sum of all line item grams for the order.
// Used to enrich the health index with real dispensed quantities where doc-app
// supply tracking is incomplete or lags behind.
export const saleorOrders = pgTable("saleor_orders", {
  sourceId:   text("source_id").primaryKey(), // Saleor order node ID
  email:      text("email").notNull(),
  totalGrams: numeric("total_grams", { precision: 10, scale: 3 }).notNull(),
  orderedAt:  timestamp("ordered_at", { withTimezone: true }).notNull(),
  syncedAt:   timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SaleorOrder = typeof saleorOrders.$inferSelect;
export type NewSaleorOrder = typeof saleorOrders.$inferInsert;

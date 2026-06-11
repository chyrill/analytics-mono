import { pgTable, text, numeric, integer, timestamp, varchar } from "drizzle-orm/pg-core";

// Individual Saleor orders (fully-charged).
// total_grams  = order.weight.value (already in grams from Saleor).
// contact_id   = metadata key "contactId" — links order back to Zoho/DocApp.
export const saleorOrders = pgTable("saleor_orders", {
  sourceId: text("source_id").primaryKey(),  // Saleor order node ID
  email: text("email").notNull(),
  orderNumber: integer("order_number"),
  status: text("status"),
  totalGrams: numeric("total_grams", { precision: 10, scale: 3 }),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  contactId: text("contact_id"),              // from order metadata
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SaleorOrder = typeof saleorOrders.$inferSelect;
export type NewSaleorOrder = typeof saleorOrders.$inferInsert;

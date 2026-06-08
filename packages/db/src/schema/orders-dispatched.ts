import { pgTable, text, numeric, date, timestamp } from "drizzle-orm/pg-core";

// Mirrors doc-app's orders_to_dispatch table.
// Tracks dispensed orders with revenue and product weight breakdown.
export const ordersDispatched = pgTable("orders_dispatched", {
  sourceId:        text("source_id").primaryKey(),
  email:           text("email").notNull(),
  orderTotal:      numeric("order_total", { precision: 10, scale: 2 }),
  orderDate:       date("order_date"),
  weight22:        numeric("weight_22", { precision: 10, scale: 3 }),
  weight26:        numeric("weight_26", { precision: 10, scale: 3 }),
  weight29:        numeric("weight_29", { precision: 10, scale: 3 }),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  syncedAt:        timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type OrderDispatched = typeof ordersDispatched.$inferSelect;
export type NewOrderDispatched = typeof ordersDispatched.$inferInsert;

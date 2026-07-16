import { pgTable, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";
import { saleorOrders } from "./saleor-orders";

// Per-line-item detail for Saleor orders — captures product/strain/THC-level
// attributes at sync time (denormalized, not joined live) so historical
// "what did the patient actually buy" stays accurate even if the product's
// attribute values are edited later. See docs/customer-health-index-deep-dive.md §2.1.
export const saleorOrderLines = pgTable("saleor_order_lines", {
  id: text("id").primaryKey(),               // Saleor order line node ID
  orderId: text("order_id")
    .notNull()
    .references(() => saleorOrders.sourceId),
  productId: text("product_id"),
  productName: text("product_name"),
  variantId: text("variant_id"),
  variantName: text("variant_name"),
  strain: text("strain"),                    // Attribute "Strain", product-level
  thcLevel: text("thc_level"),                // Attribute "THC Level", product-level
  cut: text("cut"),                           // Attribute "cut", variant-level
  grams: numeric("grams", { precision: 10, scale: 3 }),
  quantity: integer("quantity"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SaleorOrderLine = typeof saleorOrderLines.$inferSelect;
export type NewSaleorOrderLine = typeof saleorOrderLines.$inferInsert;

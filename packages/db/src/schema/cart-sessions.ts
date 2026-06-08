import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Mirrors doc-app's cart_sessions table.
// Tracks shop visits and whether they converted to a purchase.
export const cartSessions = pgTable("cart_sessions", {
  sourceId:        text("source_id").primaryKey(),
  email:           text("email").notNull(),
  isConverted:     boolean("is_converted").notNull().default(false),
  isDeleted:       boolean("is_deleted").notNull().default(false),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }).notNull(),
  syncedAt:        timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CartSession = typeof cartSessions.$inferSelect;
export type NewCartSession = typeof cartSessions.$inferInsert;

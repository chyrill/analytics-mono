import { pgTable, text, varchar, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

export const funnelEvents = pgTable("funnel_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: varchar("session_id", { length: 128 }).notNull(),

  // e.g. 'registration_started' | 'step_completed' | 'registration_completed' | 'converted_to_consultation'
  eventName: varchar("event_name", { length: 128 }).notNull(),

  // Null until user provides their email in the funnel
  email: text("email"),

  // Step name, referrer, UTM params, etc.
  properties: jsonb("properties").default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FunnelEvent = typeof funnelEvents.$inferSelect;
export type NewFunnelEvent = typeof funnelEvents.$inferInsert;

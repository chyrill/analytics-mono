import { pgTable, text, uuid, timestamp, jsonb } from "drizzle-orm/pg-core";

export const healthSnapshots = pgTable("health_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull().default("health"),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).defaultNow().notNull(),
  cohortCounts: jsonb("cohort_counts").notNull(),
  criteriaBreakdown: jsonb("criteria_breakdown").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const healthNotes = pgTable("health_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: text("scope").notNull().default("health"),
  noteText: text("note_text").notNull(),
  label: text("label"),
  snapshotId: uuid("snapshot_id").notNull().references(() => healthSnapshots.id, { onDelete: "cascade" }),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type HealthSnapshot = typeof healthSnapshots.$inferSelect;
export type NewHealthSnapshot = typeof healthSnapshots.$inferInsert;

export type HealthNote = typeof healthNotes.$inferSelect;
export type NewHealthNote = typeof healthNotes.$inferInsert;

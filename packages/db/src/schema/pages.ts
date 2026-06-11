import { pgTable, text, integer, serial } from "drizzle-orm/pg-core";

export const pages = pgTable("pages", {
    id: serial("id").primaryKey(),
    path: text("path").notNull().unique(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull(),
});

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;

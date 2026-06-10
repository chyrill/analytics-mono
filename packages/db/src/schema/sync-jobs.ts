import { pgTable, text, uuid, integer, timestamp } from "drizzle-orm/pg-core";

export const syncJobs = pgTable("sync_jobs", {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),             // 'zoho' | 'saleor' | 'db'
    mode: text("mode").notNull().default("full"), // 'full' | 'incremental'
    entities: text("entities").array(),             // ['contacts', 'deals', 'calls', ...]
    status: text("status").notNull().default("queued"), // queued | running | completed | failed
    recordsFetched: integer("records_fetched").default(0),
    recordsUpserted: integer("records_upserted").default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SyncJob = typeof syncJobs.$inferSelect;
export type NewSyncJob = typeof syncJobs.$inferInsert;

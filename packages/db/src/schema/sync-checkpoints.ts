import { pgTable, text, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { syncJobs } from "./sync-jobs";

export const syncCheckpoints = pgTable("sync_checkpoints", {
    source: text("source").notNull(),   // 'zoho' | 'saleor'
    entity: text("entity").notNull(),   // 'contacts' | 'deals' | 'calls' | 'tasks' | 'events'
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
    lastJobId: uuid("last_job_id").references(() => syncJobs.id),
}, (t) => ({
    pk: primaryKey({ columns: [t.source, t.entity] }),
}));

export type SyncCheckpoint = typeof syncCheckpoints.$inferSelect;
export type NewSyncCheckpoint = typeof syncCheckpoints.$inferInsert;

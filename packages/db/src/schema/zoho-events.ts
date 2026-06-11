import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const zohoEvents = pgTable("zoho_events", {
    // Zoho Activity ID (shared across Calls, Tasks, Events)
    id: text("id").primaryKey(),

    // Type discriminator: 'Call' | 'Task' | 'Event'
    activityType: text("activity_type"),

    // Contact link
    contactId: text("contact_id"),   // Zoho Contact ID
    contactEmail: text("contact_email"),

    // Core fields
    subject: text("subject"),
    description: text("description"),
    status: text("status"),
    priority: text("priority"),

    // Scheduling
    dueDate: timestamp("due_date", { withTimezone: true }),
    startDatetime: timestamp("start_datetime", { withTimezone: true }),
    endDatetime: timestamp("end_datetime", { withTimezone: true }),
    durationMins: integer("duration_mins"),

    // Calls-specific
    callDirection: text("call_direction"), // 'Inbound' | 'Outbound'
    callResult: text("call_result"),

    // Timestamps from Zoho
    createdAt: timestamp("created_at", { withTimezone: true }),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),

    // Full raw Zoho API response — no transformation, audit trail
    raw: jsonb("raw"),

    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ZohoEvent = typeof zohoEvents.$inferSelect;
export type NewZohoEvent = typeof zohoEvents.$inferInsert;

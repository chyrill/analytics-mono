import { pgTable, text, integer, boolean, numeric, timestamp } from "drizzle-orm/pg-core";

export const dbTreatmentPlanTracker = pgTable("db_treatment_plan_tracker", {
    // DocApp treatmentplantracker.email (unique per patient — one active tracker row)
    email: text("email").primaryKey(),

    syncedDate: text("synced_date"),
    repeats: integer("repeats"),
    scriptStartDate: text("script_start_date"),
    scriptExpirationDate: text("script_expiration_date"),
    consultingDoctor: text("consulting_doctor"),
    supplyInterval: integer("supply_interval"),

    // Repeats remaining per variant
    repeatsRemaining22: numeric("repeats_remaining_22", { precision: 10, scale: 3 }),
    repeatsRemaining26: numeric("repeats_remaining_26", { precision: 10, scale: 3 }),
    repeatsRemaining29: numeric("repeats_remaining_29", { precision: 10, scale: 3 }),

    // Total supply per variant (grams)
    supplyTotal22: numeric("supply_total_22", { precision: 10, scale: 3 }),
    supplyTotal26: numeric("supply_total_26", { precision: 10, scale: 3 }),
    supplyTotal29: numeric("supply_total_29", { precision: 10, scale: 3 }),

    // Cumulative supply used per variant
    supplyUsedTotal22: numeric("supply_used_total_22", { precision: 10, scale: 3 }),
    supplyUsedTotal26: numeric("supply_used_total_26", { precision: 10, scale: 3 }),
    supplyUsedTotal29: numeric("supply_used_total_29", { precision: 10, scale: 3 }),

    // Current interval allotment per variant
    supplyIntervalTotal22: numeric("supply_interval_total_22", { precision: 10, scale: 3 }),
    supplyIntervalTotal26: numeric("supply_interval_total_26", { precision: 10, scale: 3 }),
    supplyIntervalTotal29: numeric("supply_interval_total_29", { precision: 10, scale: 3 }),

    // Supply used in current interval per variant
    supplyUsedInterval22: numeric("supply_used_interval_22", { precision: 10, scale: 3 }),
    supplyUsedInterval26: numeric("supply_used_interval_26", { precision: 10, scale: 3 }),
    supplyUsedInterval29: numeric("supply_used_interval_29", { precision: 10, scale: 3 }),

    // Interval start date per variant (ISO date string)
    supplyIntervalStart22: text("supply_interval_start_22"),
    supplyIntervalStart26: text("supply_interval_start_26"),
    supplyIntervalStart29: text("supply_interval_start_29"),

    needsUpdate: boolean("needs_update"),

    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DbTreatmentPlanTracker = typeof dbTreatmentPlanTracker.$inferSelect;
export type NewDbTreatmentPlanTracker = typeof dbTreatmentPlanTracker.$inferInsert;

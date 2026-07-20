import { pgTable, serial, text, integer, numeric, date, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

// Independently-computed "remaining repeats over time" ledger.
// Derived ONLY from db_treatment_plans + saleor_orders/saleor_order_lines —
// never trusts DocApp's own live tracker numbers (db_treatment_plan_tracker /
// supply_tracking), because that write path has no floor at zero and no
// row-level locking around its decrement logic (verified in shop-mono-repo).
// This table is meant to become analytics-mono's source of truth for
// "how many repeats does this patient have left, and since when".
//
// One row per interval ("fill window") per continuous treatment chain.
// A chain is a contiguous run of db_treatment_plans rows for one patient
// linked by extension / quantity-increase / strength-switch events — see
// scripts/build-supply-tracking-history.ts for the linking rules.
export const supplyTrackingHistory = pgTable(
  "supply_tracking_history",
  {
    id: serial("id").primaryKey(),

    // Deterministic chain identity: `${email}::${chainStartDate}` — stable
    // across reruns so the build script can safely delete-and-rebuild per chain.
    chainId: text("chain_id").notNull(),
    email: text("email").notNull(),

    // Which db_treatment_plans row was governing when this window was generated
    // (audit trail — lets us answer "why does this say 3 repeats left").
    sourceId: text("source_id").notNull(),

    strength: text("strength").notNull(), // '22' | '26' | '29'

    fillIndex: integer("fill_index").notNull(), // 0-based position within the chain
    windowStart: date("window_start").notNull(),
    windowEnd: date("window_end").notNull(),

    gramsTarget: numeric("grams_target", { precision: 10, scale: 3 }).notNull(),
    gramsActual: numeric("grams_actual", { precision: 10, scale: 3 }).notNull(),

    totalRepeatsEffective: integer("total_repeats_effective").notNull(),

    // Raw = effectiveRepeats - fillIndex, allowed to go negative (audit signal).
    // Clamped = what's safe to display; never negative.
    repeatsRemainingRaw: integer("repeats_remaining_raw").notNull(),
    repeatsRemaining: integer("repeats_remaining").notNull(),

    flagged: boolean("flagged").notNull().default(false),
    flagReason: text("flag_reason"),

    chainStartDate: date("chain_start_date").notNull(),

    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chainFillUnique: uniqueIndex("supply_tracking_history_chain_fill_idx").on(table.chainId, table.fillIndex),
  }),
);

export type SupplyTrackingHistory = typeof supplyTrackingHistory.$inferSelect;
export type NewSupplyTrackingHistory = typeof supplyTrackingHistory.$inferInsert;

/**
 * backfill-supply-tracking.ts
 *
 * Generates historical supply_tracking rows from db_treatment_plans + saleor_orders
 * for intervals that predate the real sync data (which starts 2025-12-01).
 *
 * Logic mirrors shop-mono-repo's treatmentplantracker interval model:
 *   - Each treatment plan has one or more variants (22/26/29 % THC)
 *   - total_quantity_* = grams allotted per fill window
 *   - number_of_repeat_* = number of refills (original not counted)
 *   - supply_interval_* = days per fill window
 *   - Generates intervals from plan.date forward, spaced supply_interval days apart
 *   - For each interval, sums saleor_orders.total_grams in that window
 *   - Inserts one row per fill window per plan per email into supply_tracking
 *
 * Usage:
 *   npx tsx scripts/backfill-supply-tracking.ts              # live run
 *   npx tsx scripts/backfill-supply-tracking.ts --dry-run    # preview only
 *   npx tsx scripts/backfill-supply-tracking.ts --email foo@bar.com  # single email
 */

import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://analytics:analytics@localhost:5433/analytics";

const DRY_RUN = process.argv.includes("--dry-run");
const TARGET_EMAIL = (() => {
  const idx = process.argv.indexOf("--email");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// For patients who already have real supply_tracking rows, only backfill intervals
// strictly before this date to avoid overwriting live synced data.
const REAL_SYNC_CUTOFF = new Date("2025-12-01T00:00:00.000Z");

const BATCH_SIZE = 500;

interface PlanRow {
  email: string;
  plan_date: string; // 'YYYY-MM-DD'
  q22: number;
  q26: number;
  q29: number;
  r22: number;
  r26: number;
  r29: number;
  i22: number;
  i26: number;
  i29: number;
}

interface OrderDay {
  grams: number;
}

async function main() {
  const sql = postgres(DB_URL, { max: 3 });

  console.log(`[backfill] mode=${DRY_RUN ? "DRY RUN" : "LIVE"} cutoff=${REAL_SYNC_CUTOFF.toISOString().slice(0, 10)}`);
  if (TARGET_EMAIL) console.log(`[backfill] targeting single email: ${TARGET_EMAIL}`);

  // ── 1. Load all treatment plans ──────────────────────────────────────────────
  const planRows = await sql<PlanRow[]>`
    SELECT
      email,
      "date"::text                               AS plan_date,
      COALESCE(total_quantity_22::float8, 0)     AS q22,
      COALESCE(total_quantity_26::float8, 0)     AS q26,
      COALESCE(total_quantity_29::float8, 0)     AS q29,
      COALESCE(number_of_repeat_22, 0)::int      AS r22,
      COALESCE(number_of_repeat_26, 0)::int      AS r26,
      COALESCE(number_of_repeat_29, 0)::int      AS r29,
      COALESCE(supply_interval_22, 0)::int       AS i22,
      COALESCE(supply_interval_26, 0)::int       AS i26,
      COALESCE(supply_interval_29, 0)::int       AS i29
    FROM db_treatment_plans
    WHERE email IS NOT NULL
      AND (total_quantity_22 IS NOT NULL OR total_quantity_26 IS NOT NULL OR total_quantity_29 IS NOT NULL)
      ${TARGET_EMAIL ? sql`AND email = ${TARGET_EMAIL}` : sql``}
    ORDER BY email, "date" ASC, source_created_at ASC
  `;
  console.log(`[backfill] loaded ${planRows.length} treatment plan rows`);

  // ── 2. Load emails that already have real supply_tracking rows ───────────────
  // For these patients we only backfill pre-Dec 2025 to avoid shadowing live data.
  // For patients with NO supply_tracking at all, we backfill everything up to today.
  const realRows = await sql<{ email: string }[]>`
    SELECT DISTINCT email FROM supply_tracking
    ${TARGET_EMAIL ? sql`WHERE email = ${TARGET_EMAIL}` : sql``}
  `;
  const emailsWithRealData = new Set(realRows.map((r) => r.email));
  console.log(`[backfill] emails with existing supply_tracking: ${emailsWithRealData.size}`);

  // ── 3. Load all saleor orders, summed by email + day ─────────────────────────
  // Store as Map<email, Map<'YYYY-MM-DD', gramsOnThatDay>>
  const ordersByEmail = new Map<string, Map<string, number>>();

  const orderRows = await sql<{ email: string; order_date: string; grams: number }[]>`
    SELECT
      email,
      (ordered_at AT TIME ZONE 'Australia/Sydney')::date::text AS order_date,
      SUM(total_grams::numeric)                                AS grams
    FROM saleor_orders
    WHERE email IS NOT NULL
      ${TARGET_EMAIL ? sql`AND email = ${TARGET_EMAIL}` : sql``}
    GROUP BY email, (ordered_at AT TIME ZONE 'Australia/Sydney')::date
    ORDER BY email, order_date
  `;
  for (const row of orderRows) {
    let emailMap = ordersByEmail.get(row.email);
    if (!emailMap) { emailMap = new Map(); ordersByEmail.set(row.email, emailMap); }
    emailMap.set(row.order_date, Number(row.grams));
  }
  console.log(`[backfill] loaded orders for ${ordersByEmail.size} distinct emails`);

  // ── 4. Group plans by email ───────────────────────────────────────────────────
  const plansByEmail = new Map<string, PlanRow[]>();
  for (const plan of planRows) {
    const arr = plansByEmail.get(plan.email) ?? [];
    arr.push(plan);
    plansByEmail.set(plan.email, arr);
  }

  // ── 5. Generate interval rows ─────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const insertBatch: Array<{
    source_id: string;
    email: string;
    interval_key: string;
    supply_interval_total: number;
    supply_used_interval: number;
    supply_remaining_interval: number;
    supply_remaining_repeats: number;
    source_created_at: string;
  }> = [];

  let totalRows = 0;

  function flushBatch() {
    // Collect for later bulk insert — caller awaits separately
  }

  const allRows = insertBatch; // alias

  for (const [email, plans] of plansByEmail) {
    const orderDays = ordersByEmail.get(email) ?? new Map<string, number>();

    // If this patient already has real supply_tracking rows, stop before Dec 2025.
    // If they have no real data at all, backfill everything up to today.
    const cutoff = emailsWithRealData.has(email) ? REAL_SYNC_CUTOFF : today;

    for (let pi = 0; pi < plans.length; pi++) {
      const plan = plans[pi];

      // Combined per-fill total across all variants
      const intervalTotal = plan.q22 + plan.q26 + plan.q29;
      if (intervalTotal <= 0) continue;

      // Supply interval in days: prefer 26, then 29, then 22
      const supplyInterval = plan.i26 > 0 ? plan.i26 : plan.i29 > 0 ? plan.i29 : plan.i22;
      if (!supplyInterval) continue;

      // Total repeats (max across active variants)
      const totalRepeats = Math.max(
        plan.q22 > 0 ? plan.r22 : 0,
        plan.q26 > 0 ? plan.r26 : 0,
        plan.q29 > 0 ? plan.r29 : 0,
      );
      const maxFills = totalRepeats + 1; // original + repeats

      // Active period: plan.date → next plan's date (or today)
      const planStart = new Date(plan.plan_date + "T00:00:00.000Z");
      if (isNaN(planStart.getTime())) continue; // skip rows with missing date
      const planEnd =
        pi + 1 < plans.length
          ? new Date(plans[pi + 1].plan_date + "T00:00:00.000Z")
          : today;

      // Generate fill windows
      let windowStart = new Date(planStart);

      for (let fillIndex = 0; fillIndex < maxFills; fillIndex++) {
        // Stop if window starts at/after the cutoff for this patient
        if (windowStart >= cutoff) break;
        // Stop if window starts at/after next plan (plan superseded)
        if (windowStart >= planEnd) break;

        const windowEnd = new Date(windowStart);
        windowEnd.setDate(windowEnd.getDate() + supplyInterval);

        const intervalKey = windowStart.toISOString().slice(0, 10);
        const sourceId = `backfill:${email}:${intervalKey}:${plan.plan_date}`;

        // Sum orders in this window
        let usedG = 0;
        const winStart = new Date(windowStart);
        const winEnd = new Date(windowEnd);
        // Iterate days in the window and sum from orderDays map
        const cur = new Date(winStart);
        while (cur < winEnd) {
          const dayKey = cur.toISOString().slice(0, 10);
          usedG += orderDays.get(dayKey) ?? 0;
          cur.setDate(cur.getDate() + 1);
        }

        const remainingG = Math.max(intervalTotal - usedG, 0);
        const repeatsRemaining = totalRepeats - fillIndex;

        allRows.push({
          source_id:                sourceId,
          email,
          interval_key:             intervalKey,
          supply_interval_total:    intervalTotal,
          supply_used_interval:     usedG,
          supply_remaining_interval: remainingG,
          supply_remaining_repeats: repeatsRemaining,
          source_created_at:        windowStart.toISOString(),
        });

        // Advance to next fill window
        windowStart = new Date(windowEnd);
      }
    }
  }

  console.log(`[backfill] generated ${allRows.length} interval rows`);

  if (DRY_RUN) {
    // Show a sample
    const sample = allRows.slice(0, 20);
    for (const r of sample) {
      console.log(
        `  ${r.email} | ${r.interval_key} | allotted=${r.supply_interval_total}g used=${r.supply_used_interval.toFixed(1)}g rem=${r.supply_remaining_interval.toFixed(1)}g rpt_rem=${r.supply_remaining_repeats}`,
      );
    }
    if (allRows.length > 20) console.log(`  ... and ${allRows.length - 20} more`);
    console.log("[backfill] DRY RUN complete — no rows written");
    await sql.end();
    return;
  }

  // ── 6. Batch insert ───────────────────────────────────────────────────────────
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE).map((r) => ({
      source_id:                 r.source_id,
      email:                     r.email,
      interval_key:              r.interval_key,
      supply_interval_total:     r.supply_interval_total,
      supply_used_interval:      r.supply_used_interval,
      supply_remaining_interval: r.supply_remaining_interval,
      supply_remaining_repeats:  r.supply_remaining_repeats,
      source_created_at:         r.source_created_at,
      synced_at:                 new Date().toISOString(),
    }));

    await sql`
      INSERT INTO supply_tracking ${sql(
        batch,
        "source_id", "email", "interval_key",
        "supply_interval_total", "supply_used_interval", "supply_remaining_interval",
        "supply_remaining_repeats", "source_created_at", "synced_at"
      )}
      ON CONFLICT (source_id) DO NOTHING
    `;
    inserted += batch.length;
    process.stdout.write(`\r[backfill] inserted ${inserted}/${allRows.length}`);
  }

  console.log(`\n[backfill] Done — ${inserted} rows processed (conflicts skipped silently)`);
  await sql.end();
}

main().catch((e) => {
  console.error("[backfill] Fatal:", e);
  process.exit(1);
});

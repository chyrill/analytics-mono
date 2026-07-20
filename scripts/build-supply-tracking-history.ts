/**
 * build-supply-tracking-history.ts
 *
 * Builds an INDEPENDENTLY-COMPUTED "remaining repeats over time" ledger into
 * supply_tracking_history, derived only from db_treatment_plans +
 * saleor_orders/saleor_order_lines. Never reads db_treatment_plan_tracker or
 * supply_tracking — those mirror DocApp's own live counters, which have a
 * verified bug (no floor at zero, no row locking around the decrement) in
 * shop-mono-repo. This script is the fix: it recomputes remaining repeats
 * from scratch using the plan's own repeat/interval/quantity columns, so the
 * count can never go negative except as an explicit, flagged audit signal.
 *
 * Chain model
 * -----------
 * A "chain" is a contiguous run of db_treatment_plans rows for one patient,
 * linked together by diagnosis-text events:
 *   - diagnosis contains "extend"            -> EXTENSION
 *       adds the row's own number_of_repeat_* to the running total.
 *       Clock/fillIndex/chainStart are NOT reset.
 *   - diagnosis contains "quantity increase"/"quantity change" -> QUANTITY_CHANGE
 *       updates the grams-per-interval target only, effective from the NEXT
 *       ungenerated window onward (never retroactive).
 *   - diagnosis contains "switch"            -> STRENGTH_SWITCH
 *       updates which strength column (22/26/29) is authoritative, and its
 *       grams/interval target, effective from the NEXT ungenerated window.
 *       Repeats/fillIndex/chainStart are NOT reset.
 *   - no keyword, but the row's active-strength columns are UNCHANGED from
 *       the current chain target -> pure continuation, ignored.
 *   - no keyword, and the row's columns DIFFER from the current chain target
 *       -> UNRECOGNIZED_PLAN_CHANGE: we can't safely classify what happened,
 *       so we close the old chain and start a brand new one at this row's
 *       date, flagged for human review rather than silently guessing.
 *   - outcome does not start with "approve" (e.g. "Reject") -> the plan was
 *       never active; it terminates window generation for the current chain
 *       as of this row's date and is not itself a chain-starting row.
 *
 * Within a chain, windows are generated in fillIndex order. Any pending
 * event whose plan date is <= the start of the next window to generate is
 * applied before generating that window; events landing mid-window are
 * deferred until the following window boundary. This is what makes
 * quantity/switch/extension changes apply "from the next interval", never
 * retroactively.
 *
 * Windows are only generated while fillIndex <= effectiveRepeats, which is
 * what guarantees the *clamped* repeatsRemaining can never go negative. If a
 * patient's purchases continue into windows beyond their last approved
 * repeat, we still generate one flagged "overrun" row per such window
 * (repeatsRemainingRaw negative, repeatsRemaining clamped to 0) — this is
 * the real audit signal for "patient kept buying with zero repeats left".
 *
 * Usage:
 *   npx tsx scripts/build-supply-tracking-history.ts              # live run, all patients
 *   npx tsx scripts/build-supply-tracking-history.ts --dry-run    # preview only, no writes
 *   npx tsx scripts/build-supply-tracking-history.ts --email foo@bar.com [--dry-run]
 */

import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://analytics:analytics@localhost:5433/analytics";

const DRY_RUN = process.argv.includes("--dry-run");
const TARGET_EMAIL = (() => {
  const idx = process.argv.indexOf("--email");
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const BATCH_SIZE = 500;
const STRENGTHS = ["22", "26", "29"] as const;
type Strength = (typeof STRENGTHS)[number];

interface PlanRow {
  source_id: string;
  email: string;
  plan_date: string; // 'YYYY-MM-DD'
  diagnosis: string | null;
  outcome: string | null;
  q: Record<Strength, number>;
  r: Record<Strength, number>;
  i: Record<Strength, number>;
}

interface HistoryRow {
  chain_id: string;
  email: string;
  source_id: string;
  strength: string;
  fill_index: number;
  window_start: string;
  window_end: string;
  grams_target: number;
  grams_actual: number;
  total_repeats_effective: number;
  repeats_remaining_raw: number;
  repeats_remaining: number;
  flagged: boolean;
  flag_reason: string | null;
  chain_start_date: string;
}

function isApproved(outcome: string | null): boolean {
  return !!outcome && outcome.trim().toLowerCase().startsWith("approve");
}

function classify(diagnosis: string | null): "EXTENSION" | "QUANTITY_CHANGE" | "SWITCH" | null {
  const d = (diagnosis ?? "").toLowerCase();
  if (d.includes("extend")) return "EXTENSION";
  if (d.includes("quantity increase") || d.includes("quantity change")) return "QUANTITY_CHANGE";
  if (d.includes("switch")) return "SWITCH";
  return null;
}

// Pick the strength column with the largest total_quantity among populated candidates.
function pickDominantStrength(row: PlanRow): Strength | null {
  let best: Strength | null = null;
  let bestQty = 0;
  for (const s of STRENGTHS) {
    if (row.q[s] > 0 && row.q[s] >= bestQty) {
      best = s;
      bestQty = row.q[s];
    }
  }
  return best;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cmpDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Chain state, mutated as we walk plan rows + generate windows.
interface ChainState {
  chainId: string;
  chainStartDate: string;
  governingSourceId: string;
  activeStrength: Strength;
  gramsPerInterval: number;
  intervalDays: number;
  effectiveRepeats: number;
  fillIndex: number; // next fillIndex to generate
  cursorDate: string; // start of next window to generate
  flagged: boolean;
  flagReason: string | null;
}

function startChain(row: PlanRow, strength: Strength, flagged = false, flagReason: string | null = null): ChainState {
  return {
    chainId: `${row.email}::${row.plan_date}`,
    chainStartDate: row.plan_date,
    governingSourceId: row.source_id,
    activeStrength: strength,
    gramsPerInterval: row.q[strength],
    intervalDays: row.i[strength],
    effectiveRepeats: row.r[strength],
    fillIndex: 0,
    cursorDate: row.plan_date,
    flagged,
    flagReason,
  };
}

/**
 * Generates windows for the current chain up to (but not including) `untilDate`,
 * applying `today` as the hard stop. Returns generated rows; mutates `chain`.
 */
function generateWindows(chain: ChainState, untilDate: string, orderDaysByStrength: Map<Strength, Map<string, number>>): HistoryRow[] {
  const out: HistoryRow[] = [];
  const hardStop = cmpDate(untilDate, "9999-12-31") === 0 ? untilDate : untilDate;

  while (chain.intervalDays > 0 && chain.gramsPerInterval > 0) {
    if (cmpDate(chain.cursorDate, hardStop) >= 0) break;

    const windowStart = chain.cursorDate;
    const windowEnd = addDays(windowStart, chain.intervalDays);
    const exhausted = chain.fillIndex > chain.effectiveRepeats;

    const dayMap = orderDaysByStrength.get(chain.activeStrength) ?? new Map<string, number>();
    let gramsActual = 0;
    let cur = windowStart;
    while (cmpDate(cur, windowEnd) < 0) {
      gramsActual += dayMap.get(cur) ?? 0;
      cur = addDays(cur, 1);
    }

    // Only emit an overrun row (past the last approved repeat) if there was
    // actual purchase activity in that window — otherwise stop the chain.
    if (exhausted && gramsActual <= 0) break;

    const raw = chain.effectiveRepeats - chain.fillIndex;
    out.push({
      chain_id: chain.chainId,
      email: "", // filled by caller
      source_id: chain.governingSourceId,
      strength: chain.activeStrength,
      fill_index: chain.fillIndex,
      window_start: windowStart,
      window_end: windowEnd,
      grams_target: chain.gramsPerInterval,
      grams_actual: gramsActual,
      total_repeats_effective: chain.effectiveRepeats,
      repeats_remaining_raw: raw,
      repeats_remaining: Math.max(raw, 0),
      flagged: chain.flagged || exhausted,
      flag_reason: exhausted ? "REPEATS_EXHAUSTED_STILL_PURCHASING" : chain.flagReason,
      chain_start_date: chain.chainStartDate,
    });

    chain.fillIndex += 1;
    chain.cursorDate = windowEnd;
  }

  return out;
}

async function main() {
  const sql = postgres(DB_URL, { max: 3 });

  console.log(`[build-history] mode=${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (TARGET_EMAIL) console.log(`[build-history] targeting single email: ${TARGET_EMAIL}`);

  const today = new Date().toISOString().slice(0, 10);

  // ── 1. Load treatment plans ──────────────────────────────────────────────
  const rawPlans = await sql<
    {
      source_id: string;
      email: string;
      plan_date: string;
      diagnosis: string | null;
      outcome: string | null;
      q22: number; q26: number; q29: number;
      r22: number; r26: number; r29: number;
      i22: number; i26: number; i29: number;
    }[]
  >`
    SELECT
      source_id,
      email,
      "date"::text                            AS plan_date,
      diagnosis,
      outcome,
      COALESCE(total_quantity_22::float8, 0)  AS q22,
      COALESCE(total_quantity_26::float8, 0)  AS q26,
      COALESCE(total_quantity_29::float8, 0)  AS q29,
      COALESCE(number_of_repeat_22, 0)::int   AS r22,
      COALESCE(number_of_repeat_26, 0)::int   AS r26,
      COALESCE(number_of_repeat_29, 0)::int   AS r29,
      COALESCE(supply_interval_22, 0)::int    AS i22,
      COALESCE(supply_interval_26, 0)::int    AS i26,
      COALESCE(supply_interval_29, 0)::int    AS i29
    FROM db_treatment_plans
    WHERE email IS NOT NULL AND "date" IS NOT NULL
      ${TARGET_EMAIL ? sql`AND email = ${TARGET_EMAIL}` : sql``}
    ORDER BY email, "date" ASC, source_created_at ASC
  `;

  const plans: PlanRow[] = rawPlans.map((r) => ({
    source_id: r.source_id,
    email: r.email,
    plan_date: r.plan_date,
    diagnosis: r.diagnosis,
    outcome: r.outcome,
    q: { "22": r.q22, "26": r.q26, "29": r.q29 },
    r: { "22": r.r22, "26": r.r26, "29": r.r29 },
    i: { "22": r.i22, "26": r.i26, "29": r.i29 },
  }));
  console.log(`[build-history] loaded ${plans.length} treatment plan rows`);

  // ── 2. Load saleor order-line grams, per email/day/strength ──────────────
  // saleor_order_lines.thc_level carries the actual purchased strength
  // ('thc-22'/'thc-26'/'thc-29'); lines without it (accessories etc.) are
  // excluded since they don't count toward flower supply.
  const orderRows = await sql<{ email: string; order_date: string; strength: string; grams: number }[]>`
    SELECT
      so.email,
      (so.ordered_at AT TIME ZONE 'Australia/Sydney')::date::text AS order_date,
      right(sol.thc_level, 2)                                     AS strength,
      SUM(sol.grams::numeric)                                     AS grams
    FROM saleor_order_lines sol
    JOIN saleor_orders so ON so.source_id = sol.order_id
    WHERE so.email IS NOT NULL
      AND sol.thc_level IN ('thc-22', 'thc-26', 'thc-29')
      ${TARGET_EMAIL ? sql`AND so.email = ${TARGET_EMAIL}` : sql``}
    GROUP BY so.email, (so.ordered_at AT TIME ZONE 'Australia/Sydney')::date, sol.thc_level
    ORDER BY so.email, order_date
  `;

  const ordersByEmail = new Map<string, Map<Strength, Map<string, number>>>();
  for (const row of orderRows) {
    let byStrength = ordersByEmail.get(row.email);
    if (!byStrength) { byStrength = new Map(); ordersByEmail.set(row.email, byStrength); }
    const strength = row.strength as Strength;
    let dayMap = byStrength.get(strength);
    if (!dayMap) { dayMap = new Map(); byStrength.set(strength, dayMap); }
    dayMap.set(row.order_date, Number(row.grams));
  }
  console.log(`[build-history] loaded per-strength order-day grams for ${ordersByEmail.size} emails`);

  // ── 3. Group plans by email ───────────────────────────────────────────────
  const plansByEmail = new Map<string, PlanRow[]>();
  for (const plan of plans) {
    const arr = plansByEmail.get(plan.email) ?? [];
    arr.push(plan);
    plansByEmail.set(plan.email, arr);
  }

  // ── 4. Walk each patient's plan history, linking chains and generating windows ─
  const allRows: HistoryRow[] = [];
  let flaggedChains = 0;
  let unrecognizedResets = 0;

  for (const [email, patientPlans] of plansByEmail) {
    const orderDaysByStrength = ordersByEmail.get(email) ?? new Map<Strength, Map<string, number>>();

    let chain: ChainState | null = null;

    for (let pi = 0; pi < patientPlans.length; pi++) {
      const row = patientPlans[pi];

      if (!isApproved(row.outcome)) {
        // Rejected/withdrawn plan: terminate the current chain right here.
        if (chain) {
          allRows.push(...generateWindows(chain, row.plan_date, orderDaysByStrength).map((r) => ({ ...r, email })));
          chain = null;
        }
        continue;
      }

      const dominant = pickDominantStrength(row);
      if (dominant === null) continue; // approved row with nothing active, skip

      if (!chain) {
        chain = startChain(row, dominant);
        continue;
      }

      // Generate windows under the OLD chain up to this row's date, THEN apply the row's effect.
      allRows.push(...generateWindows(chain, row.plan_date, orderDaysByStrength).map((r) => ({ ...r, email })));

      const kind = classify(row.diagnosis);
      if (kind === "EXTENSION") {
        chain.effectiveRepeats += row.r[chain.activeStrength] || row.r[dominant];
        chain.governingSourceId = row.source_id;
      } else if (kind === "QUANTITY_CHANGE") {
        chain.gramsPerInterval = row.q[chain.activeStrength] || row.q[dominant];
        chain.intervalDays = row.i[chain.activeStrength] || row.i[dominant] || chain.intervalDays;
        chain.governingSourceId = row.source_id;
      } else if (kind === "SWITCH") {
        chain.activeStrength = dominant;
        chain.gramsPerInterval = row.q[dominant];
        chain.intervalDays = row.i[dominant];
        chain.governingSourceId = row.source_id;
      } else {
        // A row only counts as a true no-op continuation if it's still
        // prescribing the SAME strength with the SAME target — comparing
        // against the wrong column (e.g. a stale, unpopulated one) would
        // mask a real silent strength change as "unchanged".
        const unchanged =
          dominant === chain.activeStrength &&
          row.q[dominant] === chain.gramsPerInterval &&
          row.i[dominant] === chain.intervalDays;
        if (unchanged) {
          // Pure continuation (e.g. re-approval with unrelated clinical notes) — no-op.
          continue;
        }
        // Can't safely classify what changed — close old chain, start a fresh one, flag it.
        chain = startChain(row, dominant, true, "UNRECOGNIZED_PLAN_CHANGE");
        unrecognizedResets += 1;
      }
    }

    if (chain) {
      allRows.push(...generateWindows(chain, today, orderDaysByStrength).map((r) => ({ ...r, email })));
      if (chain.flagged) flaggedChains += 1;
    }
  }

  const flaggedRowCount = allRows.filter((r) => r.flagged).length;
  console.log(`[build-history] generated ${allRows.length} history rows across ${plansByEmail.size} patients`);
  console.log(`[build-history] flagged rows: ${flaggedRowCount} (unrecognized plan changes: ${unrecognizedResets}, flagged chains: ${flaggedChains})`);
  console.log(`[build-history] negative repeatsRemainingRaw rows (overrun/audit signal): ${allRows.filter((r) => r.repeats_remaining_raw < 0).length}`);

  if (DRY_RUN) {
    console.log("[build-history] dry run — no writes performed");
    for (const r of allRows.slice(0, 20)) {
      console.log(
        `  ${r.email} chain=${r.chain_id} fill=${r.fill_index} strength=${r.strength} ` +
        `[${r.window_start}, ${r.window_end}) target=${r.grams_target} actual=${r.grams_actual} ` +
        `remaining=${r.repeats_remaining_raw}${r.repeats_remaining_raw !== r.repeats_remaining ? `(clamped ${r.repeats_remaining})` : ""}` +
        `${r.flagged ? ` FLAGGED:${r.flag_reason}` : ""}`,
      );
    }
    if (allRows.length > 20) console.log(`  ... and ${allRows.length - 20} more`);
    await sql.end();
    return;
  }

  // ── 5. Rebuild: delete existing rows in scope, then insert fresh ─────────
  if (TARGET_EMAIL) {
    await sql`DELETE FROM supply_tracking_history WHERE email = ${TARGET_EMAIL}`;
  } else {
    await sql`DELETE FROM supply_tracking_history`;
  }

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO supply_tracking_history ${sql(
        batch.map((r) => ({
          chain_id: r.chain_id,
          email: r.email,
          source_id: r.source_id,
          strength: r.strength,
          fill_index: r.fill_index,
          window_start: r.window_start,
          window_end: r.window_end,
          grams_target: r.grams_target,
          grams_actual: r.grams_actual,
          total_repeats_effective: r.total_repeats_effective,
          repeats_remaining_raw: r.repeats_remaining_raw,
          repeats_remaining: r.repeats_remaining,
          flagged: r.flagged,
          flag_reason: r.flag_reason,
          chain_start_date: r.chain_start_date,
        })),
      )}
      ON CONFLICT (chain_id, fill_index) DO NOTHING
    `;
    console.log(`[build-history] inserted batch ${i / BATCH_SIZE + 1} (${batch.length} rows)`);
  }

  console.log(`[build-history] done. ${allRows.length} rows written.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

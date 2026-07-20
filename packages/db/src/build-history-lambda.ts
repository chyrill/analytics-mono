import postgres from "postgres";

/**
 * build-history-lambda.ts
 *
 * Lambda handler that (re)computes supply_tracking_history — an
 * independently-computed "remaining repeats over time" ledger derived only
 * from db_treatment_plans + saleor_orders/saleor_order_lines. Never reads
 * db_treatment_plan_tracker or supply_tracking (those mirror DocApp's own
 * live counters, which have a verified bug — no floor at zero, no row
 * locking around the decrement — in shop-mono-repo).
 *
 * This is the SAME chain-linking algorithm as scripts/build-supply-tracking-history.ts
 * (kept as a separate, deliberately duplicated copy rather than a shared
 * import — this handler is bundled standalone by esbuild the same way
 * migrate-lambda.ts is, so it has no dependency on the scripts/ folder).
 * If you change the linking rules here, mirror the change there too.
 *
 * Unlike the Migration Lambda, this is NOT invoked automatically on every
 * deploy — it's a heavier, on-demand recompute, invoked manually via:
 *   aws lambda invoke --function-name harvest-analytics-backfill-supply-history-production \
 *     --payload '{}' --cli-binary-format raw-in-base64-out /tmp/result.json
 *
 * Optional payload fields:
 *   { "email": "foo@bar.com" }  -> only rebuild that one patient's chain(s)
 *   { "dryRun": true }          -> compute and log, but don't write anything
 *
 * Safe to rerun anytime: it deletes existing rows in scope, then rebuilds
 * from scratch, so reruns never duplicate or accumulate stale rows.
 */

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

interface BackfillEvent {
  email?: string;
  dryRun?: boolean;
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

interface ChainState {
  chainId: string;
  chainStartDate: string;
  governingSourceId: string;
  activeStrength: Strength;
  gramsPerInterval: number;
  intervalDays: number;
  effectiveRepeats: number;
  fillIndex: number;
  cursorDate: string;
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

function generateWindows(
  chain: ChainState,
  untilDate: string,
  orderDaysByStrength: Map<Strength, Map<string, number>>,
): HistoryRow[] {
  const out: HistoryRow[] = [];

  while (chain.intervalDays > 0 && chain.gramsPerInterval > 0) {
    if (cmpDate(chain.cursorDate, untilDate) >= 0) break;

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

    if (exhausted && gramsActual <= 0) break;

    const raw = chain.effectiveRepeats - chain.fillIndex;
    out.push({
      chain_id: chain.chainId,
      email: "",
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

export const handler = async (
  event: BackfillEvent = {},
): Promise<{ statusCode: number; body: string }> => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  const targetEmail = event.email ?? null;
  const dryRun = event.dryRun === true;

  const ssl = connectionString.includes("amazonaws.com") ? { rejectUnauthorized: false } : false;
  const sql = postgres(connectionString, { max: 1, ssl });

  try {
    console.log(`[build-history] mode=${dryRun ? "DRY RUN" : "LIVE"}${targetEmail ? ` email=${targetEmail}` : ""}`);

    const today = new Date().toISOString().slice(0, 10);

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
        ${targetEmail ? sql`AND email = ${targetEmail}` : sql``}
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
        ${targetEmail ? sql`AND so.email = ${targetEmail}` : sql``}
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

    const plansByEmail = new Map<string, PlanRow[]>();
    for (const plan of plans) {
      const arr = plansByEmail.get(plan.email) ?? [];
      arr.push(plan);
      plansByEmail.set(plan.email, arr);
    }

    const allRows: HistoryRow[] = [];
    let flaggedChains = 0;
    let unrecognizedResets = 0;

    for (const [email, patientPlans] of plansByEmail) {
      const orderDaysByStrength = ordersByEmail.get(email) ?? new Map<Strength, Map<string, number>>();
      let chain: ChainState | null = null;

      for (let pi = 0; pi < patientPlans.length; pi++) {
        const row = patientPlans[pi];

        if (!isApproved(row.outcome)) {
          if (chain) {
            allRows.push(...generateWindows(chain, row.plan_date, orderDaysByStrength).map((r) => ({ ...r, email })));
            chain = null;
          }
          continue;
        }

        const dominant = pickDominantStrength(row);
        if (dominant === null) continue;

        if (!chain) {
          chain = startChain(row, dominant);
          continue;
        }

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
          const unchanged =
            dominant === chain.activeStrength &&
            row.q[dominant] === chain.gramsPerInterval &&
            row.i[dominant] === chain.intervalDays;
          if (unchanged) continue;
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
    const overrunRowCount = allRows.filter((r) => r.repeats_remaining_raw < 0).length;
    console.log(`[build-history] generated ${allRows.length} history rows across ${plansByEmail.size} patients`);
    console.log(`[build-history] flagged rows: ${flaggedRowCount} (unrecognized plan changes: ${unrecognizedResets}, flagged chains: ${flaggedChains})`);
    console.log(`[build-history] negative repeatsRemainingRaw rows (overrun/audit signal): ${overrunRowCount}`);

    if (!dryRun) {
      if (targetEmail) {
        await sql`DELETE FROM supply_tracking_history WHERE email = ${targetEmail}`;
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
      }
      console.log(`[build-history] done. ${allRows.length} rows written.`);
    }

    await sql.end();
    return {
      statusCode: 200,
      body: JSON.stringify({
        dryRun,
        rowsWritten: dryRun ? 0 : allRows.length,
        rowsComputed: allRows.length,
        flaggedRows: flaggedRowCount,
        overrunRows: overrunRowCount,
        patients: plansByEmail.size,
      }),
    };
  } catch (error) {
    await sql.end();
    console.error("[build-history] Failed:", error);
    throw error;
  }
};

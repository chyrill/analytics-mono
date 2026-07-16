import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db } from "@analytics/db";
import { sql } from "drizzle-orm";
import {
  fetchLivePatientAllowance,
  buildMirrorPatientAllowanceQuerySql,
  type LivePatientAllowanceRow,
} from "../lib/docapp-db";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const MS_PER_DAY = 86_400_000;
const AVG_DAYS_PER_MONTH = 30.44;

const toRows = <T = Record<string, unknown>>(r: unknown): T[] => Array.from(r as Iterable<T>);

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

// Terminal/non-active consultation outcomes — excluded when picking the
// patient's *current* treatment plan (mirrors the outcome filter already
// used elsewhere in the analytics DB for "live" plans).
const INACTIVE_OUTCOMES = ["Reject", "No Show", "No Response"];

interface OrderLineRow {
  order_id: string;
  order_number: number | null;
  status: string | null;
  total_grams: string | null;
  total_amount: string | null;
  currency: string | null;
  ordered_at: string;
  line_id: string | null;
  product_name: string | null;
  variant_name: string | null;
  strain: string | null;
  thc_level: string | null;
  cut: string | null;
  line_grams: string | null;
  line_quantity: number | null;
}

interface CurrentPlanRow {
  source_id: string;
  outcome: string | null;
  date: string | null;
  type: string | null;
  diagnosis: string | null;
  dose_per_day_22: string | null;
  strength_concentration_22: string | null;
  max_dose_22: string | null;
  total_quantity_22: string | null;
  number_of_repeat_22: number | null;
  supply_interval_22: number | null;
  dose_per_day_26: string | null;
  strength_concentration_26: string | null;
  max_dose_26: string | null;
  total_quantity_26: string | null;
  number_of_repeat_26: number | null;
  supply_interval_26: number | null;
  dose_per_day_29: string | null;
  strength_concentration_29: string | null;
  max_dose_29: string | null;
  total_quantity_29: string | null;
  number_of_repeat_29: number | null;
  supply_interval_29: number | null;
}

function buildOrderLinesQuery(safeEmail: string) {
  return sql.raw(`
    SELECT
      so.source_id     AS order_id,
      so.order_number,
      so.status,
      so.total_grams,
      so.total_amount,
      so.currency,
      so.ordered_at,
      sol.id            AS line_id,
      sol.product_name,
      sol.variant_name,
      sol.strain,
      sol.thc_level,
      sol.cut,
      sol.grams         AS line_grams,
      sol.quantity      AS line_quantity
    FROM saleor_orders so
    LEFT JOIN saleor_order_lines sol ON sol.order_id = so.source_id
    WHERE so.email = '${safeEmail}'
    ORDER BY so.ordered_at DESC, sol.id
  `);
}

function buildCurrentPlanQuery(safeEmail: string) {
  const outcomeList = INACTIVE_OUTCOMES.map((o) => `'${o}'`).join(", ");
  return sql.raw(`
    SELECT
      source_id, outcome, date, type, diagnosis,
      dose_per_day_22, strength_concentration_22, max_dose_22, total_quantity_22, number_of_repeat_22, supply_interval_22,
      dose_per_day_26, strength_concentration_26, max_dose_26, total_quantity_26, number_of_repeat_26, supply_interval_26,
      dose_per_day_29, strength_concentration_29, max_dose_29, total_quantity_29, number_of_repeat_29, supply_interval_29
    FROM db_treatment_plans
    WHERE email = '${safeEmail}'
      AND (outcome IS NULL OR outcome NOT IN (${outcomeList}))
    ORDER BY date DESC
    LIMIT 1
  `);
}

/** Groups the flat order/line join into one entry per order, with its line items nested. */
function groupOrders(rows: OrderLineRow[]) {
  const byOrder = new Map<string, {
    order_id: string;
    order_number: number | null;
    status: string | null;
    total_grams: number | null;
    total_amount: number | null;
    currency: string | null;
    ordered_at: string;
    lines: { product_name: string | null; variant_name: string | null; strain: string | null; thc_level: string | null; cut: string | null; grams: number | null; quantity: number | null }[];
  }>();

  for (const row of rows) {
    if (!byOrder.has(row.order_id)) {
      byOrder.set(row.order_id, {
        order_id: row.order_id,
        order_number: row.order_number,
        status: row.status,
        total_grams: row.total_grams != null ? Number(row.total_grams) : null,
        total_amount: row.total_amount != null ? Number(row.total_amount) : null,
        currency: row.currency,
        ordered_at: row.ordered_at,
        lines: [],
      });
    }
    if (row.line_id) {
      byOrder.get(row.order_id)!.lines.push({
        product_name: row.product_name,
        variant_name: row.variant_name,
        strain: row.strain,
        thc_level: row.thc_level,
        cut: row.cut,
        grams: row.line_grams != null ? Number(row.line_grams) : null,
        quantity: row.line_quantity,
      });
    }
  }
  return Array.from(byOrder.values());
}

/** Order cadence + consumption pace, used to project a run-out date below. */
function computeCadence(orders: ReturnType<typeof groupOrders>) {
  const orderedAtMs = orders.map((o) => new Date(o.ordered_at).getTime()).sort((a, b) => a - b);
  const lastOrderDate = orderedAtMs.length ? new Date(orderedAtMs[orderedAtMs.length - 1]).toISOString() : null;

  const avgDaysBetweenOrders =
    orderedAtMs.length > 1
      ? (orderedAtMs[orderedAtMs.length - 1] - orderedAtMs[0]) / MS_PER_DAY / (orderedAtMs.length - 1)
      : null;
  const avgOrdersPerMonth = avgDaysBetweenOrders ? AVG_DAYS_PER_MONTH / avgDaysBetweenOrders : null;

  const totalGrams = orders.reduce((sum, o) => sum + (o.total_grams ?? 0), 0);
  const avgGramsPerOrder = orders.length ? totalGrams / orders.length : null;
  const gramsPerDay =
    avgGramsPerOrder != null && avgDaysBetweenOrders != null && avgDaysBetweenOrders > 0
      ? avgGramsPerOrder / avgDaysBetweenOrders
      : null;

  return { lastOrderDate, avgDaysBetweenOrders, avgOrdersPerMonth, avgGramsPerOrder, gramsPerDay };
}

/**
 * Per-order metrics for the order-history table: product count, distinct
 * strain count, and a running "remaining allowance after this order" ledger.
 * The ledger walks orders oldest-to-newest, subtracting each order's grams
 * from the current plan's allotted grams — an approximation using today's
 * allotment throughout history (the analytics DB doesn't retain a
 * per-order-in-time allotment snapshot), floored at zero.
 */
function attachOrderMetrics(orders: ReturnType<typeof groupOrders>, allottedG: number | null) {
  const ascending = [...orders].sort((a, b) => new Date(a.ordered_at).getTime() - new Date(b.ordered_at).getTime());
  const remainingAfterByOrderId = new Map<string, number | null>();
  let cumulativeGrams = 0;
  for (const order of ascending) {
    cumulativeGrams += order.total_grams ?? 0;
    remainingAfterByOrderId.set(order.order_id, allottedG != null ? Math.max(allottedG - cumulativeGrams, 0) : null);
  }

  return orders.map((order) => {
    const productLines = order.lines.filter((l) => l.grams != null);
    const strainCount = new Set(productLines.map((l) => l.strain).filter((s): s is string => !!s)).size;
    return {
      ...order,
      product_count: productLines.length,
      strain_count: strainCount,
      remaining_after_g: remainingAfterByOrderId.get(order.order_id) ?? null,
    };
  });
}

/** Strength (22/26/29) cascade for the current plan — same priority as docapp-db.ts's tracker cascade. */
function selectActivePlanStrength(plan: CurrentPlanRow) {
  const tiers: [22 | 26 | 29, CurrentPlanRow][] = [
    [26, plan],
    [29, plan],
    [22, plan],
  ];
  for (const [tier] of tiers) {
    const totalQty = plan[`total_quantity_${tier}` as keyof CurrentPlanRow];
    if (totalQty != null && Number(totalQty) > 0) {
      return {
        strength: tier,
        dose_per_day: plan[`dose_per_day_${tier}` as keyof CurrentPlanRow],
        strength_concentration: plan[`strength_concentration_${tier}` as keyof CurrentPlanRow],
        max_dose: plan[`max_dose_${tier}` as keyof CurrentPlanRow],
        total_quantity: totalQty,
        number_of_repeat: plan[`number_of_repeat_${tier}` as keyof CurrentPlanRow],
        supply_interval: plan[`supply_interval_${tier}` as keyof CurrentPlanRow],
      };
    }
  }
  return null;
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  const routeKey = event.routeKey ?? "";
  const qs = event.queryStringParameters ?? {};

  try {
    if (routeKey !== "GET /patient-orders-detail") return err("Not found", 404);

    const email = (qs.email ?? "").toLowerCase().trim();
    if (!email) return err("email required");
    const safeEmail = email.replace(/[^a-z0-9.@_+\-]/gi, "").replace(/'/g, "''");

    // Remaining allowance: live doc-app read first — some treatment plan
    // data isn't reliably synced to the analytics DB — with a mirror
    // fallback (db_treatment_plan_tracker) if the live connection fails.
    // See docs/customer-health-index-deep-dive.md §2.3.
    let stale = false;
    let allowance: LivePatientAllowanceRow | null;
    try {
      allowance = await fetchLivePatientAllowance(email);
    } catch (e) {
      console.warn("[patient-detail] live doc-app fetch failed, falling back to analytics-DB mirror:", e);
      stale = true;
      const mirrorRows = toRows<LivePatientAllowanceRow>(
        await db.execute(sql.raw(buildMirrorPatientAllowanceQuerySql(email))),
      );
      allowance = mirrorRows[0] ?? null;
    }

    const [orderLineRows, currentPlanRows] = await Promise.all([
      db.execute(buildOrderLinesQuery(safeEmail)),
      db.execute(buildCurrentPlanQuery(safeEmail)),
    ]);

    const orders = groupOrders(toRows<OrderLineRow>(orderLineRows));
    const cadence = computeCadence(orders);
    const currentPlan = toRows<CurrentPlanRow>(currentPlanRows)[0] ?? null;
    const activePlanStrength = currentPlan ? selectActivePlanStrength(currentPlan) : null;

    const allottedG =
      allowance?.supply_interval_total_active != null && allowance?.repeats != null
        ? Number(allowance.supply_interval_total_active) * Number(allowance.repeats)
        : null;
    const boughtG = allowance?.supply_used_total_active != null ? Number(allowance.supply_used_total_active) : null;
    const remainingG = allottedG != null && boughtG != null ? Math.max(allottedG - boughtG, 0) : null;

    const predictedRunOutDate =
      remainingG != null && cadence.gramsPerDay != null && cadence.gramsPerDay > 0
        ? new Date(Date.now() + (remainingG / cadence.gramsPerDay) * MS_PER_DAY).toISOString()
        : null;

    // Distinct strains bought across all orders — powers the "strain exploration" badge.
    const strainsExplored = Array.from(
      new Set(orders.flatMap((o) => o.lines.map((l) => l.strain)).filter((s): s is string => !!s)),
    );

    const ordersWithMetrics = attachOrderMetrics(orders, allottedG);

    return ok({
      email,
      stale,
      orders: ordersWithMetrics,
      cadence: {
        last_order_date: cadence.lastOrderDate,
        avg_days_between_orders: cadence.avgDaysBetweenOrders,
        avg_orders_per_month: cadence.avgOrdersPerMonth,
        avg_grams_per_order: cadence.avgGramsPerOrder,
      },
      current_plan: currentPlan
        ? {
            outcome: currentPlan.outcome,
            date: currentPlan.date,
            type: currentPlan.type,
            diagnosis: currentPlan.diagnosis,
            active_strength: activePlanStrength,
          }
        : null,
      allowance: {
        repeats: allowance?.repeats ?? null,
        repeats_remaining: allowance?.repeats_remaining_active ?? null,
        script_expiration_date: allowance?.script_expiration_date ?? null,
        needs_update: allowance?.needs_update ?? null,
        allotted_g: allottedG,
        bought_g: boughtG,
        remaining_g: remainingG,
        predicted_run_out_date: predictedRunOutDate,
      },
      strains_explored: strainsExplored,
    });
  } catch (e) {
    console.error("[patient-detail]", e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};

import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db } from "@analytics/db";
import { sql } from "drizzle-orm";
import {
  fetchLivePatientHealthData,
  buildMirrorTrackerSelectedCte,
  MIRROR_ADHERENCE_PCT_SQL,
  type LivePatientHealthRow,
} from "../lib/docapp-db";
// GET /patient-orders-detail is served by this same Lambda (see routeKey
// dispatch below) rather than a dedicated function — reuses this handler's
// existing IAM role/log group/API Gateway integration instead of adding new
// infra, consistent with how /health-data, /health-data/export, and
// /health-detail already share this one Lambda.
import { handler as patientOrdersDetailHandler } from "./patient-detail";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

const GROUP_CRITERIA = {
  purple: [
    { code: "grams_75_110", flag: "is_purple_grams_75_110" },
    { code: "purchase_within_30d", flag: "is_purple_recent_purchase_30" },
    { code: "repeat_cycles_3_plus", flag: "is_purple_repeat_count_3" },
    { code: "consultation_current", flag: "is_purple_consultation_current" },
  ],
  green: [
    { code: "grams_50_75", flag: "is_green_grams_50_75" },
    { code: "purchase_within_45d", flag: "is_green_recent_purchase_45" },
    { code: "consultation_not_overdue", flag: "is_green_consultation_current" },
  ],
  orange: [
    { code: "grams_25_50", flag: "is_orange_grams_25_50" },
    { code: "purchase_46_90d", flag: "is_orange_no_purchase_46_90" },
    { code: "consultation_due_or_recently_overdue", flag: "is_orange_consultation_due" },
  ],
  red: [
    { code: "grams_below_25", flag: "is_red_low_grams" },
    { code: "purchase_over_90d", flag: "is_red_no_purchase_90" },
    { code: "consultation_overdue_60d", flag: "is_red_consultation_overdue_60" },
  ],
} as const;

type GroupKey = keyof typeof GROUP_CRITERIA;
type RawHealthRow = Record<string, unknown> & { adherence_group?: GroupKey | null };

function toBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function enrichHealthRows(rows: RawHealthRow[]) {
  const criteriaCountsByGroup: Record<string, Record<string, number>> = {};

  const enrichedRows = rows.map((row) => {
    const group = row.adherence_group;
    const criteria = group ? GROUP_CRITERIA[group] : undefined;
    const matchedCriteria = criteria
      ? criteria.filter(({ flag }) => toBoolean(row[flag])).map(({ code }) => code)
      : [];

    if (group) {
      const groupCounts = (criteriaCountsByGroup[group] ??= {});
      for (const code of matchedCriteria) {
        groupCounts[code] = (groupCounts[code] ?? 0) + 1;
      }
    }

    const cleaned = { ...row, matched_criteria: matchedCriteria } as Record<string, unknown>;
    for (const groupCriteria of Object.values(GROUP_CRITERIA)) {
      for (const { flag } of groupCriteria) delete cleaned[flag];
    }
    return cleaned;
  });

  return { rows: enrichedRows, criteriaCountsByGroup };
}

const toRows = <T = Record<string, unknown>>(r: unknown): T[] => Array.from(r as Iterable<T>);

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

/** Analytics-DB shop-engagement (cart_sessions-based conversion/visit metrics). */
interface ShopEngagementRow {
  email: string;
  total_purchases: number | null;
  purchase_rate_pct: number | null;
}

interface LastOrderRow {
  email: string;
  last_order_date: string | null;
}

function buildShopEngagementQuery(from?: string | null, to?: string | null) {
  const safeFrom = from && DATE_RE.test(from) ? from : null;
  const safeTo = to && DATE_RE.test(to) ? to : null;
  const cartFilter = safeFrom
    ? `\n      AND source_created_at >= '${safeFrom}'${safeTo ? ` AND source_created_at < '${safeTo}'` : ""}`
    : "";

  return sql.raw(`
    SELECT
      LOWER(TRIM(email))                                                                                AS email,
      COUNT(*) FILTER (WHERE is_converted = true)                                                       AS total_purchases,
      ROUND(COUNT(*) FILTER (WHERE is_converted = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1)         AS purchase_rate_pct
    FROM cart_sessions
    WHERE is_deleted = false AND email IS NOT NULL${cartFilter}
    GROUP BY LOWER(TRIM(email))
  `);
}

function buildLastOrderQuery() {
  return sql.raw(`
    SELECT
      LOWER(TRIM(email))                                        AS email,
      MAX(COALESCE(order_date::date, source_created_at::date))  AS last_order_date
    FROM orders_dispatched
    WHERE email IS NOT NULL
    GROUP BY LOWER(TRIM(email))
  `);
}

/** Analytics-DB (Saleor sync mirror) total grams bought, all-time — used as a
 *  fallback source for `bought_g` when doc-app's own tracker hasn't recorded
 *  any usage (supply_used_total_active is 0/null) for a patient, and for
 *  `last_visit` when doc-app has no recorded visit but the patient has a
 *  Saleor order on file. */
interface SaleorGramsRow {
  email: string;
  total_grams: number | null;
  last_order_date: string | null;
}

function buildSaleorGramsQuery() {
  return sql.raw(`
    SELECT
      LOWER(TRIM(email))       AS email,
      SUM(total_grams)         AS total_grams,
      MAX(ordered_at)::date    AS last_order_date
    FROM saleor_orders
    WHERE email IS NOT NULL
    GROUP BY LOWER(TRIM(email))
  `);
}

/** Mirrors docapp-db.ts's ADHERENCE_PCT_SQL, applied in application code when
 *  `bought_g` has been swapped for the Saleor-sourced figure below. */
function computeAdherencePct(
  boughtG: number | null,
  repeats: number | null,
  repeatsRemainingActive: number | null,
  supplyIntervalTotalActive: number | null,
): number | null {
  if (repeats == null || supplyIntervalTotalActive == null) return null;
  // doc-app's own repeats_remaining_active is sometimes corrupted (negative,
  // or larger than repeats + 1) — clamp it into the only sane range so a bad
  // value can't blow the denominator up (or down) into a misleading ratio.
  const safeRepeatsRemaining = Math.min(Math.max(repeatsRemainingActive ?? 0, 0), repeats);
  const denominator = (repeats - (safeRepeatsRemaining - 1)) * supplyIntervalTotalActive;
  if (denominator <= 0) return null;
  return Math.round(Math.min((boughtG ?? 0) / denominator, 1) * 1000) / 10;
}

/**
 * Analytics-DB mirror fallback for the patient + tracker + visit dataset,
 * used only when the live doc-app connection (DOCAPP_DATABASE_URL) fails.
 * Produces the same row shape as fetchLivePatientHealthData() so downstream
 * merge/computation logic is source-agnostic.
 */
function buildMirrorPatientHealthQuery() {
  return sql.raw(`
    WITH
    population AS (
      SELECT
        LOWER(TRIM(dp.email))        AS email,
        dp.full_name                 AS patient_name,
        dp.source_created_at::date   AS signed_up
      FROM db_patients dp
      WHERE dp.contact_id IS NOT NULL
        AND dp.email IS NOT NULL
        AND TRIM(dp.email) <> ''
    ),
    ${buildMirrorTrackerSelectedCte("db_treatment_plan_tracker", "needs_update")},
    supply_by_interval AS (
      SELECT DISTINCT ON (LOWER(TRIM(email)), interval_key)
        LOWER(TRIM(email))        AS email,
        interval_key,
        supply_remaining_interval
      FROM supply_tracking
      WHERE email IS NOT NULL
        AND LOWER(TRIM(email)) IN (SELECT email FROM population)
      ORDER BY LOWER(TRIM(email)), interval_key, source_created_at DESC
    ),
    visit_stats AS (
      SELECT
        email,
        COUNT(*)                                       AS total_visits,
        AVG(supply_remaining_interval::numeric)         AS avg_remaining_g,
        ROUND(COUNT(*)::numeric / GREATEST(
          EXTRACT(EPOCH FROM (NOW() - MIN(interval_key::date))) / (30.44 * 86400.0), 1
        ), 1)                                           AS avg_visits_per_month,
        CASE
          WHEN COUNT(*) > 1 THEN
            ROUND((MAX(interval_key::date) - MIN(interval_key::date))::numeric
              / NULLIF(COUNT(*) - 1, 0), 1)
          ELSE NULL
        END                                             AS avg_days_between_visits,
        MAX(interval_key::date)                         AS last_visit
      FROM supply_by_interval
      GROUP BY email
    )
    SELECT
      p.email,
      p.patient_name,
      p.signed_up,
      ts.repeats,
      ts.script_expiration_date,
      ts.needs_update,
      ts.strength,
      ts.supply_total_active,
      ts.supply_interval_total_active,
      ts.supply_used_total_active,
      ts.repeats_remaining_active,
      ROUND((ts.supply_interval_total_active * ts.repeats)::numeric, 1)   AS alloted_g,
      ROUND(COALESCE(ts.supply_used_total_active, 0)::numeric, 1)        AS bought_g,
      ${MIRROR_ADHERENCE_PCT_SQL} AS adherence_pct,
      ROUND(vs.avg_remaining_g::numeric, 1)                             AS avg_remaining_g,
      COALESCE(vs.total_visits, 0)                                      AS total_visits,
      vs.avg_visits_per_month,
      vs.avg_days_between_visits,
      vs.last_visit
    FROM population p
    LEFT JOIN tracker_selected ts ON ts.email = p.email
    LEFT JOIN visit_stats      vs ON vs.email = p.email
  `);
}

function daysSince(dateLike: string | Date | null | undefined): number | null {
  if (!dateLike) return null;
  const t = dateLike instanceof Date ? dateLike.getTime() : new Date(dateLike).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / MS_PER_DAY;
}

interface ComputedHealthRow {
  patient_name: string | null;
  email: string;
  signed_up: string | null;
  script_end_date: string | null;
  repeat_count: number | null;
  repeats_remaining: number | null;
  allotted_g: number | null;
  bought_g: number | null;
  avg_remaining_g: number | null;
  adherence_pct: number | null;
  adherence_group: string | null;
  total_visits: number;
  total_purchases: number | null;
  purchase_rate_pct: number | null;
  avg_visits_per_month: number | null;
  avg_days_between_visits: number | null;
  last_visit: string | null;
  visit_tier: string | null;
  conversion_tier: string | null;
  customer_pattern: string;
  is_red_low_grams: boolean;
  is_red_no_purchase_90: boolean;
  is_red_consultation_overdue_60: boolean;
  is_orange_grams_25_50: boolean;
  is_orange_no_purchase_46_90: boolean;
  is_orange_consultation_due: boolean;
  is_purple_grams_75_110: boolean;
  is_purple_recent_purchase_30: boolean;
  is_purple_repeat_count_3: boolean;
  is_purple_consultation_current: boolean;
  is_green_grams_50_75: boolean;
  is_green_recent_purchase_45: boolean;
  is_green_consultation_current: boolean;
}

/**
 * Merges one patient row (live doc-app or mirror fallback, same shape) with
 * the analytics-DB shop-engagement / last-order data and computes every
 * GROUP_CRITERIA flag + tier field the old SQL used to compute in-database.
 */
function computeHealthRow(
  patient: LivePatientHealthRow,
  shop: ShopEngagementRow | undefined,
  lastOrder: LastOrderRow | undefined,
  saleorGrams: SaleorGramsRow | undefined,
): ComputedHealthRow {
  // doc-app's tracker can under-report grams bought (usage not recorded
  // there) even though the patient has real Saleor purchase history —
  // whenever Saleor's total exceeds the tracker's, trust Saleor instead and
  // recompute adherence_pct off of it (doc-app's precomputed adherence_pct
  // would otherwise still be based on the smaller tracker figure).
  const docAppBoughtG = patient.bought_g != null ? Number(patient.bought_g) : null;
  const saleorBoughtG = saleorGrams?.total_grams != null ? Number(saleorGrams.total_grams) : null;
  const useSaleorBoughtG = saleorBoughtG != null && saleorBoughtG > (docAppBoughtG ?? 0);
  const boughtG = useSaleorBoughtG ? saleorBoughtG : docAppBoughtG;

  const adherencePct = useSaleorBoughtG
    ? computeAdherencePct(
        boughtG,
        patient.repeats != null ? Number(patient.repeats) : null,
        patient.repeats_remaining_active != null ? Number(patient.repeats_remaining_active) : null,
        patient.supply_interval_total_active != null ? Number(patient.supply_interval_total_active) : null,
      )
    : patient.adherence_pct != null ? Number(patient.adherence_pct) : null;
  const hasPlan = patient.repeats != null || patient.supply_total_active != null;
  const repeatCount = patient.repeats != null ? Number(patient.repeats) : null;
  const purchaseRatePct = shop?.purchase_rate_pct != null ? Number(shop.purchase_rate_pct) : null;
  const avgVisitsPerMonth = patient.avg_visits_per_month != null ? Number(patient.avg_visits_per_month) : null;

  // Doc-app has no visit recorded for some patients even though they've
  // placed a Saleor order — fall back to their most recent Saleor order date.
  const lastVisit = patient.last_visit ?? saleorGrams?.last_order_date ?? null;

  const lastActivityDate = lastOrder?.last_order_date ?? lastVisit;
  const daysSinceActivity = daysSince(lastActivityDate);
  const daysOverdue = daysSince(patient.script_expiration_date); // positive = past expiration

  const isRedLowGrams = adherencePct != null && adherencePct < 25;
  const isRedNoPurchase90 = daysSinceActivity == null || daysSinceActivity > 90;
  const isRedConsultationOverdue60 = daysOverdue != null && daysOverdue > 60;

  const isOrangeGrams2550 = adherencePct != null && adherencePct >= 25 && adherencePct <= 50;
  const isOrangeNoPurchase4690 = daysSinceActivity != null && daysSinceActivity > 45 && daysSinceActivity <= 90;
  const isOrangeConsultationDue =
    Boolean(patient.needs_update) || (daysOverdue != null && daysOverdue >= 0 && daysOverdue <= 60);

  const isPurpleGrams75110 = adherencePct != null && adherencePct >= 75 && adherencePct <= 110;
  const isPurpleRecentPurchase30 = daysSinceActivity != null && daysSinceActivity <= 30;
  const isPurpleRepeatCount3 = (repeatCount ?? 0) >= 3;
  const consultationCurrent = !patient.needs_update && (daysOverdue == null || daysOverdue < 0);

  const isGreenGrams5075 = adherencePct != null && adherencePct >= 50 && adherencePct <= 75;
  const isGreenRecentPurchase45 = daysSinceActivity != null && daysSinceActivity <= 45;

  let adherenceGroup: string | null;
  if (adherencePct == null) {
    adherenceGroup = hasPlan ? "red" : null;
  } else if (adherencePct >= 75 && (repeatCount ?? 0) >= 3 && (purchaseRatePct ?? 100) >= 60) {
    adherenceGroup = "purple";
  } else if (adherencePct >= 50) {
    adherenceGroup = "green";
  } else if (adherencePct >= 25) {
    adherenceGroup = "orange";
  } else {
    adherenceGroup = "red";
  }

  let visitTier: string | null;
  if (avgVisitsPerMonth == null) visitTier = null;
  else if (avgVisitsPerMonth >= 4) visitTier = "frequent";
  else if (avgVisitsPerMonth >= 1) visitTier = "occasional";
  else visitTier = "rare";

  let conversionTier: string | null;
  if (purchaseRatePct == null) conversionTier = null;
  else if (purchaseRatePct >= 60) conversionTier = "high_converter";
  else if (purchaseRatePct >= 30) conversionTier = "moderate_converter";
  else conversionTier = "low_converter";

  let customerPattern: string;
  if (adherencePct != null && adherencePct >= 75 && (avgVisitsPerMonth ?? 0) >= 4 && (purchaseRatePct ?? 0) >= 60) {
    customerPattern = "loyal_power_buyer";
  } else if (adherencePct != null && adherencePct >= 75) {
    customerPattern = "high_adherent";
  } else if (
    (avgVisitsPerMonth ?? 0) >= 4 &&
    (purchaseRatePct ?? 0) >= 60 &&
    (adherencePct == null || adherencePct < 75)
  ) {
    customerPattern = "active_partial_buyer";
  } else if ((avgVisitsPerMonth ?? 0) >= 2 && purchaseRatePct != null && purchaseRatePct < 30) {
    customerPattern = "window_shopper";
  } else if ((avgVisitsPerMonth ?? 0) >= 1 && (purchaseRatePct ?? 0) >= 30) {
    customerPattern = "casual_buyer";
  } else if ((avgVisitsPerMonth ?? 0) < 1 && (adherencePct == null || adherencePct < 25)) {
    customerPattern = "at_risk";
  } else {
    customerPattern = "needs_review";
  }

  return {
    patient_name: patient.patient_name,
    email: patient.email,
    signed_up: patient.signed_up,
    script_end_date: patient.script_expiration_date,
    repeat_count: repeatCount,
    // doc-app's own counter has no floor at zero (see docapp-db.ts comment
    // above) and can go negative — clamp what we display, same floor already
    // applied internally to the adherence % calc via computeAdherencePct().
    repeats_remaining:
      patient.repeats_remaining_active != null ? Math.max(0, Number(patient.repeats_remaining_active)) : null,
    allotted_g: patient.alloted_g != null ? Number(patient.alloted_g) : null,
    bought_g: boughtG,
    avg_remaining_g: patient.avg_remaining_g != null ? Number(patient.avg_remaining_g) : null,
    adherence_pct: adherencePct,
    adherence_group: adherenceGroup,
    total_visits: patient.total_visits ?? 0,
    total_purchases: shop?.total_purchases ?? null,
    purchase_rate_pct: purchaseRatePct,
    avg_visits_per_month: avgVisitsPerMonth,
    avg_days_between_visits: patient.avg_days_between_visits != null ? Number(patient.avg_days_between_visits) : null,
    last_visit: lastVisit,
    visit_tier: visitTier,
    conversion_tier: conversionTier,
    customer_pattern: customerPattern,
    is_red_low_grams: isRedLowGrams,
    is_red_no_purchase_90: isRedNoPurchase90,
    is_red_consultation_overdue_60: isRedConsultationOverdue60,
    is_orange_grams_25_50: isOrangeGrams2550,
    is_orange_no_purchase_46_90: isOrangeNoPurchase4690,
    is_orange_consultation_due: isOrangeConsultationDue,
    is_purple_grams_75_110: isPurpleGrams75110,
    is_purple_recent_purchase_30: isPurpleRecentPurchase30,
    is_purple_repeat_count_3: isPurpleRepeatCount3,
    is_purple_consultation_current: consultationCurrent,
    is_green_grams_50_75: isGreenGrams5075,
    is_green_recent_purchase_45: isGreenRecentPurchase45,
    is_green_consultation_current: consultationCurrent,
  };
}

/**
 * Fetches patient rows from the live doc-app DB, falling back to the
 * analytics-DB mirror if the live connection fails for any reason.
 * Returns the merged, fully-computed health rows plus a `stale` flag.
 */
async function loadHealthRows(
  from?: string | null,
  to?: string | null,
): Promise<{ rows: ComputedHealthRow[]; stale: boolean }> {
  let stale = false;
  let patientRows: LivePatientHealthRow[];
  try {
    patientRows = await fetchLivePatientHealthData();
  } catch (e) {
    console.warn("[health] live doc-app fetch failed, falling back to analytics-DB mirror:", e);
    stale = true;
    patientRows = toRows<LivePatientHealthRow>(await db.execute(buildMirrorPatientHealthQuery()));
  }

  const [shopResult, lastOrderResult, saleorGramsResult] = await Promise.all([
    db.execute(buildShopEngagementQuery(from, to)),
    db.execute(buildLastOrderQuery()),
    db.execute(buildSaleorGramsQuery()),
  ]);
  const shopByEmail = new Map(toRows<ShopEngagementRow>(shopResult).map((r) => [r.email, r]));
  const lastOrderByEmail = new Map(toRows<LastOrderRow>(lastOrderResult).map((r) => [r.email, r]));
  const saleorGramsByEmail = new Map(toRows<SaleorGramsRow>(saleorGramsResult).map((r) => [r.email, r]));

  const rows = patientRows.map((patient) =>
    computeHealthRow(
      patient,
      shopByEmail.get(patient.email),
      lastOrderByEmail.get(patient.email),
      saleorGramsByEmail.get(patient.email),
    ),
  );

  rows.sort((a, b) => {
    const rank = (g: string | null) => (g === "purple" ? 1 : g === "green" ? 2 : g === "orange" ? 3 : g === "red" ? 4 : 5);
    const diff = rank(a.adherence_group) - rank(b.adherence_group);
    if (diff !== 0) return diff;
    const aDate = a.last_visit ? new Date(a.last_visit).getTime() : -Infinity;
    const bDate = b.last_visit ? new Date(b.last_visit).getTime() : -Infinity;
    return bDate - aDate;
  });

  return { rows, stale };
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  const routeKey = event.routeKey ?? "";
  const qs = event.queryStringParameters ?? {};

  try {
    // GET /patient-orders-detail — delegated to patient-detail.ts's handler
    // (bundled into this same Lambda; see import comment above).
    if (routeKey === "GET /patient-orders-detail") {
      return patientOrdersDetailHandler(event, {} as never, (() => { }) as never) as Promise<APIGatewayProxyStructuredResultV2>;
    }

    // GET /health-data
    if (routeKey === "GET /health-data") {
      const { rows, stale } = await loadHealthRows(qs.from, qs.to);
      const enriched = enrichHealthRows(rows as unknown as RawHealthRow[]);
      return ok({
        rows: enriched.rows,
        count: enriched.rows.length,
        criteriaCountsByGroup: enriched.criteriaCountsByGroup,
        stale,
      });
    }

    // GET /health-data/export
    if (routeKey === "GET /health-data/export") {
      const { rows } = await loadHealthRows(qs.from, qs.to);
      const group = qs.group?.trim();
      const filtered = group === "noplan" ? rows.filter((r) => r.adherence_group == null) : rows;

      const cols: [string, string][] = [
        ["patient_name", "Patient Name"], ["email", "Email"], ["adherence_group", "Group"],
        ["allotted_g", "Allotted (g)"], ["bought_g", "Bought (g)"], ["avg_remaining_g", "Avg Rem (g)"],
        ["adherence_pct", "Adherence %"], ["repeat_count", "Orders"], ["total_visits", "Visits"],
        ["purchase_rate_pct", "Conv %"], ["avg_visits_per_month", "Vis/mo"],
        ["last_visit", "Last Visit"], ["signed_up", "Signed Up"],
        ["customer_pattern", "Pattern"], ["visit_tier", "Visit Tier"], ["conversion_tier", "Conv Tier"],
      ];
      const escape = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = cols.map(([, label]) => label).join(",");
      const body = filtered
        .map((r) => cols.map(([key]) => escape((r as unknown as Record<string, unknown>)[key])).join(","))
        .join("\n");
      const filename = group === "noplan" ? "no-plan-contacts.csv" : "health-contacts.csv";
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
        body: `${header}\n${body}`,
      };
    }

    // GET /health-detail
    if (routeKey === "GET /health-detail") {
      const email = (qs.email ?? "").toLowerCase().trim();
      if (!email) return err("email required");

      // Sanitize email to prevent SQL injection — only allow safe characters
      const safeEmail = email.replace(/[^a-z0-9.@_+\-]/gi, "").replace(/'/g, "''");

      const [visitsByMonth, latestPlan, spendByMonth, gramsPerOrder, saleorGrams] = await Promise.all([
        db.execute(sql.raw(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', source_created_at AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
            DATE_TRUNC('month', source_created_at AT TIME ZONE 'Australia/Sydney') AS month_ts,
            COUNT(*)::int AS visits,
            COUNT(*) FILTER (WHERE is_converted = true)::int AS purchases
          FROM cart_sessions
          WHERE email = '${safeEmail}' AND is_deleted = false
          GROUP BY 2 ORDER BY 2
        `)),
        db.execute(sql.raw(`
          SELECT supply_interval_total::numeric AS allotted_g
          FROM supply_tracking
          WHERE email = '${safeEmail}' AND supply_interval_total::numeric > 0
          ORDER BY source_created_at DESC LIMIT 1
        `)),
        db.execute(sql.raw(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', COALESCE(order_date::timestamp, source_created_at) AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
            DATE_TRUNC('month', COALESCE(order_date::timestamp, source_created_at) AT TIME ZONE 'Australia/Sydney') AS month_ts,
            ROUND(SUM(order_total::numeric), 2) AS total_spent,
            COUNT(*)::int AS order_count
          FROM orders_dispatched
          WHERE email = '${safeEmail}' AND order_total IS NOT NULL
          GROUP BY 2 ORDER BY 2
        `)),
        db.execute(sql.raw(`
          SELECT
            COALESCE(order_date, source_created_at::date)::text AS label,
            COALESCE(order_date, source_created_at::date) AS order_date,
            ROUND((
              COALESCE(weight_22::numeric, 0) + COALESCE(weight_26::numeric, 0) + COALESCE(weight_29::numeric, 0)
            ), 1) AS grams
          FROM orders_dispatched
          WHERE email = '${safeEmail}' AND (
            COALESCE(weight_22::numeric, 0) + COALESCE(weight_26::numeric, 0) + COALESCE(weight_29::numeric, 0)
          ) > 0
          ORDER BY order_date
        `)),
        db.execute(sql.raw(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', ordered_at AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
            DATE_TRUNC('month', ordered_at AT TIME ZONE 'Australia/Sydney') AS month_ts,
            ROUND(SUM(total_grams::numeric), 1) AS used_g
          FROM saleor_orders
          WHERE email = '${safeEmail}'
          GROUP BY 2 ORDER BY 2
        `)),
      ]);

      const allottedG = (toRows<{ allotted_g: string | null }>(latestPlan)[0])?.allotted_g ?? null;
      const gramsByMonth = toRows<{ month: string; month_ts: string; used_g: string }>(saleorGrams).map((r) => ({
        ...r, allotted_g: allottedG ? parseFloat(allottedG) : null,
      }));

      const spendRows = toRows<{ total_spent: string }>(spendByMonth);
      const visitRows = toRows<{ visits: string }>(visitsByMonth);
      const totalSpent = spendRows.reduce((s, r) => s + parseFloat(r.total_spent || "0"), 0);
      const spendMonths = spendRows.length || 1;
      const totalVisits = visitRows.reduce((s, r) => s + parseInt(r.visits || "0"), 0);
      const avgGrams = gramsByMonth.length
        ? gramsByMonth.reduce((s, r) => s + parseFloat(String(r.used_g)), 0) / gramsByMonth.length
        : 0;

      return ok({
        visitsByMonth: toRows(visitsByMonth),
        gramsByMonth,
        spendByMonth: toRows(spendByMonth),
        gramsPerOrder: toRows(gramsPerOrder),
        summary: {
          total_spent: totalSpent.toFixed(2),
          avg_monthly_spend: (totalSpent / spendMonths).toFixed(2),
          total_visits: totalVisits,
          avg_grams_per_interval: avgGrams.toFixed(1),
        },
      });
    }

    return err("Not found", 404);
  } catch (e) {
    console.error("[health]", e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};

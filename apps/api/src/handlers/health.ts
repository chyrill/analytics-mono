import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db } from "@analytics/db";
import { sql } from "drizzle-orm";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toRows = <T = Record<string, unknown>>(r: unknown): T[] => Array.from(r as Iterable<T>);

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

function buildHealthQuery(from?: string | null, to?: string | null) {
  const safeFrom = from && DATE_RE.test(from) ? from : null;
  const safeTo = to && DATE_RE.test(to) ? to : null;

  const saleorFilter = safeFrom
    ? `\n    AND ordered_at >= '${safeFrom}'${safeTo ? ` AND ordered_at < '${safeTo}'` : ""}`
    : "";
  const cartFilter = safeFrom
    ? `\n    AND source_created_at >= '${safeFrom}'${safeTo ? ` AND source_created_at < '${safeTo}'` : ""}`
    : "";

  return sql.raw(`
  WITH
  supply_by_interval AS (
    SELECT DISTINCT ON (email, interval_key)
      email,
      interval_key,
      supply_interval_total     AS allotted_this_interval,
      supply_used_interval      AS used_this_interval,
      supply_remaining_interval AS remaining_this_interval,
      supply_remaining_repeats  AS remaining_repeats_snapshot
    FROM supply_tracking
    WHERE supply_interval_total IS NOT NULL AND supply_interval_total::numeric > 0
    ORDER BY email, interval_key, source_created_at DESC
  ),
  allowance_totals AS (
    SELECT
      email,
      COUNT(*)::int                                AS repeat_count,
      SUM(allotted_this_interval::numeric)         AS allotted_g,
      AVG(remaining_this_interval::numeric)        AS avg_remaining_g,
      AVG(allotted_this_interval::numeric)         AS avg_allotted_g,
      MIN(remaining_repeats_snapshot)              AS repeats_remaining
    FROM supply_by_interval
    GROUP BY email
  ),
  saleor_used AS (
    SELECT
      email,
      SUM(total_grams::numeric)  AS used_g,
      COUNT(*)::int              AS order_count
    FROM saleor_orders
    WHERE email IS NOT NULL${saleorFilter}
    GROUP BY email
  ),
  shop_engagement AS (
    SELECT
      email,
      COUNT(*)                                                             AS total_visits,
      COUNT(*) FILTER (WHERE is_converted = true)                         AS total_purchases,
      ROUND(COUNT(*) FILTER (WHERE is_converted = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS purchase_rate_pct,
      ROUND(COUNT(*)::numeric / GREATEST(
        EXTRACT(EPOCH FROM (NOW() - MIN(source_created_at))) / (30.44 * 86400.0), 1
      ), 1)                                                                AS avg_visits_per_month,
      CASE
        WHEN COUNT(*) > 1 THEN
          ROUND(EXTRACT(EPOCH FROM (MAX(source_created_at) - MIN(source_created_at))) / 86400.0
            / NULLIF(COUNT(*) - 1, 0), 1)
        ELSE NULL
      END                                                                  AS avg_days_between_visits,
      (MAX(source_created_at) AT TIME ZONE 'Australia/Sydney')::date       AS last_visit
    FROM cart_sessions
    WHERE is_deleted = false AND email IS NOT NULL${cartFilter}
    GROUP BY email
  )
  SELECT
    c.name                                                                 AS patient_name,
    zc.email                                                               AS email,
    (c.created_at AT TIME ZONE 'Australia/Sydney')::date                  AS signed_up,
    at.repeat_count,
    at.repeats_remaining,
    ROUND(at.allotted_g, 1)                                               AS allotted_g,
    ROUND(COALESCE(su.used_g, 0), 1)                                      AS bought_g,
    ROUND(at.avg_remaining_g, 1)                                          AS avg_remaining_g,
    ROUND(COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0) * 100, 1)   AS allowance_pct,
    ROUND(COALESCE(su.used_g, 0), 1)                                      AS saleor_total_g,
    at.avg_allotted_g,
    CASE
      WHEN (at.allotted_g IS NULL OR at.allotted_g = 0) AND zc.supply_date IS NOT NULL THEN 'red'
      WHEN at.allotted_g IS NULL OR at.allotted_g = 0  THEN NULL
      WHEN GREATEST(at.allotted_g - COALESCE(su.used_g, 0), 0) / at.allotted_g < 0.25
           AND COALESCE(at.repeat_count, 0) >= 3 AND COALESCE(se.purchase_rate_pct, 100) >= 60 THEN 'purple'
      WHEN GREATEST(at.allotted_g - COALESCE(su.used_g, 0), 0) / at.allotted_g < 0.50 THEN 'green'
      WHEN GREATEST(at.allotted_g - COALESCE(su.used_g, 0), 0) / at.allotted_g < 0.75 THEN 'orange'
      ELSE 'red'
    END                                                                    AS allowance_group,
    se.total_visits, se.total_purchases, se.purchase_rate_pct,
    se.avg_visits_per_month, se.avg_days_between_visits, se.last_visit,
    CASE
      WHEN se.avg_visits_per_month >= 4   THEN 'frequent'
      WHEN se.avg_visits_per_month >= 1   THEN 'occasional'
      WHEN se.avg_visits_per_month IS NOT NULL THEN 'rare'
      ELSE NULL
    END AS visit_tier,
    CASE
      WHEN se.purchase_rate_pct >= 60 THEN 'high_converter'
      WHEN se.purchase_rate_pct >= 30 THEN 'moderate_converter'
      WHEN se.purchase_rate_pct IS NOT NULL THEN 'low_converter'
      ELSE NULL
    END AS conversion_tier,
    CASE
      WHEN COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0) >= 0.75
           AND se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60 THEN 'loyal_power_buyer'
      WHEN COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0) >= 0.75    THEN 'high_adherent'
      WHEN se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60
           AND (at.allotted_g IS NULL OR COALESCE(su.used_g, 0) / at.allotted_g < 0.75) THEN 'active_partial_buyer'
      WHEN se.avg_visits_per_month >= 2 AND se.purchase_rate_pct < 30    THEN 'window_shopper'
      WHEN se.avg_visits_per_month >= 1 AND se.purchase_rate_pct >= 30   THEN 'casual_buyer'
      WHEN (se.avg_visits_per_month < 1 OR se.avg_visits_per_month IS NULL)
           AND (at.allotted_g IS NULL OR COALESCE(su.used_g, 0) / at.allotted_g < 0.25) THEN 'at_risk'
      ELSE 'needs_review'
    END AS customer_pattern
  FROM zoho_contacts zc
  LEFT JOIN allowance_totals at ON at.email = zc.email
  LEFT JOIN saleor_used      su ON su.email = zc.email
  LEFT JOIN shop_engagement  se ON se.email = zc.email
  LEFT JOIN customers        c  ON c.email  = zc.email
  WHERE zc.email IS NOT NULL
  ORDER BY
    CASE
      WHEN COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0) >= 0.75
           AND se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60 THEN 1
      WHEN COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0) >= 0.75    THEN 2
      WHEN se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60   THEN 3
      WHEN se.avg_visits_per_month >= 1 AND se.purchase_rate_pct >= 30   THEN 4
      WHEN se.avg_visits_per_month >= 2 AND se.purchase_rate_pct < 30    THEN 5
      ELSE 6
    END,
    COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0) DESC NULLS LAST
`);
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  const routeKey = event.routeKey ?? "";
  const qs = event.queryStringParameters ?? {};

  try {
    // GET /health-data
    if (routeKey === "GET /health-data") {
      const rows = toRows(await db.execute(buildHealthQuery(qs.from, qs.to)));
      return ok({ rows, count: rows.length });
    }

    // GET /health-data/export
    if (routeKey === "GET /health-data/export") {
      const rows = toRows(await db.execute(buildHealthQuery(qs.from, qs.to)));
      const group = qs.group?.trim();
      const filtered = group === "noplan" ? rows.filter((r: Record<string, unknown>) => r.allowance_group == null) : rows;

      const cols: [string, string][] = [
        ["patient_name", "Patient Name"], ["email", "Email"], ["allowance_group", "Group"],
        ["allotted_g", "Allotted (g)"], ["bought_g", "Bought (g)"], ["avg_remaining_g", "Avg Rem (g)"],
        ["allowance_pct", "Allowance %"], ["repeat_count", "Orders"], ["total_visits", "Visits"],
        ["purchase_rate_pct", "Conv %"], ["avg_visits_per_month", "Vis/mo"],
        ["last_visit", "Last Visit"], ["signed_up", "Signed Up"],
        ["customer_pattern", "Pattern"], ["visit_tier", "Visit Tier"], ["conversion_tier", "Conv Tier"],
      ];
      const escape = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = cols.map(([, label]) => label).join(",");
      const body = (filtered as Record<string, unknown>[]).map((r) => cols.map(([key]) => escape(r[key])).join(",")).join("\n");
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

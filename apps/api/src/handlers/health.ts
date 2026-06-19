import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db } from "@analytics/db";
import { sql } from "drizzle-orm";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  tracker_latest AS (
    SELECT
      tpt.email,
      pick.interval_start,
      pick.strength,
      tpt.repeats::numeric AS repeats,
      pick.supply_total_active,
      pick.supply_used_interval_active,
      pick.remaining_repeats_active
    FROM db_treatment_plan_tracker tpt
    LEFT JOIN LATERAL (
      SELECT
        x.strength,
        x.interval_start,
        x.supply_total_active,
        x.supply_used_interval_active,
        x.remaining_repeats_active
      FROM (
        VALUES
          (
            22,
            NULLIF(tpt.supply_interval_start_22, '')::timestamptz,
            tpt.supply_total_22::numeric,
            tpt.supply_used_interval_22::numeric,
            tpt.repeats_remaining_22::numeric
          ),
          (
            26,
            NULLIF(tpt.supply_interval_start_26, '')::timestamptz,
            tpt.supply_total_26::numeric,
            tpt.supply_used_interval_26::numeric,
            tpt.repeats_remaining_26::numeric
          ),
          (
            29,
            NULLIF(tpt.supply_interval_start_29, '')::timestamptz,
            tpt.supply_total_29::numeric,
            tpt.supply_used_interval_29::numeric,
            tpt.repeats_remaining_29::numeric
          )
      ) AS x(strength, interval_start, supply_total_active, supply_used_interval_active, remaining_repeats_active)
      WHERE x.supply_total_active IS NOT NULL
         OR x.supply_used_interval_active IS NOT NULL
         OR x.remaining_repeats_active IS NOT NULL
      ORDER BY
        (x.interval_start IS NOT NULL) DESC,
        x.interval_start DESC NULLS LAST
      LIMIT 1
    ) AS pick ON true
  ),
  adherence_calc AS (
    SELECT
      tl.email,
      tl.strength,
      tl.interval_start,
      tl.repeats,
      tl.supply_total_active,
      tl.supply_used_interval_active,
      tl.remaining_repeats_active,
      (tl.supply_total_active / NULLIF(tl.repeats, 0)) AS grams_per_repeat,
      ((tl.repeats - COALESCE(tl.remaining_repeats_active, 0))
        * (tl.supply_total_active / NULLIF(tl.repeats, 0))) AS expected_used_g,
      (
        tl.supply_used_interval_active
        / NULLIF(
            ((tl.repeats - COALESCE(tl.remaining_repeats_active, 0))
              * (tl.supply_total_active / NULLIF(tl.repeats, 0))),
            0
          )
      ) AS adherence_ratio
    FROM tracker_latest tl
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
  ),
  last_order AS (
    SELECT
      email,
      MAX(COALESCE(order_date::date, source_created_at::date)) AS last_order_date
    FROM orders_dispatched
    WHERE email IS NOT NULL
    GROUP BY email
  )
  SELECT * FROM (
  SELECT
    c.name                                                                 AS patient_name,
    zc.email                                                               AS email,
    (c.created_at AT TIME ZONE 'Australia/Sydney')::date                  AS signed_up,
    at.repeat_count,
    COALESCE(ac.remaining_repeats_active, at.repeats_remaining::numeric) AS repeats_remaining,
    ROUND(at.allotted_g, 1)                                               AS allotted_g,
    ROUND(COALESCE(su.used_g, 0), 1)                                      AS bought_g,
    ROUND(at.avg_remaining_g, 1)                                          AS avg_remaining_g,
    ROUND(COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) * 100, 1) AS adherence_pct,
    ROUND(COALESCE(su.used_g, 0), 1)                                      AS saleor_total_g,
    at.avg_allotted_g,
    COALESCE(lo.last_order_date, se.last_visit)                            AS last_activity_date,
    (
      COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NOT NULL
      AND ROUND(COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) * 100, 1) < 25
    )                                                                      AS is_red_low_grams,
    (
      COALESCE(lo.last_order_date, se.last_visit) IS NULL
      OR COALESCE(lo.last_order_date, se.last_visit) < CURRENT_DATE - INTERVAL '90 days'
    )                                                                      AS is_red_no_purchase_90,
    (
      tpt.script_expiration_date IS NOT NULL
      AND tpt.script_expiration_date::date < CURRENT_DATE - INTERVAL '60 days'
    )                                                                      AS is_red_consultation_overdue_60,
    (
      COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NOT NULL
      AND ROUND(COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) * 100, 1) BETWEEN 25 AND 50
    )                                                                      AS is_orange_grams_25_50,
    (
      COALESCE(lo.last_order_date, se.last_visit) < CURRENT_DATE - INTERVAL '45 days'
      AND COALESCE(lo.last_order_date, se.last_visit) >= CURRENT_DATE - INTERVAL '90 days'
    )                                                                      AS is_orange_no_purchase_46_90,
    (
      tpt.needs_update = true
      OR (
        tpt.script_expiration_date IS NOT NULL
        AND tpt.script_expiration_date::date BETWEEN CURRENT_DATE - INTERVAL '60 days' AND CURRENT_DATE
      )
    )                                                                      AS is_orange_consultation_due,
    (
      COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NOT NULL
      AND ROUND(COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) * 100, 1) BETWEEN 75 AND 110
    )                                                                      AS is_purple_grams_75_110,
    (
      COALESCE(lo.last_order_date, se.last_visit) >= CURRENT_DATE - INTERVAL '30 days'
    )                                                                      AS is_purple_recent_purchase_30,
    (COALESCE(at.repeat_count, 0) >= 3)                                    AS is_purple_repeat_count_3,
    (
      (tpt.needs_update IS NULL OR tpt.needs_update = false)
      AND (tpt.script_expiration_date IS NULL OR tpt.script_expiration_date::date > CURRENT_DATE)
    )                                                                      AS is_purple_consultation_current,
    (
      COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NOT NULL
      AND ROUND(COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) * 100, 1) BETWEEN 50 AND 75
    )                                                                      AS is_green_grams_50_75,
    (
      COALESCE(lo.last_order_date, se.last_visit) >= CURRENT_DATE - INTERVAL '45 days'
    )                                                                      AS is_green_recent_purchase_45,
    (
      (tpt.needs_update IS NULL OR tpt.needs_update = false)
      AND (tpt.script_expiration_date IS NULL OR tpt.script_expiration_date::date > CURRENT_DATE)
    )                                                                      AS is_green_consultation_current,
    CASE
      -- No supply plan
      WHEN COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NULL
        AND zc.supply_date IS NOT NULL THEN 'red'
      WHEN COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NULL THEN NULL
       WHEN COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) >= 0.75
         AND COALESCE(at.repeat_count, 0) >= 3
         AND COALESCE(se.purchase_rate_pct, 100) >= 60 THEN 'purple'
       WHEN COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) >= 0.50 THEN 'green'
       WHEN COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) >= 0.25 THEN 'orange'
      ELSE 'red'
    END                                                                    AS adherence_group,
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
       WHEN COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) >= 0.75
           AND se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60 THEN 'loyal_power_buyer'
       WHEN COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) >= 0.75 THEN 'high_adherent'
      WHEN se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60
         AND (
           COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NULL
           OR COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) < 0.75
         ) THEN 'active_partial_buyer'
      WHEN se.avg_visits_per_month >= 2 AND se.purchase_rate_pct < 30    THEN 'window_shopper'
      WHEN se.avg_visits_per_month >= 1 AND se.purchase_rate_pct >= 30   THEN 'casual_buyer'
      WHEN (se.avg_visits_per_month < 1 OR se.avg_visits_per_month IS NULL)
         AND (
           COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) IS NULL
           OR COALESCE(ac.adherence_ratio, COALESCE(su.used_g, 0) / NULLIF(at.allotted_g, 0)) < 0.25
         ) THEN 'at_risk'
      ELSE 'needs_review'
    END AS customer_pattern,
    lo.last_order_date AS last_order_date
  FROM zoho_contacts zc
  LEFT JOIN allowance_totals at  ON at.email  = zc.email
  LEFT JOIN saleor_used      su  ON su.email  = zc.email
  LEFT JOIN shop_engagement  se  ON se.email  = zc.email
  LEFT JOIN customers        c   ON c.email   = zc.email
  LEFT JOIN adherence_calc   ac  ON ac.email  = zc.email
  LEFT JOIN last_order       lo  ON lo.email  = zc.email
  LEFT JOIN db_treatment_plan_tracker tpt ON tpt.email = zc.email
  WHERE zc.email IS NOT NULL
) _health
ORDER BY
  CASE adherence_group
    WHEN 'purple' THEN 1
    WHEN 'green'  THEN 2
    WHEN 'orange' THEN 3
    WHEN 'red'    THEN 4
    ELSE 5
  END,
  COALESCE(last_order_date, last_visit) DESC NULLS LAST
`);
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  const routeKey = event.routeKey ?? "";
  const qs = event.queryStringParameters ?? {};

  try {
    // GET /health-data
    if (routeKey === "GET /health-data") {
      const rows = toRows<RawHealthRow>(await db.execute(buildHealthQuery(qs.from, qs.to)));
      const enriched = enrichHealthRows(rows);
      return ok({ rows: enriched.rows, count: enriched.rows.length, criteriaCountsByGroup: enriched.criteriaCountsByGroup });
    }

    // GET /health-data/export
    if (routeKey === "GET /health-data/export") {
      const rows = toRows(await db.execute(buildHealthQuery(qs.from, qs.to)));
      const group = qs.group?.trim();
      const filtered = group === "noplan" ? rows.filter((r: Record<string, unknown>) => r.adherence_group == null) : rows;

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

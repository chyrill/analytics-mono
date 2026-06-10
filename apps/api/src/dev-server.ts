/**
 * Local development HTTP server — wraps Lambda handlers in an Express HTTP adapter.
 * Adapts Express requests → APIGatewayProxyEventV2 → Lambda response → HTTP.
 *
 * Usage:  pnpm --filter @analytics/api dev
 * Port:   3001 (configurable via API_PORT env var)
 *
 * Next.js (apps/web) proxies /api/* → localhost:3001 in dev.
 * Production routes through API Gateway → Lambda directly.
 */
import express, { type Request, type Response } from "express";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import type { ScheduledEvent } from "aws-lambda";
import { handler as customersHandler } from "./handlers/customers";
import { handler as ingestHandler } from "./handlers/ingest";
import { handler as saleorHandler } from "../../sync/src/handlers/saleor";
import { handler as docAppHandler } from "../../sync/src/handlers/doc-app";
import { runZohoSync } from "../../sync/src/handlers/zoho";
import { runDocAppSync } from "../../sync/src/handlers/doc-app";
import { db, customers, zohoContacts, zohoDeals, syncJobs, syncCheckpoints } from "@analytics/db";
import { sql, desc, eq, and } from "drizzle-orm";
import postgres from "postgres";

// Drizzle with postgres-js returns RowList which extends Array directly — no .rows
const toRows = <T = Record<string, unknown>>(r: unknown): T[] => Array.from(r as Iterable<T>);

const app = express();
app.use(express.json());
app.use(express.text());

// Allow the Next.js dev server (and any localhost origin) to call the API
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

// ── Adapter: Express Request → APIGatewayProxyEventV2 ────────────────────────
function toApiGwEvent(req: Request): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${req.method} ${req.path}`,
    rawPath: req.path,
    rawQueryString: new URLSearchParams(
      req.query as Record<string, string>,
    ).toString(),
    headers: req.headers as Record<string, string>,
    queryStringParameters:
      Object.keys(req.query).length > 0
        ? (req.query as Record<string, string>)
        : undefined,
    body: req.body ? JSON.stringify(req.body) : undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: "local",
      apiId: "local",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method: req.method,
        path: req.path,
        protocol: "HTTP/1.1",
        sourceIp: req.ip ?? "127.0.0.1",
        userAgent: req.headers["user-agent"] ?? "",
      },
      requestId: `local-${Date.now()}`,
      routeKey: `${req.method} ${req.path}`,
      stage: "$default",
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
  } as APIGatewayProxyEventV2;
}

// ── Adapter: Lambda result → Express Response ────────────────────────────────
type Handler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyStructuredResultV2>;

async function invoke(handler: Handler, req: Request, res: Response) {
  const result = await handler(toApiGwEvent(req));
  Object.entries(result.headers ?? {}).forEach(([k, v]) =>
    res.setHeader(k, String(v)),
  );
  res.status(result.statusCode ?? 200).send(result.body ?? "");
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/customers", (req, res) => invoke(customersHandler, req, res));
app.post("/ingest", (req, res) => invoke(ingestHandler, req, res));
app.options("/ingest", (req, res) => invoke(ingestHandler, req, res));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date() }));

const fakeEvent = {} as ScheduledEvent;
const noop = () => { };

// ── Sync helpers ──────────────────────────────────────────────────────────────

async function checkInProgress(source: string) {
  const rows = await db.select().from(syncJobs)
    .where(and(eq(syncJobs.source, source), eq(syncJobs.status, "running")))
    .limit(1);
  return rows[0] ?? null;
}

// ── POST /sync/zoho ───────────────────────────────────────────────────────────

app.post("/sync/zoho", async (_req, res) => {
  const inProgress = await checkInProgress("zoho");
  if (inProgress) {
    res.status(409).json({ error: "sync_in_progress", job_id: inProgress.id, started_at: inProgress.startedAt });
    return;
  }

  const contactsCheckpoint = await db.select().from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.source, "zoho"), eq(syncCheckpoints.entity, "contacts")))
    .limit(1);
  const jobType = contactsCheckpoint.length > 0 ? "incremental" : "full";

  const [job] = await db.insert(syncJobs).values({
    source: "zoho",
    mode: jobType,
    entities: ["contacts", "deals", "calls", "tasks", "events"],
    status: "running",
    startedAt: new Date(),
  }).returning();

  res.status(202).json({ job_id: job.id, source: "zoho", job_type: jobType, status: "started" });

  runZohoSync(job.id)
    .then(({ fetched, upserted }) =>
      db.update(syncJobs).set({ status: "completed", recordsFetched: fetched, recordsUpserted: upserted, completedAt: new Date() })
        .where(eq(syncJobs.id, job.id)),
    )
    .catch((err: Error) =>
      db.update(syncJobs).set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
        .where(eq(syncJobs.id, job.id)),
    );
});

// ── POST /sync/saleor ─────────────────────────────────────────────────────────

app.post("/sync/saleor", async (_req, res) => {
  const inProgress = await checkInProgress("saleor");
  if (inProgress) {
    res.status(409).json({ error: "sync_in_progress", job_id: inProgress.id, started_at: inProgress.startedAt });
    return;
  }

  const [job] = await db.insert(syncJobs).values({
    source: "saleor", mode: "full", entities: ["customers", "orders"],
    status: "running", startedAt: new Date(),
  }).returning();

  res.status(202).json({ job_id: job.id, source: "saleor", job_type: "full", status: "started" });

  Promise.allSettled([
    saleorHandler(fakeEvent, {} as never, noop),
    docAppHandler(fakeEvent, {} as never, noop),
  ]).then(async (results) => {
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      const msg = failed.status === "rejected" ? String((failed as PromiseRejectedResult).reason) : "";
      await db.update(syncJobs).set({ status: "failed", errorMessage: msg, completedAt: new Date() })
        .where(eq(syncJobs.id, job.id));
      return;
    }
    await db.update(syncJobs).set({ status: "completed", completedAt: new Date() })
      .where(eq(syncJobs.id, job.id));
  });
});

// ── POST /sync/db ─────────────────────────────────────────────────────────────

app.post("/sync/db", async (_req, res) => {
  const inProgress = await checkInProgress("db");
  if (inProgress) {
    res.status(409).json({ error: "sync_in_progress", job_id: inProgress.id, started_at: inProgress.startedAt });
    return;
  }

  const [job] = await db.insert(syncJobs).values({
    source: "db", mode: "full", status: "running", startedAt: new Date(),
  }).returning();

  res.status(202).json({ job_id: job.id, source: "db", job_type: "full", status: "started" });

  db.execute(sql`
    UPDATE customers
    SET reconciliation_status = CASE
      WHEN (
        (CASE WHEN saleor_customer_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN doc_app_patient_id  IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN zoho_contact_id     IS NOT NULL THEN 1 ELSE 0 END)
      ) >= 2 THEN 'matched'
      ELSE 'gap'
    END,
    updated_at = now()
  `)
    .then(() => runDocAppSync(job.id))
    .then(({ fetched, upserted }) =>
      db.update(syncJobs).set({
        status: "completed",
        recordsFetched: fetched,
        recordsUpserted: upserted,
        completedAt: new Date(),
      }).where(eq(syncJobs.id, job.id)),
    )
    .catch((err: Error) =>
      db.update(syncJobs).set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
        .where(eq(syncJobs.id, job.id)),
    );
});

// ── POST /sync/docapp ─────────────────────────────────────────────────────────

app.post("/sync/docapp", async (_req, res) => {
  const inProgress = await checkInProgress("docapp");
  if (inProgress) {
    res.status(409).json({ error: "sync_in_progress", job_id: inProgress.id, started_at: inProgress.startedAt });
    return;
  }

  const patientsCheckpoint = await db.select().from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.source, "docapp"), eq(syncCheckpoints.entity, "patients")))
    .limit(1);
  const jobType = patientsCheckpoint.length > 0 ? "incremental" : "full";

  const [job] = await db.insert(syncJobs).values({
    source: "docapp",
    mode: jobType,
    entities: ["patients", "treatment_plans"],
    status: "running",
    startedAt: new Date(),
  }).returning();

  res.status(202).json({ job_id: job.id, source: "docapp", job_type: jobType, status: "started" });

  runDocAppSync(job.id)
    .then(({ fetched, upserted }) =>
      db.update(syncJobs).set({ status: "completed", recordsFetched: fetched, recordsUpserted: upserted, completedAt: new Date() })
        .where(eq(syncJobs.id, job.id)),
    )
    .catch((err: Error) =>
      db.update(syncJobs).set({ status: "failed", errorMessage: err.message, completedAt: new Date() })
        .where(eq(syncJobs.id, job.id)),
    );
});

// ── GET /sync/jobs/:id ────────────────────────────────────────────────────────

app.get("/sync/jobs/:id", async (req, res) => {
  const rows = await db.select().from(syncJobs).where(eq(syncJobs.id, req.params.id)).limit(1);
  if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
  res.json(rows[0]);
});

// ── GET /sync/checkpoints ─────────────────────────────────────────────────────

app.get("/sync/checkpoints", async (req, res) => {
  const source = req.query.source as string | undefined;
  const rows = source
    ? await db.select().from(syncCheckpoints).where(eq(syncCheckpoints.source, source))
    : await db.select().from(syncCheckpoints);
  res.json(rows);
});



// ── Customer Health Index ─────────────────────────────────────────────────────
// Queries the analytics DB directly — no dependency on customer-index service.
// Replicates the enrichment logic from customer-index: Saleor order grams take
// precedence when they exceed what doc-app supply tracking recorded.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildHealthQuery(from?: string, to?: string) {
  const safeFrom = from && DATE_RE.test(from) ? from : null;
  const safeTo = to && DATE_RE.test(to) ? to : null;

  const saleorFilter = safeFrom
    ? `\n    AND ordered_at >= '${safeFrom}'${safeTo ? ` AND ordered_at < '${safeTo}'` : ''}`
    : '';
  const cartFilter = safeFrom
    ? `\n    AND source_created_at >= '${safeFrom}'${safeTo ? ` AND source_created_at < '${safeTo}'` : ''}`
    : '';

  return sql.raw(`
  WITH
  -- Latest treatment plan per email — allotted grams is the sum of all THC-variant quantities.
  treatment_plan_totals AS (
    SELECT DISTINCT ON (email)
      email,
      COALESCE(total_quantity_22::numeric, 0)
        + COALESCE(total_quantity_26::numeric, 0)
        + COALESCE(total_quantity_29::numeric, 0)                        AS plan_allotted_g
    FROM db_treatment_plans
    WHERE email IS NOT NULL
      AND (total_quantity_22 IS NOT NULL
        OR total_quantity_26 IS NOT NULL
        OR total_quantity_29 IS NOT NULL)
    ORDER BY email, source_created_at DESC
  ),
  -- Saleor orders = consumed grams (filtered by date range when provided).
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
    su.order_count                                                         AS repeat_count,
    NULL::int                                                              AS repeats_remaining,
    ROUND(tp.plan_allotted_g, 1)                                          AS allotted_g,
    ROUND(COALESCE(su.used_g, 0), 1)                                      AS bought_g,
    ROUND(GREATEST(tp.plan_allotted_g - COALESCE(su.used_g, 0), 0), 1)   AS avg_remaining_g,
    ROUND(COALESCE(su.used_g, 0) / NULLIF(tp.plan_allotted_g, 0) * 100, 1) AS allowance_pct,
    ROUND(COALESCE(su.used_g, 0), 1)                                      AS saleor_total_g,
    tp.plan_allotted_g                                                     AS avg_allotted_g,
    CASE
      WHEN tp.plan_allotted_g IS NULL OR tp.plan_allotted_g = 0           THEN 'red'
      WHEN GREATEST(tp.plan_allotted_g - COALESCE(su.used_g, 0), 0)
             / tp.plan_allotted_g < 0.25
           AND COALESCE(su.order_count, 0)         >= 3
           AND COALESCE(se.purchase_rate_pct, 100) >= 60                  THEN 'purple'
      WHEN GREATEST(tp.plan_allotted_g - COALESCE(su.used_g, 0), 0)
             / tp.plan_allotted_g < 0.50                                  THEN 'green'
      WHEN GREATEST(tp.plan_allotted_g - COALESCE(su.used_g, 0), 0)
             / tp.plan_allotted_g < 0.75                                  THEN 'orange'
      ELSE 'red'
    END                                                                    AS allowance_group,
    se.total_visits,
    se.total_purchases,
    se.purchase_rate_pct,
    se.avg_visits_per_month,
    se.avg_days_between_visits,
    se.last_visit,
    CASE
      WHEN se.avg_visits_per_month >= 4   THEN 'frequent'
      WHEN se.avg_visits_per_month >= 1   THEN 'occasional'
      WHEN se.avg_visits_per_month IS NOT NULL THEN 'rare'
      ELSE NULL
    END                                                                    AS visit_tier,
    CASE
      WHEN se.purchase_rate_pct >= 60 THEN 'high_converter'
      WHEN se.purchase_rate_pct >= 30 THEN 'moderate_converter'
      WHEN se.purchase_rate_pct IS NOT NULL THEN 'low_converter'
      ELSE NULL
    END                                                                    AS conversion_tier,
    CASE
      WHEN COALESCE(su.used_g, 0) / NULLIF(tp.plan_allotted_g, 0) >= 0.75
           AND se.avg_visits_per_month >= 4
           AND se.purchase_rate_pct    >= 60                              THEN 'loyal_power_buyer'
      WHEN COALESCE(su.used_g, 0) / NULLIF(tp.plan_allotted_g, 0) >= 0.75 THEN 'high_adherent'
      WHEN se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60
           AND (tp.plan_allotted_g IS NULL
             OR COALESCE(su.used_g, 0) / tp.plan_allotted_g < 0.75)      THEN 'active_partial_buyer'
      WHEN se.avg_visits_per_month >= 2 AND se.purchase_rate_pct < 30    THEN 'window_shopper'
      WHEN se.avg_visits_per_month >= 1 AND se.purchase_rate_pct >= 30   THEN 'casual_buyer'
      WHEN (se.avg_visits_per_month < 1 OR se.avg_visits_per_month IS NULL)
           AND (tp.plan_allotted_g IS NULL
             OR COALESCE(su.used_g, 0) / tp.plan_allotted_g < 0.25)      THEN 'at_risk'
      ELSE 'needs_review'
    END                                                                    AS customer_pattern
  FROM zoho_contacts                                                        zc
  LEFT JOIN treatment_plan_totals   tp  ON  tp.email       = zc.email
  LEFT JOIN saleor_used             su  ON  su.email       = zc.email
  LEFT JOIN shop_engagement         se  ON  se.email       = zc.email
  LEFT JOIN customers               c   ON  c.email        = zc.email
  WHERE zc.email IS NOT NULL
    AND zc.email NOT LIKE '%@harvest.au'
    AND zc.email NOT LIKE '%@harvest.delivery'
    AND zc.email NOT LIKE '%@harvest.net.au'
    AND zc.email NOT LIKE '%.demot@%'
    AND zc.email NOT LIKE '%@test.com'
    AND zc.email NOT LIKE '%@dev.co'
    AND zc.email NOT IN (
      'mailer-daemon@googlemail.com',
      'noreply-dmarc-support@google.com',
      'zohoflowfailed@outlook.com'
    )
  ORDER BY
    CASE
      WHEN COALESCE(su.used_g, 0) / NULLIF(tp.plan_allotted_g, 0) >= 0.75
           AND se.avg_visits_per_month >= 4
           AND se.purchase_rate_pct    >= 60                              THEN 1
      WHEN COALESCE(su.used_g, 0) / NULLIF(tp.plan_allotted_g, 0) >= 0.75 THEN 2
      WHEN se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60   THEN 3
      WHEN se.avg_visits_per_month >= 1 AND se.purchase_rate_pct >= 30   THEN 4
      WHEN se.avg_visits_per_month >= 2 AND se.purchase_rate_pct < 30    THEN 5
      ELSE 6
    END,
    COALESCE(su.used_g, 0) / NULLIF(tp.plan_allotted_g, 0) DESC NULLS LAST
`);
}
// Saleor is now the direct usage source in buildHealthQuery — no post-processing needed.
function enrichWithSaleor(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows;
}

app.get("/health-data", async (req, res) => {
  const from = (req.query.from as string | undefined)?.trim();
  const to = (req.query.to as string | undefined)?.trim();
  try {
    const rows = enrichWithSaleor(toRows(await db.execute(buildHealthQuery(from, to))));
    res.json({ rows, count: rows.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.get("/health-data/export", async (req, res) => {
  const from = (req.query.from as string | undefined)?.trim();
  const to = (req.query.to as string | undefined)?.trim();
  const group = (req.query.group as string | undefined)?.trim(); // e.g. "noplan"
  try {
    const rows = enrichWithSaleor(toRows(await db.execute(buildHealthQuery(from, to))));
    const filtered = group === "noplan"
      ? rows.filter((r) => r.allowance_group == null)
      : rows;

    const cols: [string, string][] = [
      ["patient_name", "Patient Name"],
      ["email", "Email"],
      ["allowance_group", "Group"],
      ["allotted_g", "Allotted (g)"],
      ["bought_g", "Bought (g)"],
      ["avg_remaining_g", "Avg Rem (g)"],
      ["allowance_pct", "Allowance %"],
      ["repeat_count", "Orders"],
      ["total_visits", "Visits"],
      ["purchase_rate_pct", "Conv %"],
      ["avg_visits_per_month", "Vis/mo"],
      ["last_visit", "Last Visit"],
      ["signed_up", "Signed Up"],
      ["customer_pattern", "Pattern"],
      ["visit_tier", "Visit Tier"],
      ["conversion_tier", "Conv Tier"],
    ];

    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = cols.map(([, label]) => label).join(",");
    const body = filtered.map((r) =>
      cols.map(([key]) => escape(r[key])).join(","),
    ).join("\n");

    const filename = group === "noplan" ? "no-plan-contacts.csv" : "health-contacts.csv";
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`${header}\n${body}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.get("/health-detail", async (req, res) => {
  const email = ((req.query.email as string) ?? "").toLowerCase().trim();
  if (!email) { res.status(400).json({ error: "email required" }); return; }

  try {
    const [visitsByMonth, latestPlan, spendByMonth, gramsPerOrder, saleorGrams] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', source_created_at AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
          DATE_TRUNC('month', source_created_at AT TIME ZONE 'Australia/Sydney')                      AS month_ts,
          COUNT(*)::int                                              AS visits,
          COUNT(*) FILTER (WHERE is_converted = true)::int          AS purchases
        FROM cart_sessions
        WHERE email = '${email.replace(/'/g, "''")}' AND is_deleted = false
        GROUP BY 2 ORDER BY 2
      `)),
      db.execute(sql.raw(`
        SELECT supply_interval_total::numeric AS allotted_g
        FROM supply_tracking
        WHERE email = '${email.replace(/'/g, "''")}' AND supply_interval_total::numeric > 0
        ORDER BY source_created_at DESC LIMIT 1
      `)),
      db.execute(sql.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', COALESCE(order_date::timestamp, source_created_at) AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
          DATE_TRUNC('month', COALESCE(order_date::timestamp, source_created_at) AT TIME ZONE 'Australia/Sydney')                      AS month_ts,
          ROUND(SUM(order_total::numeric), 2) AS total_spent,
          COUNT(*)::int                       AS order_count
        FROM orders_dispatched
        WHERE email = '${email.replace(/'/g, "''")}' AND order_total IS NOT NULL
        GROUP BY 2 ORDER BY 2
      `)),
      db.execute(sql.raw(`
        SELECT
          COALESCE(order_date, source_created_at::date)::text                AS label,
          COALESCE(order_date, source_created_at::date)                      AS order_date,
          ROUND((
            COALESCE(weight_22::numeric, 0) +
            COALESCE(weight_26::numeric, 0) +
            COALESCE(weight_29::numeric, 0)
          ), 1)                                                               AS grams
        FROM orders_dispatched
        WHERE email = '${email.replace(/'/g, "''")}' AND (
          COALESCE(weight_22::numeric, 0) + COALESCE(weight_26::numeric, 0) + COALESCE(weight_29::numeric, 0)
        ) > 0
        ORDER BY order_date
      `)),
      db.execute(sql.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', ordered_at AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
          DATE_TRUNC('month', ordered_at AT TIME ZONE 'Australia/Sydney')                      AS month_ts,
          ROUND(SUM(total_grams::numeric), 1) AS used_g
        FROM saleor_orders
        WHERE email = '${email.replace(/'/g, "''")}' 
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

    res.json({
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

app.get("/shop-analytics", async (_req, res) => {
  try {
    const [revenue, visits, lapsed, neverBought, activeBuyers, newBuyers, saleorGrams] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', COALESCE(order_date::timestamp, source_created_at) AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
          DATE_TRUNC('month', COALESCE(order_date::timestamp, source_created_at) AT TIME ZONE 'Australia/Sydney')                      AS month_ts,
          ROUND(SUM(order_total::numeric), 2)  AS revenue,
          COUNT(*)::int                        AS orders,
          ROUND(AVG(order_total::numeric), 2)  AS avg_order_value,
          ROUND(SUM(COALESCE(weight_22::numeric,0)+COALESCE(weight_26::numeric,0)+COALESCE(weight_29::numeric,0)), 1) AS grams_dispatched
        FROM orders_dispatched
        WHERE COALESCE(order_date::timestamp, source_created_at) >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Australia/Sydney') - INTERVAL '6 months'
          AND order_total IS NOT NULL
        GROUP BY 2 ORDER BY 2
      `)),
      db.execute(sql.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', source_created_at AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
          DATE_TRUNC('month', source_created_at AT TIME ZONE 'Australia/Sydney')                      AS month_ts,
          COUNT(*)::int                                                                                AS visits,
          COUNT(*) FILTER (WHERE is_converted = true)::int                                            AS purchases,
          ROUND(100.0 * COUNT(*) FILTER (WHERE is_converted = true) / NULLIF(COUNT(*), 0), 1)         AS conversion_rate
        FROM cart_sessions
        WHERE is_deleted = false
          AND source_created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Australia/Sydney') - INTERVAL '6 months'
        GROUP BY 2 ORDER BY 2
      `)),
      db.execute(sql.raw(`
        SELECT u.email,
          MAX(u.supply_interval_total::numeric) AS plan_g,
          MAX(o.order_date)::text               AS last_order,
          EXTRACT(DAY FROM NOW() - MAX(o.order_date::timestamptz))::int AS days_since_order
        FROM (
          SELECT DISTINCT email, supply_interval_total
          FROM supply_tracking WHERE supply_interval_total::numeric > 0
        ) u
        LEFT JOIN orders_dispatched o ON o.email = u.email
        GROUP BY u.email
        HAVING (MAX(o.order_date) IS NULL OR MAX(o.order_date) < NOW() - INTERVAL '60 days')
        ORDER BY days_since_order DESC NULLS LAST
        LIMIT 200
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(DISTINCT u.email)::int AS count
        FROM (SELECT DISTINCT email FROM supply_tracking WHERE supply_interval_total::numeric > 0) u
        WHERE u.email NOT IN (SELECT DISTINCT email FROM orders_dispatched)
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(DISTINCT email)::int AS count
        FROM orders_dispatched
        WHERE COALESCE(order_date::timestamp, source_created_at) >= NOW() - INTERVAL '30 days'
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*)::int AS count FROM (
          SELECT email FROM orders_dispatched
          GROUP BY email
          HAVING MIN(COALESCE(order_date::timestamp, source_created_at)) >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Australia/Sydney')
        ) x
      `)),
      db.execute(sql.raw(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', ordered_at AT TIME ZONE 'Australia/Sydney'), 'Mon ''YY') AS month,
          ROUND(SUM(total_grams::numeric)) AS grams
        FROM saleor_orders
        WHERE ordered_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'Australia/Sydney') - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', ordered_at AT TIME ZONE 'Australia/Sydney')
        ORDER BY DATE_TRUNC('month', ordered_at AT TIME ZONE 'Australia/Sydney')
      `)),
    ]);

    type RevRow = { month: string; revenue: string; orders: number; avg_order_value: string; grams_dispatched: string };
    type VisRow = { month: string; visits: number; purchases: number; conversion_rate: string };
    const revRows = toRows<RevRow>(revenue);
    const visRows = toRows<VisRow>(visits);
    const thisMonth = revRows[revRows.length - 1] ?? {};
    const prevMonth = revRows[revRows.length - 2] ?? {};
    const thisVisit = visRows[visRows.length - 1] ?? {};
    const prevVisit = visRows[visRows.length - 2] ?? {};

    const thisRev = parseFloat(String((thisMonth as RevRow).revenue ?? 0));
    const prevRev = parseFloat(String((prevMonth as RevRow).revenue ?? 0));
    const thisConv = parseFloat(String((thisVisit as VisRow).conversion_rate ?? 0));
    const prevConv = parseFloat(String((prevVisit as VisRow).conversion_rate ?? 0));
    const lapsedRows = toRows(lapsed);
    const lapsedCount = lapsedRows.length;
    const neverCount = (toRows<{ count: number }>(neverBought)[0]?.count) ?? 0;

    const insights: { type: string; text: string }[] = [];
    if (prevRev > 0 && thisRev > prevRev * 1.1) insights.push({ type: "positive", text: `Revenue up ${Math.round((thisRev - prevRev) / prevRev * 100)}% vs last month` });
    if (prevRev > 0 && thisRev < prevRev * 0.9) insights.push({ type: "warning", text: `Revenue down ${Math.round((prevRev - thisRev) / prevRev * 100)}% vs last month` });
    if (thisConv > prevConv + 5) insights.push({ type: "positive", text: `Conversion rate improved ${(thisConv - prevConv).toFixed(1)}pp this month` });
    if (thisConv < prevConv - 5) insights.push({ type: "alert", text: `Conversion rate dropped ${(prevConv - thisConv).toFixed(1)}pp this month` });
    if (lapsedCount > 20) insights.push({ type: "alert", text: `${lapsedCount} patients lapsed (no order in 60+ days)` });
    if (neverCount > 0) insights.push({ type: "neutral", text: `${neverCount} patients have a treatment plan but have never ordered` });

    res.json({
      kpis: {
        revenue_this_month: thisRev.toFixed(2),
        revenue_prev_month: prevRev.toFixed(2),
        revenue_change_pct: prevRev > 0 ? Math.round((thisRev - prevRev) / prevRev * 100) : null,
        conversion_this: thisConv,
        conversion_prev: prevConv,
        conversion_change_pp: prevConv > 0 ? Math.round(thisConv - prevConv) : null,
        active_buyers_30d: (toRows<{ count: number }>(activeBuyers)[0]?.count) ?? 0,
        new_buyers_this_month: (toRows<{ count: number }>(newBuyers)[0]?.count) ?? 0,
        lapsed_60d: lapsedCount,
        never_purchased: neverCount,
        avg_order_value: (thisMonth as RevRow).avg_order_value ?? "0",
        avg_order_value_prev: (prevMonth as RevRow).avg_order_value ?? "0",
        orders_this_month: (thisMonth as RevRow).orders ?? 0,
      },
      revenueByMonth: revRows,
      conversionByMonth: visRows,
      saleorGramsByMonth: toRows(saleorGrams),
      lapsedPatients: lapsedRows,
      insights,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// Full patient registry — all rows from analytics customers table (no cap)
app.get("/all-patients", async (_req, res) => {
  try {
    const rows = await db.select({
      id: customers.id,
      email: customers.email,
      name: customers.name,
      docAppPatientId: customers.docAppPatientId,
      saleorCustomerId: customers.saleorCustomerId,
      zohoContactId: customers.zohoContactId,
      reconciliationStatus: customers.reconciliationStatus,
      createdAt: customers.createdAt,
    })
      .from(customers)
      .orderBy(desc(customers.createdAt));

    const out = rows.map((r) => ({
      ...r,
      has_docapp: r.docAppPatientId != null,
      has_saleor: r.saleorCustomerId != null,
      has_zoho: r.zohoContactId != null,
      doc_app_patient_id: r.docAppPatientId,
      saleor_customer_id: r.saleorCustomerId,
      zoho_contact_id: r.zohoContactId,
      created_at: r.createdAt,
    }));

    res.json({ rows: out, total: out.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ── Funnel Analytics — live from doc-app RDS ──────────────────────────────────
app.get("/funnel-analytics", async (req, res) => {
  const docUrl = process.env.DOCAPP_DATABASE_URL;
  if (!docUrl) { res.status(500).json({ error: "DOCAPP_DATABASE_URL not set" }); return; }

  // period query param controls date range for ALL queries
  // Valid values: all | this_week | last_week | last_30d | last_90d
  const period = (req.query.period as string) || "all";
  type PeriodBounds = [string, string]; // [gte, lt)
  const PERIOD_BOUNDS: Record<string, PeriodBounds | null> = {
    all: null,
    this_week: ["DATE_TRUNC('week', CURRENT_DATE)", "DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '7 days'"],
    last_week: ["DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'", "DATE_TRUNC('week', CURRENT_DATE)"],
    last_30d: ["CURRENT_DATE - INTERVAL '29 days'", "CURRENT_DATE + INTERVAL '1 day'"],
    last_90d: ["CURRENT_DATE - INTERVAL '89 days'", "CURRENT_DATE + INTERVAL '1 day'"],
  };
  // df(col) → "AND col >= X AND col < Y" for the active period, empty when all
  const df = (col: string): string => {
    const b = PERIOD_BOUNDS[period];
    return b ? `AND ${col} >= ${b[0]} AND ${col} < ${b[1]}` : "";
  };
  const bookingDateFilter = (() => {
    const b = PERIOD_BOUNDS[period];
    return b ? `AND r.date::date >= ${b[0]} AND r.date::date < ${b[1]}` : "";
  })();

  const sql = postgres(docUrl, { ssl: "require", max: 3 });
  try {
    const [
      pipeline,
      consultOutcomes,
      tpOutcomes,
      appStatus,
      topSymptoms,
      noShowSymptoms,
      ageGroups,
      genders,
      states,
      bookingSourceStats,
      adminBookers,
    ] = await Promise.all([
      // ── 1. Overall funnel pipeline ─────────────────────────────────────
      // All booking/consult/TP stats join back to the patient cohort so the funnel
      // never exceeds the registered count regardless of period selected.
      sql.unsafe(`
        SELECT
          (SELECT COUNT(*)::int FROM patient WHERE 1=1 ${df('"createdAt"')})                                                                                  AS total_patients,
          (SELECT COUNT(DISTINCT c."patientID")::int FROM consultation c JOIN patient p ON p."patientID" = c."patientID" WHERE 1=1 ${df('p."createdAt"')})    AS booked_consult,
          (SELECT COUNT(DISTINCT c."patientID")::int FROM consultation c JOIN patient p ON p."patientID" = c."patientID" WHERE c."queueTag"='showed-up'  ${df('p."createdAt"')}) AS showed_up,
          (SELECT COUNT(DISTINCT c."patientID")::int FROM consultation c JOIN patient p ON p."patientID" = c."patientID" WHERE c."queueTag"='no-show'    ${df('p."createdAt"')}) AS no_show,
          (SELECT COUNT(DISTINCT c."patientID")::int FROM consultation c JOIN patient p ON p."patientID" = c."patientID" WHERE c."queueTag" LIKE 'pre-%' ${df('p."createdAt"')}) AS pre_consult,
          (SELECT COUNT(DISTINCT tp."patientID")::int FROM treatmentplan tp JOIN patient p ON p."patientID" = tp."patientID" WHERE 1=1 ${df('p."createdAt"')}) AS has_tp,
          (SELECT COUNT(*)::int FROM patient WHERE "applicationStatus"='approved' ${df('"createdAt"')})                                                        AS app_approved,
          (SELECT COUNT(*)::int FROM patient WHERE "applicationStatus"='rejected' ${df('"createdAt"')})                                                        AS app_rejected,
          (SELECT COUNT(*)::int FROM patient WHERE "applicationStatus"='pending'  ${df('"createdAt"')})                                                        AS app_pending,
          (SELECT COUNT(*)::int FROM admission WHERE admitted=true                ${df('"createdAt"')})                                                        AS admitted
      `),
      // ── 2. Consultation queue breakdown ───────────────────────────────
      sql.unsafe(`
        SELECT c."queueTag" AS tag, COUNT(*)::int AS cnt
        FROM consultation c JOIN patient p ON p."patientID" = c."patientID"
        WHERE c."queueTag" IS NOT NULL ${df('p."createdAt"')}
        GROUP BY c."queueTag" ORDER BY cnt DESC
      `),
      // ── 3. Treatment plan outcomes ────────────────────────────────────
      sql.unsafe(`
        SELECT tp.outcome, COUNT(*)::int AS cnt
        FROM treatmentplan tp JOIN patient p ON p."patientID" = tp."patientID"
        WHERE tp.outcome IS NOT NULL ${df('p."createdAt"')}
        GROUP BY tp.outcome ORDER BY cnt DESC
      `),
      // ── 4. Application status ─────────────────────────────────────────
      sql.unsafe(`
        SELECT COALESCE("applicationStatus",'no status') AS status, COUNT(*)::int AS cnt
        FROM patient WHERE 1=1 ${df('"createdAt"')} GROUP BY "applicationStatus" ORDER BY cnt DESC
      `),
      // ── 5. Top symptoms (all patients) — normalised ───────────────────
      sql.unsafe(`
        SELECT INITCAP(TRIM(q.answers)) AS symptom, COUNT(*)::int AS cnt
        FROM questionnaire q JOIN patient p ON p."patientID" = q."patientID"
        WHERE (q.question ILIKE '%condition or symptom%' OR q.question ILIKE '%What_condition_or_symptom%')
          AND q.answers IS NOT NULL AND TRIM(q.answers) != ''
          ${df('p."createdAt"')}
        GROUP BY INITCAP(TRIM(q.answers))
        ORDER BY cnt DESC LIMIT 25
      `),
      // ── 6. Top symptoms for no-shows ─────────────────────────────────
      sql.unsafe(`
        SELECT INITCAP(TRIM(q.answers)) AS symptom, COUNT(*)::int AS cnt
        FROM questionnaire q JOIN patient p ON p."patientID" = q."patientID"
        WHERE (q.question ILIKE '%condition or symptom%' OR q.question ILIKE '%What_condition_or_symptom%')
          AND q.answers IS NOT NULL AND TRIM(q.answers) != ''
          ${df('p."createdAt"')}
          AND EXISTS (
            SELECT 1 FROM consultation c
            WHERE c."patientID" = q."patientID" AND c."queueTag" = 'no-show'
          )
        GROUP BY INITCAP(TRIM(q.answers))
        ORDER BY cnt DESC LIMIT 20
      `),
      // ── 7. Age groups (handle mixed DOB formats) ──────────────────────
      sql.unsafe(`
        WITH parsed AS (
          SELECT
            p."patientID",
            p.email,
            CASE
              WHEN dob ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'        THEN dob::date
              WHEN dob ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$'        THEN TO_DATE(dob, 'DD/MM/YYYY')
              WHEN dob ~ '^(0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-[0-9]{4}$'        THEN TO_DATE(dob, 'DD-MM-YYYY')
              ELSE NULL
            END AS birth_date
          FROM patient p WHERE p.dob IS NOT NULL AND TRIM(p.dob) != '' ${df('p."createdAt"')}
        ),
        with_outcome AS (
          SELECT
            pr."patientID",
            pr.birth_date,
            BOOL_OR(c."queueTag" = 'showed-up') AS showed,
            BOOL_OR(c."queueTag" = 'no-show')   AS noshowed
          FROM parsed pr
          LEFT JOIN consultation c ON c.email = pr.email
          WHERE pr.birth_date IS NOT NULL
          GROUP BY pr."patientID", pr.birth_date
        ),
        bucketed AS (
          SELECT
            CASE
              WHEN EXTRACT(YEAR FROM AGE(birth_date)) < 18                          THEN 'Under 18'
              WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 18 AND 24             THEN '18-24'
              WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 25 AND 34             THEN '25-34'
              WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 35 AND 44             THEN '35-44'
              WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 45 AND 54             THEN '45-54'
              WHEN EXTRACT(YEAR FROM AGE(birth_date)) BETWEEN 55 AND 64             THEN '55-64'
              WHEN EXTRACT(YEAR FROM AGE(birth_date)) >= 65                         THEN '65+'
              ELSE 'Unknown'
            END AS age_group,
            showed,
            noshowed
          FROM with_outcome
        )
        SELECT
          age_group,
          COUNT(*)::int                                            AS cnt,
          COUNT(CASE WHEN showed    THEN 1 END)::int               AS showed_up,
          COUNT(CASE WHEN noshowed AND NOT showed THEN 1 END)::int AS no_show
        FROM bucketed
        GROUP BY age_group
        ORDER BY
          CASE age_group
            WHEN 'Under 18' THEN 0 WHEN '18-24' THEN 1 WHEN '25-34' THEN 2
            WHEN '35-44' THEN 3    WHEN '45-54' THEN 4 WHEN '55-64' THEN 5
            WHEN '65+' THEN 6      ELSE 7
          END
      `),
      // ── 8. Gender breakdown (normalised) ────────────────────────────────
      sql.unsafe(`
        SELECT
          CASE
            WHEN LOWER(TRIM(q.answers)) IN ('male','m','make','nale','mal')      THEN 'male'
            WHEN LOWER(TRIM(q.answers)) IN ('female','f','fenale','femal','fem') THEN 'female'
            ELSE 'No Answer'
          END                                                                         AS gender,
          COUNT(DISTINCT q."patientID")::int                                          AS cnt,
          COUNT(DISTINCT CASE WHEN c."queueTag"='showed-up' THEN q."patientID" END)::int AS showed_up,
          COUNT(DISTINCT CASE WHEN c."queueTag"='no-show'   THEN q."patientID" END)::int AS no_show
        FROM questionnaire q
        JOIN patient p ON p."patientID" = q."patientID"
        LEFT JOIN consultation c ON c.email = p.email
        WHERE (q.question ILIKE '%gender at birth%' OR q.question ILIKE '%gender_at_birth%')
          AND q.answers IS NOT NULL AND TRIM(q.answers) != ''
          ${df('p."createdAt"')}
        GROUP BY 1
        ORDER BY cnt DESC
      `),
      // ── 9. State distribution ─────────────────────────────────────────
      sql.unsafe(`
        SELECT
          p.state,
          COUNT(*)::int                                                                    AS cnt,
          COUNT(DISTINCT CASE WHEN c."queueTag"='showed-up' THEN p."patientID" END)::int   AS showed_up,
          COUNT(DISTINCT CASE WHEN c."queueTag"='no-show'   THEN p."patientID" END)::int   AS no_show
        FROM patient p
        LEFT JOIN consultation c ON c.email = p.email
        WHERE p.state IS NOT NULL AND TRIM(p.state) != '' ${df('p."createdAt"')}
        GROUP BY p.state ORDER BY cnt DESC LIMIT 15
      `),
      // ── 10. Booking source: self-booked (bookingType=patient) vs admin-booked ──
      // Scope the consultation join to the same date as the booked slot so that
      // a patient with multiple historical consultations is only counted once
      // per booking, preventing showed_up + no_show from exceeding total_booked.
      sql.unsafe(`
        SELECT
          ps."bookingType"                                                                              AS source,
          COUNT(DISTINCT ps.patient_id)::int                                                           AS total_booked,
          COUNT(DISTINCT CASE WHEN c."queueTag"='showed-up' THEN ps.patient_id END)::int               AS showed_up,
          COUNT(DISTINCT CASE WHEN c."queueTag"='no-show'   THEN ps.patient_id END)::int               AS no_show
        FROM patientslot ps
        JOIN range r ON r.id = ps.range_id
        LEFT JOIN patient p  ON p."zohoID" = ps.patient_id
        LEFT JOIN consultation c ON c.email = p.email
          AND c."consultationDate"::date = r.date::date
        WHERE ps."bookingType" IN ('patient','admin')
        ${bookingDateFilter}
        GROUP BY ps."bookingType"
      `),
      // ── 11. Top admin bookers (sales team leaderboard) ────────────────
      sql.unsafe(`
        SELECT
          d.name,
          COUNT(ps.patient_id)::int                                                           AS bookings,
          COUNT(DISTINCT CASE WHEN c."queueTag"='showed-up' THEN ps.patient_id END)::int      AS showed_up,
          COUNT(DISTINCT CASE WHEN c."queueTag"='no-show'   THEN ps.patient_id END)::int      AS no_show
        FROM patientslot ps
        JOIN range r ON r.id = ps.range_id
        JOIN dr d ON d."accessID" = ps."bookedByAdminId"
        LEFT JOIN patient p ON p."zohoID" = ps.patient_id
        LEFT JOIN consultation c ON c.email = p.email
          AND c."consultationDate"::date = r.date::date
        WHERE ps."bookingType" = 'admin'
        ${bookingDateFilter}
        GROUP BY d.name ORDER BY bookings DESC LIMIT 10
      `),
    ]);

    res.json({
      pipeline: pipeline[0],
      consultOutcomes: consultOutcomes,
      tpOutcomes: tpOutcomes,
      appStatus: appStatus,
      topSymptoms: topSymptoms,
      noShowSymptoms: noShowSymptoms,
      ageGroups: ageGroups,
      genders: genders,
      states: states,
      bookingSourceStats: bookingSourceStats,
      adminBookers: adminBookers,
      period: period,
      fetchedAt: new Date(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  } finally {
    await sql.end();
  }
});

// ── GET /questionnaire-analytics ──────────────────────────────────────────────
app.get("/questionnaire-analytics", async (_req, res) => {
  const docUrl = process.env.DOCAPP_DATABASE_URL;
  if (!docUrl) { res.status(500).json({ error: "DOCAPP_DATABASE_URL not set" }); return; }

  const sql = postgres(docUrl, { ssl: "require", max: 3 });
  try {
    const [regToCompletion, stepDropoff, stepReach, lastCompletedForm, timingBuckets] = await Promise.all([
      // ── 1. Registration → questionnaire completion timing ──────────────
      sql`
        SELECT
          ROUND(AVG(EXTRACT(EPOCH FROM (q_max - "createdAt"))/3600)::numeric, 1)                                             AS avg_hours,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (q_max - "createdAt"))/3600)::numeric, 2)    AS median_hours,
          COUNT(*)::int                                                                                                        AS patients
        FROM (
          SELECT p."patientID", p."createdAt", MAX(q."updatedAt") AS q_max
          FROM patient p
          JOIN questionnaire q ON q."patientID" = p."patientID"
          WHERE p."createdAt" IS NOT NULL
            AND LOWER(COALESCE(p."fullName", '')) NOT LIKE '%test%'
            AND LOWER(COALESCE(p.email, ''))      NOT LIKE '%test%'
            AND LOWER(COALESCE(p."fullName", '')) NOT LIKE '%zelda%'
            AND LOWER(COALESCE(p.email, ''))      NOT LIKE '%zelda%'
          GROUP BY p."patientID", p."createdAt"
          HAVING MAX(q."updatedAt") > p."createdAt"
            AND EXTRACT(EPOCH FROM (MAX(q."updatedAt") - p."createdAt"))/3600 BETWEEN 0 AND 720
        ) t
      `,
      // ── 2. Where users stopped (last step per session) ────────────────
      sql`
        SELECT last_step, COUNT(*)::int AS sessions
        FROM (
          SELECT session_id, MAX(step) AS last_step
          FROM questionnaire_events
          WHERE user_id IS NOT NULL AND user_id != ''
            AND user_id NOT IN (
              SELECT "patientID" FROM patient
              WHERE LOWER(COALESCE("fullName", '')) LIKE '%test%'
                 OR LOWER(COALESCE(email, ''))      LIKE '%test%'
                 OR LOWER(COALESCE("fullName", '')) LIKE '%zelda%'
                 OR LOWER(COALESCE(email, ''))      LIKE '%zelda%'
            )
          GROUP BY session_id
        ) t
        WHERE last_step BETWEEN 1 AND 12
        GROUP BY last_step
        ORDER BY last_step
      `,
      // ── 3. Unique users who reached each step ─────────────────────────
      sql`
        SELECT step, COUNT(DISTINCT user_id)::int AS users
        FROM questionnaire_events
        WHERE user_id IS NOT NULL AND user_id != ''
          AND step BETWEEN 1 AND 10
          AND user_id NOT IN (
            SELECT "patientID" FROM patient
            WHERE LOWER(COALESCE("fullName", '')) LIKE '%test%'
               OR LOWER(COALESCE(email, ''))      LIKE '%test%'
               OR LOWER(COALESCE("fullName", '')) LIKE '%zelda%'
               OR LOWER(COALESCE(email, ''))      LIKE '%zelda%'
          )
        GROUP BY step
        ORDER BY step
      `,
      // ── 4. Patient journey stage (lastCompletedForm) ──────────────────
      sql`
        SELECT COALESCE("lastCompletedForm", 'none') AS stage, COUNT(*)::int AS cnt
        FROM patient
        WHERE LOWER(COALESCE("fullName", '')) NOT LIKE '%test%'
          AND LOWER(COALESCE(email, ''))      NOT LIKE '%test%'
          AND LOWER(COALESCE("fullName", '')) NOT LIKE '%zelda%'
          AND LOWER(COALESCE(email, ''))      NOT LIKE '%zelda%'
        GROUP BY "lastCompletedForm"
        ORDER BY cnt DESC
      `,
      // ── 5. Timing distribution buckets ────────────────────────────────
      sql`
        WITH timing AS (
          SELECT EXTRACT(EPOCH FROM (MAX(q."updatedAt") - p."createdAt"))/3600 AS h
          FROM patient p
          JOIN questionnaire q ON q."patientID" = p."patientID"
          WHERE p."createdAt" IS NOT NULL
            AND LOWER(COALESCE(p."fullName", '')) NOT LIKE '%test%'
            AND LOWER(COALESCE(p.email, ''))      NOT LIKE '%test%'
            AND LOWER(COALESCE(p."fullName", '')) NOT LIKE '%zelda%'
            AND LOWER(COALESCE(p.email, ''))      NOT LIKE '%zelda%'
          GROUP BY p."patientID", p."createdAt"
          HAVING MAX(q."updatedAt") > p."createdAt"
            AND EXTRACT(EPOCH FROM (MAX(q."updatedAt") - p."createdAt"))/3600 BETWEEN 0 AND 720
        )
        SELECT
          COUNT(*)::int                                                       AS total,
          COUNT(CASE WHEN h < 0.5             THEN 1 END)::int               AS within_30min,
          COUNT(CASE WHEN h BETWEEN 0.5 AND 2 THEN 1 END)::int               AS h1_to_2h,
          COUNT(CASE WHEN h BETWEEN 2 AND 24  THEN 1 END)::int               AS h2_to_24h,
          COUNT(CASE WHEN h > 24              THEN 1 END)::int               AS over_24h
        FROM timing
      `,
    ]);

    // Step labels map
    const STEP_LABELS: Record<number, string> = {
      1: "Phone Verification",
      2: "Tell Us About You",
      3: "Your Health & Safety",
      4: "Treatment History",
      5: "Your Health Profile",
      6: "Your Health Profile (cont.)",
      7: "Your Medications",
      8: "Start Your Booking",
      9: "Pick a Day / Slot",
      10: "Confirmation Completed",
      11: "Cancellation Confirmed",
      12: "Leave a Google Review",
    };

    const dropoffWithLabels = (stepDropoff as any[]).map((r) => ({
      step: r.last_step,
      label: STEP_LABELS[r.last_step] ?? `Step ${r.last_step}`,
      sessions: r.sessions,
    }));
    const reachWithLabels = (stepReach as any[]).map((r) => ({
      step: r.step,
      label: STEP_LABELS[r.step] ?? `Step ${r.step}`,
      users: r.users,
    }));

    res.json({
      regToCompletion: regToCompletion[0],
      timingBuckets: timingBuckets[0],
      stepDropoff: dropoffWithLabels,
      stepReach: reachWithLabels,
      lastCompletedForm: lastCompletedForm,
      fetchedAt: new Date(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  } finally {
    await sql.end();
  }
});

// ── POST /ai-conversion-insights ──────────────────────────────────────────────
// Accepts the current funnel + questionnaire analytics as context, calls
// OpenAI to produce prioritised, actionable conversion recommendations.
app.post("/ai-conversion-insights", async (req, res) => {
  const openAiKey = process.env.OPEN_AI_KEY;
  if (!openAiKey) { res.status(500).json({ error: "OPEN_AI_KEY not set" }); return; }

  const ctx = req.body as {
    pipeline: Record<string, number>;
    bookingSourceStats: { source: string; total_booked: number; showed_up: number; no_show: number }[];
    regToCompletion: { avg_hours: number; median_hours: number; patients: number };
    timingBuckets: { total: number; within_30min: number; h1_to_2h: number; h2_to_24h: number; over_24h: number };
    stepDropoff: { step: number; label: string; sessions: number }[];
    stepReach: { step: number; label: string; users: number }[];
    lastCompletedForm: { stage: string; cnt: number }[];
  };

  if (!ctx || !ctx.pipeline) {
    res.status(400).json({ error: "Request body must include pipeline and questionnaire context." });
    return;
  }

  const totalPatients = ctx.lastCompletedForm?.reduce((s, r) => s + r.cnt, 0) ?? 0;
  const stuckCount = (ctx.lastCompletedForm?.find((r) => r.stage === "registration")?.cnt ?? 0)
    + (ctx.lastCompletedForm?.find((r) => r.stage === "none")?.cnt ?? 0);
  const bookingCount = ctx.lastCompletedForm?.find((r) => r.stage === "booking")?.cnt ?? 0;
  const adminRow = ctx.bookingSourceStats?.find((r) => r.source === "admin");
  const patientRow = ctx.bookingSourceStats?.find((r) => r.source === "patient");

  const systemPrompt = `You are a senior growth analyst for a telehealth platform selling medicinal cannabis.
Your job is to identify the highest-leverage conversion improvements in the patient funnel.
You MUST return a JSON object matching this exact schema:
{
  "summary": "2-3 sentence executive summary of the biggest opportunity",
  "recommendations": [
    {
      "priority": 1,
      "title": "Short action title",
      "impact": "high|medium|low",
      "effort": "high|medium|low",
      "description": "What to do and why, 2-4 sentences.",
      "metric": "Which metric this directly improves"
    }
  ]
}
Return between 4 and 7 recommendations, ordered by priority (1 = highest).
Important context:
- Step 1 (Phone Verification / OTP) is a FRAUD DETECTION requirement — do NOT recommend removing or simplifying it.
- Focus on what can realistically be changed: copy, UX flow, timing of re-engagement, staff training, clinical pipeline.
- Be specific and data-driven. Reference actual numbers from the data.`;

  const userPrompt = `Here is the current funnel data for our telehealth platform:

OVERALL PIPELINE
- Total registered patients: ${ctx.pipeline.total_patients?.toLocaleString()}
- Booked a consultation: ${ctx.pipeline.booked_consult?.toLocaleString()} (${Math.round((ctx.pipeline.booked_consult / ctx.pipeline.total_patients) * 100)}%)
- Showed up: ${ctx.pipeline.showed_up?.toLocaleString()} (${Math.round((ctx.pipeline.showed_up / ctx.pipeline.total_patients) * 100)}% of total)
- No-show: ${ctx.pipeline.no_show?.toLocaleString()}
- Got a treatment plan: ${ctx.pipeline.has_tp?.toLocaleString()}

BOOKING SOURCE COMPARISON
- Self-booked (patient): ${patientRow?.total_booked?.toLocaleString()} patients, show-up rate ${patientRow ? Math.round((patientRow.showed_up / patientRow.total_booked) * 100) : 0}%, no-show ${patientRow?.no_show?.toLocaleString()}
- Sales-assisted (admin): ${adminRow?.total_booked?.toLocaleString()} patients, show-up rate ${adminRow ? Math.round((adminRow.showed_up / adminRow.total_booked) * 100) : 0}%, no-show ${adminRow?.no_show?.toLocaleString()}

QUESTIONNAIRE COMPLETION TIMING
- Patients analysed (reg + answered Q): ${ctx.regToCompletion?.patients?.toLocaleString()}
- Median time to complete: ${ctx.regToCompletion?.median_hours < 1 ? Math.round(ctx.regToCompletion.median_hours * 60) + ' minutes' : ctx.regToCompletion?.median_hours + ' hours'}
- Average time: ${ctx.regToCompletion?.avg_hours} hours (skewed by returners)
- Completed in same session (≤30 min): ${ctx.timingBuckets?.within_30min?.toLocaleString()} (${Math.round((ctx.timingBuckets.within_30min / ctx.timingBuckets.total) * 100)}%)
- Came back after 24+ hours: ${ctx.timingBuckets?.over_24h?.toLocaleString()} (${Math.round((ctx.timingBuckets.over_24h / ctx.timingBuckets.total) * 100)}%)

QUESTIONNAIRE STEP DROP-OFF (sessions where this was the LAST step)
${ctx.stepDropoff?.filter((r) => r.step <= 10).map((r) => `- Step ${r.step} (${r.label}): ${r.sessions?.toLocaleString()} stopped here`).join('\n')}

USERS WHO REACHED EACH STEP (unique)
${ctx.stepReach?.filter((r) => r.step <= 8).map((r) => `- Step ${r.step} (${r.label}): ${r.users?.toLocaleString()} users`).join('\n')}

PATIENT JOURNEY STAGE (lastCompletedForm — where each patient is RIGHT NOW)
${ctx.lastCompletedForm?.map((r) => `- ${r.stage}: ${r.cnt?.toLocaleString()} (${Math.round((r.cnt / totalPatients) * 100)}%)`).join('\n')}
- Stuck at/before registration (not started questionnaire): ${stuckCount?.toLocaleString()} patients
- Made it to booking: ${bookingCount?.toLocaleString()} patients

What are the highest-priority actions to improve conversion?`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(502).json({ error: `OpenAI error: ${err}` });
      return;
    }

    const json = await response.json() as { choices: { message: { content: string } }[] };
    const content = json.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    res.json({ ...parsed, generatedAt: new Date() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ── Zoho CRM Health Index ─────────────────────────────────────────────────────
// Zoho contacts are the source of truth for the patient list.
// Enriched with supply_tracking, cart_sessions, saleor_orders from analytics DB.
// Same allowance/shop/pattern logic as HEALTH_QUERY but base = zoho_contacts.

const ZOHO_HEALTH_QUERY = sql.raw(`
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
      COUNT(*)::int                                                                 AS repeat_count,
      SUM(used_this_interval::numeric)                                             AS bought_g,
      SUM(allotted_this_interval::numeric)                                         AS allotted_g,
      SUM(used_this_interval::numeric) / NULLIF(SUM(allotted_this_interval::numeric), 0) AS adherence_ratio,
      AVG(remaining_this_interval::numeric)                                        AS avg_remaining_g,
      AVG(allotted_this_interval::numeric)                                         AS avg_allotted_g,
      MIN(remaining_repeats_snapshot)                                              AS repeats_remaining
    FROM supply_by_interval
    GROUP BY email
  ),
  shop_engagement AS (
    SELECT
      email,
      COUNT(*)                                                                     AS total_visits,
      COUNT(*) FILTER (WHERE is_converted = true)                                 AS total_purchases,
      ROUND(COUNT(*) FILTER (WHERE is_converted = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS purchase_rate_pct,
      ROUND(COUNT(*)::numeric / GREATEST(EXTRACT(EPOCH FROM (NOW() - MIN(source_created_at))) / (30.44 * 86400.0), 1), 1) AS avg_visits_per_month,
      CASE
        WHEN COUNT(*) > 1 THEN
          ROUND(EXTRACT(EPOCH FROM (MAX(source_created_at) - MIN(source_created_at))) / 86400.0 / NULLIF(COUNT(*) - 1, 0), 1)
      END                                                                          AS avg_days_between_visits,
      (MAX(source_created_at) AT TIME ZONE 'Australia/Sydney')::date              AS last_visit
    FROM cart_sessions
    WHERE is_deleted = false AND email IS NOT NULL
    GROUP BY email
  ),
  saleor_totals AS (
    SELECT email, SUM(total_grams::numeric) AS saleor_total_g
    FROM saleor_orders
    GROUP BY email
  ),
  deal_stats AS (
    SELECT
      contact_id,
      COUNT(*)::int                                                                 AS total_deals,
      COUNT(*) FILTER (WHERE stage = 'Closed Won')::int                           AS won_deals,
      COUNT(*) FILTER (WHERE stage = 'Closed Lost')::int                          AS lost_deals,
      COUNT(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost'))::int       AS open_deals,
      ROUND(SUM(COALESCE(amount::numeric, 0)), 2)                                  AS total_deal_value,
      MAX(modified_at)                                                             AS last_deal_activity,
      (array_agg(stage ORDER BY modified_at DESC NULLS LAST))[1]                  AS latest_stage
    FROM zoho_deals
    GROUP BY contact_id
  )
  SELECT
    zc.id                                                    AS zoho_id,
    zc.email,
    CONCAT_WS(' ', zc.first_name, zc.last_name)             AS patient_name,
    zc.phone,
    zc.member_status,
    zc.supply_date,
    zc.supply_expiration,
    zc.order_date,
    zc.total_orders_paid,
    zc.consent_form_completed,
    zc.patient_age,
    zc.ad_usecase,
    -- Supply / allowance (from doc-app sync)
    at.repeat_count,
    at.repeats_remaining,
    ROUND(at.allotted_g,      1)   AS allotted_g,
    ROUND(at.bought_g,        1)   AS bought_g,
    ROUND(at.avg_remaining_g, 1)   AS avg_remaining_g,
    ROUND(at.adherence_ratio * 100, 1) AS allowance_pct,
    ROUND(st.saleor_total_g,  1)   AS saleor_total_g,
    at.avg_allotted_g,
    -- Allowance group (same logic as health index)
    CASE
      WHEN at.avg_remaining_g IS NULL THEN NULL
      WHEN (at.avg_remaining_g / NULLIF(at.avg_allotted_g, 0)) < 0.25
           AND at.repeat_count    >= 4
           AND at.adherence_ratio >= 0.75
           AND COALESCE(se.purchase_rate_pct, 100) >= 60               THEN 'purple'
      WHEN (at.avg_remaining_g / NULLIF(at.avg_allotted_g, 0)) < 0.50 THEN 'green'
      WHEN (at.avg_remaining_g / NULLIF(at.avg_allotted_g, 0)) < 0.75 THEN 'orange'
      ELSE 'red'
    END                                                      AS allowance_group,
    -- Shop engagement (from doc-app sync)
    se.total_visits,
    se.total_purchases,
    se.purchase_rate_pct,
    se.avg_visits_per_month,
    se.avg_days_between_visits,
    se.last_visit,
    CASE
      WHEN se.avg_visits_per_month >= 4   THEN 'frequent'
      WHEN se.avg_visits_per_month >= 1   THEN 'occasional'
      WHEN se.avg_visits_per_month IS NOT NULL THEN 'rare'
      ELSE NULL
    END                                                      AS visit_tier,
    CASE
      WHEN se.purchase_rate_pct >= 60 THEN 'high_converter'
      WHEN se.purchase_rate_pct >= 30 THEN 'moderate_converter'
      WHEN se.purchase_rate_pct IS NOT NULL THEN 'low_converter'
      ELSE NULL
    END                                                      AS conversion_tier,
    CASE
      WHEN at.adherence_ratio >= 0.75 AND se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60 THEN 'loyal_power_buyer'
      WHEN at.adherence_ratio >= 0.75                                                                  THEN 'high_adherent'
      WHEN se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60
           AND (at.adherence_ratio IS NULL OR at.adherence_ratio < 0.75)                               THEN 'active_partial_buyer'
      WHEN se.avg_visits_per_month >= 2 AND se.purchase_rate_pct < 30                                 THEN 'window_shopper'
      WHEN se.avg_visits_per_month >= 1 AND se.purchase_rate_pct >= 30                                THEN 'casual_buyer'
      WHEN (se.avg_visits_per_month < 1 OR se.avg_visits_per_month IS NULL)
           AND (at.adherence_ratio IS NULL OR at.adherence_ratio < 0.25)                               THEN 'at_risk'
      ELSE 'needs_review'
    END                                                      AS customer_pattern,
    -- Zoho deals
    COALESCE(ds.total_deals, 0)   AS total_deals,
    COALESCE(ds.won_deals,   0)   AS won_deals,
    COALESCE(ds.lost_deals,  0)   AS lost_deals,
    COALESCE(ds.open_deals,  0)   AS open_deals,
    ds.total_deal_value,
    ds.latest_stage,
    ds.last_deal_activity,
    -- Days until supply expires
    CASE WHEN zc.supply_expiration IS NOT NULL
      THEN (zc.supply_expiration - CURRENT_DATE)::int
    END                                                      AS days_until_expiry,
    -- Member status colour
    CASE
      WHEN zc.member_status ILIKE '%discharged%'   THEN 'red'
      WHEN zc.member_status ILIKE '%gap%'           THEN 'red'
      WHEN zc.member_status ILIKE '%Unrestricted%' THEN 'green'
      WHEN zc.member_status ILIKE '%Approved%'     THEN 'green'
      WHEN zc.member_status ILIKE '%Booked%'       THEN 'blue'
      WHEN zc.member_status ILIKE '%Active%'       THEN 'green'
      WHEN zc.member_status IS NOT NULL             THEN 'orange'
      ELSE 'gray'
    END                                                      AS status_colour
  FROM zoho_contacts zc
  LEFT JOIN allowance_totals   at ON at.email = zc.email
  LEFT JOIN shop_engagement    se ON se.email = zc.email
  LEFT JOIN saleor_totals      st ON st.email = zc.email
  LEFT JOIN deal_stats         ds ON ds.contact_id = zc.id
  WHERE zc.email IS NOT NULL
  ORDER BY
    CASE
      WHEN at.adherence_ratio >= 0.75 AND se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60 THEN 1
      WHEN at.adherence_ratio >= 0.75                                                                  THEN 2
      WHEN se.avg_visits_per_month >= 4 AND se.purchase_rate_pct >= 60                                THEN 3
      WHEN se.avg_visits_per_month >= 1 AND se.purchase_rate_pct >= 30                                THEN 4
      WHEN se.avg_visits_per_month >= 2 AND se.purchase_rate_pct < 30                                 THEN 5
      ELSE 6
    END,
    at.adherence_ratio DESC NULLS LAST
`);

app.get("/zoho-health", async (_req, res) => {
  try {
    const rows = enrichWithSaleor(toRows(await db.execute(ZOHO_HEALTH_QUERY)));
    res.json({ rows, count: rows.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.API_PORT ?? "3001", 10);
app.listen(PORT, () => {
  console.log(`[dev-server] Lambda API running on http://localhost:${PORT}`);
  console.log(`  GET  /customers`);
  console.log(`  POST /ingest`);
  console.log(`  POST /sync`);
  console.log(`  GET  /health-data    → customer-index proxy`);
  console.log(`  GET  /health-detail  → customer-index proxy`);
  console.log(`  GET  /shop-analytics → customer-index proxy`);
  console.log(`  GET  /all-patients           → analytics DB (all 25k+)`);
  console.log(`  GET  /funnel-analytics        → doc-app RDS (live)`);
  console.log(`  GET  /questionnaire-analytics → doc-app RDS (live)`);
  console.log(`  GET  /zoho-health             → Zoho CRM contacts + deals`);
  console.log(`  POST /ai-conversion-insights  → OpenAI GPT-4o-mini`);
});


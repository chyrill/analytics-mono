import postgres from "postgres";

const DEFAULT_QUERY_TIMEOUT_MS = 5000;

let docAppSql: ReturnType<typeof postgres> | null = null;

/**
 * Module-level pooled connection to doc-app's production Postgres, reused across
 * warm Lambda invocations (never closed per-request — mirrors the existing `db`
 * Drizzle singleton pattern). Kept small (`max: 2`) because the API Lambda can
 * fan out across many concurrent warm instances, each holding its own pool —
 * unlike the scheduled sync handler (apps/sync), which runs as a single
 * invocation and can afford a larger pool (`max: 5`).
 */
function getDocAppSql() {
  if (!docAppSql) {
    const url = process.env.DOCAPP_DATABASE_URL;
    if (!url) throw new Error("DOCAPP_DATABASE_URL not set");
    docAppSql = postgres(url, {
      ssl: "require",
      max: 2,
      idle_timeout: 20,
      connect_timeout: 5,
      // Server-side safety net: kill the query on doc-app's DB itself if it runs
      // away, instead of just abandoning it client-side (withTimeout() below) —
      // an abandoned-but-still-running query would keep consuming resources on
      // doc-app's prod DB and holding a connection from our small (max:2) pool.
      connection: { statement_timeout: DEFAULT_QUERY_TIMEOUT_MS - 500 },
    });
  }
  return docAppSql;
}

async function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_QUERY_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`docapp query timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export interface LivePatientHealthRow {
  email: string;
  patient_name: string | null;
  signed_up: string | null;
  repeats: number | null;
  script_expiration_date: string | null;
  needs_update: boolean | null;
  strength: number | null;
  supply_total_active: number | null;
  supply_interval_total_active: number | null;
  supply_used_total_active: number | null;
  repeats_remaining_active: number | null;
  alloted_g: number | null;
  bought_g: number | null;
  adherence_pct: number | null;
  avg_remaining_g: number | null;
  total_visits: number;
  avg_visits_per_month: number | null;
  avg_days_between_visits: number | null;
  last_visit: string | null;
}

// Strength (22/26/29) selection cascade, shared shape between the live doc-app
// query and the analytics-DB mirror fallback query below.
//
// Priority: whichever strength has recorded usage wins first (26 > 29 > 22),
// falling back to the allotment-based cascade (26 > 29 > 22) when no strength
// has any usage yet (e.g. a brand-new patient).
const STRENGTH_CASCADE_SQL = `
  CASE
    WHEN COALESCE(tpt.supply_used_total_26, 0) > 0 THEN 26
    WHEN COALESCE(tpt.supply_used_total_29, 0) > 0 THEN 29
    WHEN COALESCE(tpt.supply_used_total_22, 0) > 0 THEN 22
    WHEN COALESCE(tpt.supply_total_26, 0) > 0 THEN 26
    WHEN COALESCE(tpt.supply_total_29, 0) > 0 THEN 29
    WHEN COALESCE(tpt.supply_total_22, 0) > 0 THEN 22
    ELSE NULL
  END`;

// `population` must be defined as a preceding CTE (see fetchLivePatientHealthData /
// buildMirrorPatientHealthQuery) exposing a single `email` column of already
// lower(btrim())'d addresses. Filtering by it here pushes the population
// restriction down *before* the CASE/aggregation work, instead of scanning the
// (much larger, unfiltered) tracker/tracking tables in full — these can hold
// history for every patient ever, not just the ~3k in scope for this endpoint.
function trackerSelectedCte(tableName: string, needsUpdateColumn: string): string {
  return `
  tracker_selected AS (
    SELECT
      lower(btrim(tpt.email))                    AS email,
      tpt.repeats,
      tpt.script_expiration_date::date            AS script_expiration_date,
      tpt.${needsUpdateColumn}                    AS needs_update,
      ${STRENGTH_CASCADE_SQL} AS strength,
      CASE
        WHEN COALESCE(tpt.supply_used_total_26, 0) > 0 THEN tpt.supply_total_26
        WHEN COALESCE(tpt.supply_used_total_29, 0) > 0 THEN tpt.supply_total_29
        WHEN COALESCE(tpt.supply_used_total_22, 0) > 0 THEN tpt.supply_total_22
        WHEN COALESCE(tpt.supply_total_26, 0) > 0 THEN tpt.supply_total_26
        WHEN COALESCE(tpt.supply_total_29, 0) > 0 THEN tpt.supply_total_29
        WHEN COALESCE(tpt.supply_total_22, 0) > 0 THEN tpt.supply_total_22
        ELSE NULL
      END AS supply_total_active,
      CASE
        WHEN COALESCE(tpt.supply_used_total_26, 0) > 0 THEN tpt.supply_interval_total_26
        WHEN COALESCE(tpt.supply_used_total_29, 0) > 0 THEN tpt.supply_interval_total_29
        WHEN COALESCE(tpt.supply_used_total_22, 0) > 0 THEN tpt.supply_interval_total_22
        WHEN COALESCE(tpt.supply_total_26, 0) > 0 THEN tpt.supply_interval_total_26
        WHEN COALESCE(tpt.supply_total_29, 0) > 0 THEN tpt.supply_interval_total_29
        WHEN COALESCE(tpt.supply_total_22, 0) > 0 THEN tpt.supply_interval_total_22
        ELSE NULL
      END AS supply_interval_total_active,
      CASE
        WHEN COALESCE(tpt.supply_used_total_26, 0) > 0 THEN tpt.supply_used_total_26
        WHEN COALESCE(tpt.supply_used_total_29, 0) > 0 THEN tpt.supply_used_total_29
        WHEN COALESCE(tpt.supply_used_total_22, 0) > 0 THEN tpt.supply_used_total_22
        ELSE NULL
      END AS supply_used_total_active,
      CASE
        WHEN COALESCE(tpt.supply_used_total_26, 0) > 0 THEN tpt.repeats_remaining_26
        WHEN COALESCE(tpt.supply_used_total_29, 0) > 0 THEN tpt.repeats_remaining_29
        WHEN COALESCE(tpt.supply_used_total_22, 0) > 0 THEN tpt.repeats_remaining_22
        WHEN COALESCE(tpt.supply_total_26, 0) > 0 THEN tpt.repeats_remaining_26
        WHEN COALESCE(tpt.supply_total_29, 0) > 0 THEN tpt.repeats_remaining_29
        WHEN COALESCE(tpt.supply_total_22, 0) > 0 THEN tpt.repeats_remaining_22
        ELSE NULL
      END AS repeats_remaining_active
    FROM ${tableName} tpt
    WHERE tpt.email IS NOT NULL
      AND lower(btrim(tpt.email)) IN (SELECT email FROM population)
  )`;
}

// Usage-based adherence %: supply_used_total_active / ((repeats - (repeats_remaining_active - 1)) * supply_interval_total_active).
// Guarded (not a bare NULLIF) because the denominator can go negative, not just
// zero, when repeats_remaining_active is bad data (> repeats + 1).
const ADHERENCE_PCT_SQL = `
  ROUND((
    CASE
      WHEN ts.repeats IS NULL
        OR ts.supply_interval_total_active IS NULL
        OR (ts.repeats - (COALESCE(ts.repeats_remaining_active, 0) - 1)) * ts.supply_interval_total_active <= 0
        THEN NULL
      ELSE LEAST(
        COALESCE(ts.supply_used_total_active, 0)
          / ((ts.repeats - (COALESCE(ts.repeats_remaining_active, 0) - 1)) * ts.supply_interval_total_active),
        1
      ) * 100
    END
  )::numeric, 1)`;

/**
 * Fetches the live patient + treatment-plan-tracker + visit-history dataset
 * directly from doc-app's production Postgres (DOCAPP_DATABASE_URL).
 *
 * Population: doc-app `patient` WHERE "contactId" IS NOT NULL, no additional
 * data-quality filter (raw table trusted as-is per spec).
 */
export async function fetchLivePatientHealthData(): Promise<LivePatientHealthRow[]> {
  const sql = getDocAppSql();
  return withTimeout(
    sql.unsafe<LivePatientHealthRow[]>(`
      WITH
      population AS (
        SELECT
          lower(btrim(p.email))     AS email,
          p."fullName"              AS patient_name,
          p."createdAt"::date       AS signed_up
        FROM patient p
        WHERE p."contactId" IS NOT NULL
          AND p.email IS NOT NULL
          AND btrim(p.email) != ''
      ),
      ${trackerSelectedCte("treatmentplantracker", '"needsUpdate"')},
      visit_stats AS (
        SELECT
          lower(btrim(email))                                                              AS email,
          COUNT(*)                                                                          AS total_visits,
          AVG(supply_remaining_interval)                                                     AS avg_remaining_g,
          ROUND(COUNT(*)::numeric / GREATEST(
            EXTRACT(EPOCH FROM (NOW() - MIN(COALESCE(next_repeat_date, supply_interval_start, created_at::date))))
              / (30.44 * 86400.0),
            1
          ), 1)                                                                              AS avg_visits_per_month,
          CASE
            WHEN COUNT(*) > 1 THEN
              ROUND((
                MAX(COALESCE(next_repeat_date, supply_interval_start, created_at::date))
                - MIN(COALESCE(next_repeat_date, supply_interval_start, created_at::date))
              )::numeric / NULLIF(COUNT(*) - 1, 0), 1)
            ELSE NULL
          END                                                                                AS avg_days_between_visits,
          MAX(COALESCE(next_repeat_date, supply_interval_start, created_at::date))           AS last_visit
        FROM user_login_supply_tracking
        WHERE email IS NOT NULL
          AND btrim(email) != ''
          AND lower(btrim(email)) IN (SELECT email FROM population)
        GROUP BY lower(btrim(email))
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
        ROUND((ts.supply_interval_total_active * ts.repeats)::numeric, 1)                    AS alloted_g,
        ROUND(COALESCE(ts.supply_used_total_active, 0)::numeric, 1)                          AS bought_g,
        ${ADHERENCE_PCT_SQL} AS adherence_pct,
        ROUND(vs.avg_remaining_g::numeric, 1)                                                AS avg_remaining_g,
        COALESCE(vs.total_visits, 0)                    AS total_visits,
        vs.avg_visits_per_month,
        vs.avg_days_between_visits,
        vs.last_visit
      FROM population p
      LEFT JOIN tracker_selected ts ON ts.email = p.email
      LEFT JOIN visit_stats      vs ON vs.email = p.email
    `),
  );
}

export { trackerSelectedCte as buildMirrorTrackerSelectedCte, ADHERENCE_PCT_SQL as MIRROR_ADHERENCE_PCT_SQL };

/** Closes the pooled connection — for graceful shutdown in tests/scripts only. */
export async function closeDocAppSql(): Promise<void> {
  if (docAppSql) {
    await docAppSql.end();
    docAppSql = null;
  }
}

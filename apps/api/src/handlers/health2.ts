import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db } from "@analytics/db";
import { sql } from "drizzle-orm";
import { fetchDocAppPatientPopulation } from "../lib/docapp-db";

// ─────────────────────────────────────────────────────────────────────────────
// /health-2 — personalized ORDERING CADENCE health index.
//
// Deliberately independent of handlers/health.ts (no shared imports, no
// shared SQL) — see docs/new-health-page.md for the design discussion this
// implements. Where health.ts's /health-data classifies patients primarily
// on gram-utilisation (bought_g / allotted_g), this endpoint classifies
// primarily on ORDERING CADENCE: each patient's own median gap between
// orders, compared against their own history first, with utilisation kept
// as a separate, non-blended axis.
//
// Source of truth: `saleor_orders` for cadence, `supply_tracking_history`
// (already-synced, independently-computed ledger — see
// scripts/build-supply-tracking-history.ts) for completed-repeat-cycle
// count and utilisation %, and `db_treatment_plans` for plan-approval date
// (used to detect patients who were approved but never ordered).
//
// KNOWN GAP: several reason codes from the source design spec require data
// this codebase does not currently sync anywhere (payment failures, cart
// abandonment detail beyond cart_sessions.is_converted, product-availability
// events, delivery/refund tickets, account-access errors, survey/complaint
// text, affordability signals, consultation/follow-up booking status). Those
// codes are intentionally NOT emitted here — see REASON_CODES_NOT_AVAILABLE
// below — rather than faked from proxies that would misrepresent confidence.
// ─────────────────────────────────────────────────────────────────────────────

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const MS_PER_DAY = 86_400_000;

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}
const toRows = <T = Record<string, unknown>>(r: unknown): T[] => Array.from(r as Iterable<T>);

function daysSince(dateLike: string | Date | null | undefined): number | null {
  if (!dateLike) return null;
  const t = dateLike instanceof Date ? dateLike.getTime() : new Date(dateLike).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / MS_PER_DAY;
}

// Reason codes documented in the design spec that we cannot honestly compute
// from data currently synced into analytics-mono. Kept here (rather than
// silently omitted) so the gap is visible to anyone reading this file.
export const REASON_CODES_NOT_AVAILABLE = [
  "PAYMENT_FAILURE",
  "CART_ABANDONMENT",
  "PRODUCT_UNAVAILABLE",
  "DELIVERY_OR_REFUND_ISSUE",
  "ACCOUNT_ACCESS_PROBLEM",
  "NEGATIVE_FEEDBACK",
  "AFFORDABILITY_CONSTRAINT",
  "FOLLOW_UP_NOT_BOOKED",
] as const;

// ── SQL ────────────────────────────────────────────────────────────────────────

interface CadenceRow {
  email: string;
  approved_at: string | null;
  fulfilled_order_count: number | null;
  first_order_at: string | null;
  last_order_at: string | null;
  median_gap_days: number | null;
  avg_gap_days: number | null;
  longest_gap_days: number | null;
  gaps_over_28_count: number | null;
  last_order_grams: number | null;
  avg_prior_3_grams: number | null;
  streak_start_at: string | null;
  streak_order_count: number | null;
  streak_longest_gap_days: number | null;
  streak_median_gap_days: number | null;
  completed_cycles: number | null;
  repeats_remaining: number | null;
  grams_target: number | null;
  flagged: boolean | null;
  adherence_pct: number | null;
  plan_expiration_date: string | null;
}

function buildCadenceQuery() {
  return sql.raw(`
    WITH orders_raw AS (
      -- 0g / negative orders excluded as duplicate/data-quality noise, not
      -- real activity — mirrors the exclusion called out in the sample
      -- cadence classifications this endpoint is modeled on.
      SELECT LOWER(TRIM(email)) AS email, ordered_at, total_grams
      FROM saleor_orders
      WHERE email IS NOT NULL AND total_grams IS NOT NULL AND total_grams > 0
    ),
    orders_dedup AS (
      -- Flag near-duplicate orders: same patient, same quantity, placed
      -- within 60 minutes of the previous one — almost certainly a split
      -- transaction or duplicate import, not two separate repeats (observed
      -- e.g. two identical 56g orders 7 minutes apart). Keep only the
      -- earliest of each such cluster so it doesn't inflate order counts or
      -- inject a spurious near-zero gap into the median-gap calculation.
      SELECT
        email, ordered_at, total_grams,
        LAG(ordered_at) OVER (PARTITION BY email, total_grams ORDER BY ordered_at) AS prev_same_qty_at
      FROM orders_raw
    ),
    orders_filtered AS (
      SELECT email, ordered_at, total_grams
      FROM orders_dedup
      WHERE prev_same_qty_at IS NULL
         OR EXTRACT(EPOCH FROM (ordered_at - prev_same_qty_at)) / 60 > 60
    ),
    gapped AS (
      SELECT
        email, ordered_at, total_grams,
        EXTRACT(EPOCH FROM (ordered_at - LAG(ordered_at) OVER (PARTITION BY email ORDER BY ordered_at))) / 86400.0 AS gap_days,
        ROW_NUMBER() OVER (PARTITION BY email ORDER BY ordered_at DESC) AS rn_desc
      FROM orders_filtered
    ),
    gap_stats AS (
      SELECT
        email,
        COUNT(*)::int AS fulfilled_order_count,
        MIN(ordered_at) AS first_order_at,
        MAX(ordered_at) AS last_order_at,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_days) FILTER (WHERE gap_days IS NOT NULL) AS median_gap_days,
        AVG(gap_days) AS avg_gap_days,
        MAX(gap_days) AS longest_gap_days,
        COUNT(*) FILTER (WHERE gap_days > 28)::int AS gaps_over_28_count
      FROM gapped
      GROUP BY email
    ),
    last_grams AS (
      SELECT email, total_grams AS last_order_grams FROM gapped WHERE rn_desc = 1
    ),
    prior_grams AS (
      -- Baseline for "materially lower than previous cycles": avg of the
      -- three orders immediately before the most recent one.
      SELECT email, AVG(total_grams) AS avg_prior_3_grams
      FROM gapped WHERE rn_desc BETWEEN 2 AND 4
      GROUP BY email
    ),
    streak_marked AS (
      -- Running count of >28-day gaps up to each order — the current value
      -- of that count is the "streak id" for the most recent re-engagement
      -- window, letting us isolate current-streak stats from lifetime ones
      -- (a patient who lapsed once and came back shouldn't have their
      -- lifetime median dragged around by the pre-lapse period).
      SELECT email, ordered_at, total_grams, gap_days,
        SUM(CASE WHEN gap_days > 28 THEN 1 ELSE 0 END) OVER (PARTITION BY email ORDER BY ordered_at) AS streak_id
      FROM gapped
    ),
    current_streak AS (
      SELECT
        s.email,
        MIN(s.ordered_at) AS streak_start_at,
        COUNT(*)::int AS streak_order_count,
        MAX(s.gap_days) AS streak_longest_gap_days,
        -- Deliberately excludes the streak's own ENTRY gap (the >28-day
        -- lapse that triggered this streak, gap_days > 28) from the median
        -- — that one-off transitional gap is not part of the patient's
        -- ONGOING cadence since returning, and leaving it in permanently
        -- inflated streak_median_gap_days for a while after a single delay,
        -- wrongly firing DECLINING_ORDER_FREQUENCY / LOW_UTILISATION_VS_BASELINE
        -- on patients who'd already recovered (see Michael Simpson,
        -- 2026-07-24: one 48-day gap on 7 Jun 2026 followed by a normal
        -- 22-day repeat on 29 Jun — not overdue, quantity stable at 14g —
        -- was still flagged "gaps lengthening" / orange purely because that
        -- 48-day entry gap stayed baked into the streak's own median).
        percentile_cont(0.5) WITHIN GROUP (ORDER BY s.gap_days) FILTER (WHERE s.gap_days IS NOT NULL AND s.gap_days <= 28) AS streak_median_gap_days
      FROM streak_marked s
      JOIN (SELECT email, MAX(streak_id) AS max_streak_id FROM streak_marked GROUP BY email) m
        ON m.email = s.email AND m.max_streak_id = s.streak_id
      GROUP BY s.email
    ),
    plan_approval AS (
      -- Population + "approved" timestamp: earliest APPROVED treatment-plan
      -- record per patient. Using db_treatment_plans (not saleor_orders) as
      -- the population base means patients who were approved but never
      -- ordered still show up, which the old /health-data query can miss.
      -- Only "Approve*" outcomes count (excludes Reject / pending / null —
      -- observed values: 'Approve Unrestricted', 'Approve 29% restricted',
      -- 'Approve Subject To Discharge Form', 'Approve Restricted',
      -- 'Approve Subject To GP Referral', 'Approve 29% unrestricted',
      -- 'Approve 22% Subject To CBD Trial', 'Approved 29% unrestricted',
      -- 'Approve Pending GP Letter', vs. 'Reject').
      SELECT LOWER(TRIM(email)) AS email, MIN(source_created_at) AS approved_at
      FROM db_treatment_plans
      WHERE email IS NOT NULL AND outcome ILIKE 'approve%'
      GROUP BY LOWER(TRIM(email))
    ),
    sth_latest AS (
      SELECT DISTINCT ON (email) email, repeats_remaining, grams_target, flagged
      FROM supply_tracking_history
      ORDER BY email, window_start DESC
    ),
    sth_cycles AS (
      SELECT email, COUNT(*) FILTER (WHERE window_end <= CURRENT_DATE)::int AS completed_cycles
      FROM supply_tracking_history GROUP BY email
    ),
    sth_adherence AS (
      SELECT email, SUM(grams_target) AS allotted_g_elapsed, SUM(grams_actual) AS bought_g
      FROM supply_tracking_history
      WHERE window_end >= date_trunc('year', CURRENT_DATE) AND window_start <= CURRENT_DATE
      GROUP BY email
    ),
    plan_expiry AS (
      -- Current treatment-plan end date, sourced from Zoho's Supply_Expiration
      -- field (synced into zoho_contacts.supply_expiration) rather than derived
      -- from supply_tracking_history — Zoho is the system of record for the
      -- patient's live/approved plan window. DISTINCT ON picks the
      -- most-recently-synced contact record per email in case of duplicates.
      SELECT DISTINCT ON (LOWER(TRIM(email)))
        LOWER(TRIM(email)) AS email,
        supply_expiration AS plan_expiration_date
      FROM zoho_contacts
      WHERE email IS NOT NULL AND supply_expiration IS NOT NULL
      ORDER BY LOWER(TRIM(email)), modified_at DESC
    )
    SELECT
      pa.email,
      pa.approved_at,
      gs.fulfilled_order_count,
      gs.first_order_at,
      gs.last_order_at,
      gs.median_gap_days,
      gs.avg_gap_days,
      gs.longest_gap_days,
      gs.gaps_over_28_count,
      lg.last_order_grams,
      pg.avg_prior_3_grams,
      cs.streak_start_at,
      cs.streak_order_count,
      cs.streak_longest_gap_days,
      cs.streak_median_gap_days,
      COALESCE(sc.completed_cycles, 0) AS completed_cycles,
      sl.repeats_remaining,
      sl.grams_target,
      sl.flagged,
      CASE WHEN COALESCE(sa.allotted_g_elapsed, 0) <= 0 THEN NULL
           ELSE ROUND(LEAST(COALESCE(sa.bought_g, 0) / sa.allotted_g_elapsed, 1) * 100, 1)
      END AS adherence_pct,
      pe.plan_expiration_date
    FROM plan_approval pa
    LEFT JOIN gap_stats gs ON gs.email = pa.email
    LEFT JOIN last_grams lg ON lg.email = pa.email
    LEFT JOIN prior_grams pg ON pg.email = pa.email
    LEFT JOIN current_streak cs ON cs.email = pa.email
    LEFT JOIN sth_cycles sc ON sc.email = pa.email
    LEFT JOIN sth_latest sl ON sl.email = pa.email
    LEFT JOIN sth_adherence sa ON sa.email = pa.email
    LEFT JOIN plan_expiry pe ON pe.email = pa.email
  `);
}

interface PatientNameRow {
  email: string;
  patient_name: string | null;
}

function buildPatientNameQuery() {
  return sql.raw(`
    SELECT LOWER(TRIM(email)) AS email, full_name AS patient_name
    FROM db_patients
    WHERE email IS NOT NULL
  `);
}

// Fallback population (mirrors doc-app's `patient."contactId" IS NOT NULL`
// definition) for when the live doc-app connection is unavailable — same
// "real, CRM-synced patient" semantics via the already-synced analytics
// mirror table instead.
function buildAnalyticsPatientEmailsQuery() {
  return sql.raw(`
    SELECT LOWER(TRIM(email)) AS email, full_name
    FROM db_patients
    WHERE contact_id IS NOT NULL AND email IS NOT NULL AND TRIM(email) <> ''
  `);
}

// email -> full name (or null if unknown), restricted to the doc-app
// contactId-not-null population (or its analytics-mirror equivalent on
// fallback). Presence as a key in this map IS the population membership test.
async function loadPopulation(): Promise<Map<string, string | null>> {
  try {
    return await fetchDocAppPatientPopulation();
  } catch (e) {
    console.error("[health2] live doc-app population query failed, falling back to analytics mirror:", e);
    const result = await db.execute(buildAnalyticsPatientEmailsQuery());
    return new Map(toRows<{ email: string; full_name: string | null }>(result).map((r) => [r.email, r.full_name]));
  }
}

// ── Classification ──────────────────────────────────────────────────────────────

type LifecycleStage =
  | "approved_not_ordered"
  | "first_order_completed"
  | "awaiting_second_repeat"
  | "second_repeat_completed"
  | "established"
  | "lapsed"
  | "churned";

type HealthColor = "purple" | "green" | "orange" | "red";
type UtilisationTier = "high" | "moderate" | "low" | "minimal" | null;

export interface Health2Row {
  email: string;
  patient_name: string | null;
  lifecycle_stage: LifecycleStage;
  lifecycle_label: string;
  health_color: HealthColor;
  watch_flag: boolean;
  utilisation_tier: UtilisationTier;
  adherence_pct: number | null;
  completed_cycles: number;
  fulfilled_order_count: number;
  median_gap_days: number | null;
  last_order_at: string | null;
  expected_next_order_at: string | null;
  days_overdue: number | null;
  reason_codes: string[];
  sample_confidence: "thin" | "adequate";
}

function utilisationTier(adherencePct: number | null): UtilisationTier {
  if (adherencePct == null) return null;
  if (adherencePct >= 75) return "high";
  if (adherencePct >= 50) return "moderate";
  if (adherencePct >= 25) return "low";
  return "minimal";
}

function classifyRow(row: CadenceRow, name: string | null): Health2Row {
  const fulfilledOrderCount = row.fulfilled_order_count ?? 0;
  const completedCycles = row.completed_cycles ?? 0;
  const hasOrders = fulfilledOrderCount > 0;
  const daysSinceApproved = daysSince(row.approved_at);
  const daysSinceLastOrder = daysSince(row.last_order_at);
  const adherencePct = row.adherence_pct != null ? Number(row.adherence_pct) : null;
  const repeatsRemaining = row.repeats_remaining != null ? Number(row.repeats_remaining) : null;

  // Zoho's Supply_Expiration (synced into zoho_contacts.supply_expiration)
  // is the system of record for whether the patient's CURRENT approved
  // treatment plan is still valid. Used below to gate REPEATS_EXHAUSTED (the
  // internally-computed supply_tracking_history ledger can lag behind a plan
  // that's since been extended/renewed in Zoho — e.g. Kyle Carlin's plan was
  // extended to 2027-01-08 while his last-synced supply_tracking_history
  // window still showed 0 repeats remaining, 2026-07-24), and separately to
  // flag a plan that's genuinely expired with no renewal on file.
  const planExpiryDate = row.plan_expiration_date ? new Date(row.plan_expiration_date) : null;
  const planCurrentlyValid = planExpiryDate != null && planExpiryDate.getTime() > Date.now();

  const reasonCodes: string[] = [];
  let lifecycleStage: LifecycleStage;
  let lifecycleLabel: string;
  let healthColor: HealthColor;
  let watchFlag = false;
  let expectedNextOrderAt: string | null = null;
  let daysOverdue: number | null = null;

  // "Do not allow the expected cadence to be less than 28 days" — floor from
  // the source spec; also the default when there isn't enough order history
  // yet to trust a personal median.
  const personalGapDays = Math.max(row.median_gap_days ?? 28, 28);
  if (row.last_order_at) {
    expectedNextOrderAt = new Date(new Date(row.last_order_at).getTime() + personalGapDays * MS_PER_DAY).toISOString();
    daysOverdue = daysSinceLastOrder != null ? Math.round(daysSinceLastOrder - personalGapDays) : null;
  }

  if (!hasOrders) {
    // Approved but no first order.
    lifecycleStage = "approved_not_ordered";
    const d = daysSinceApproved ?? 0;
    if (d <= 7) {
      lifecycleLabel = "New — Awaiting activation";
      healthColor = "green";
    } else if (d <= 14) {
      lifecycleLabel = "New — Watch";
      healthColor = "green";
      watchFlag = true;
    } else if (d <= 28) {
      lifecycleLabel = "Orange — Activation risk";
      healthColor = "orange";
    } else {
      lifecycleLabel = "Red — Never activated";
      healthColor = "red";
    }
  } else if (completedCycles < 1) {
    // First order completed, second repeat not yet eligible — spec says
    // treat as normal/healthy, do not judge on utilisation of an incomplete cycle.
    lifecycleStage = "first_order_completed";
    lifecycleLabel = "Provisional Green — first repeat cycle in progress";
    healthColor = "green";
  } else if (completedCycles === 1 || completedCycles === 2) {
    // Awaiting/just-completed second repeat — this is "one of the most
    // important early churn points" per the spec: judge on days-since-eligible,
    // not on raw days-since-order.
    lifecycleStage = completedCycles === 1 ? "awaiting_second_repeat" : "second_repeat_completed";
    const d = daysOverdue ?? -Infinity;
    if (d <= 0) {
      lifecycleLabel =
        completedCycles === 1 ? "Provisional Green — second repeat not yet eligible" : "Provisional Green — building tenure";
      healthColor = "green";
    } else if (d <= 7) {
      lifecycleLabel = "Provisional Green — Watch";
      healthColor = "green";
      watchFlag = true;
    } else if (d <= 14) {
      lifecycleLabel = "Orange — Early repeat risk";
      healthColor = "orange";
      reasonCodes.push("SECOND_REPEAT_NOT_COMPLETED");
    } else if (d <= 28) {
      lifecycleLabel = "Orange — High activation risk";
      healthColor = "orange";
      reasonCodes.push("SECOND_REPEAT_NOT_COMPLETED");
    } else if (d <= 56) {
      lifecycleLabel = "Red — Failed to progress";
      healthColor = "red";
      reasonCodes.push("SECOND_REPEAT_NOT_COMPLETED");
    } else {
      lifecycleLabel = "Red — Churn review";
      healthColor = "red";
      reasonCodes.push("SECOND_REPEAT_NOT_COMPLETED");
    }
  } else {
    // Established: three or more completed repeat cycles — full CHI applies.
    lifecycleStage = "established";
    const d = daysOverdue ?? -Infinity;

    // Judged off the CURRENT gap only (days since last order vs. this
    // patient's own recent/personal cadence) — NEVER off lifetime historical
    // gap counts. A patient who had one bad stretch long ago but has since
    // resumed a stable cadence must be able to recover to green/purple;
    // permanently pinning them to Red off an old gap (the previous
    // `gaps_over_28_count >= 2` rule) was a real bug — see the Kyle Carlin
    // case (2026-07-24): one delayed cycle in Jan–Mar 2026 followed by four
    // consecutive on-time repeats was still forcing Red months later with
    // 0 days currently overdue. "Two full expected repeat opportunities
    // passed with no later valid order" is now just the >56-day tier of the
    // same current-days-overdue measure, not a separate historical counter.
    if (d > 56) {
      healthColor = "red";
      lifecycleLabel = "Red — two expected repeats missed, churn review";
      reasonCodes.push("TWO_CYCLES_MISSED");
    } else if (d > 28) {
      healthColor = "red";
      lifecycleLabel = "Red — more than 28 days overdue";
      reasonCodes.push("OVERDUE_15_TO_28_DAYS");
    } else if (d > 14) {
      healthColor = "orange";
      lifecycleLabel = "Orange — high risk";
      reasonCodes.push("OVERDUE_15_TO_28_DAYS");
    } else if (d > 7) {
      healthColor = "orange";
      lifecycleLabel = "Orange — emerging risk";
      reasonCodes.push("OVERDUE_8_TO_14_DAYS");
    } else if (d > 0) {
      healthColor = "green";
      lifecycleLabel = "Green — Watch";
      watchFlag = true;
    } else {
      // Not overdue: Purple requires sustained adherence, not just cadence.
      // But first check whether the CURRENT streak itself began with a huge
      // lapse (patient went dormant and has only just returned) — a single
      // reactivation order shouldn't jump straight to Green/Purple "stable"
      // before the new cadence has actually been demonstrated. See Stuart
      // Nita (2026-07-24): a 195-day gap immediately preceded the most
      // recent order, with only that one order so far in the new streak —
      // was landing on "Green — stable" purely because that single order
      // isn't itself overdue yet.
      const reactivationGapDays = row.streak_longest_gap_days != null ? Number(row.streak_longest_gap_days) : null;
      const recentReactivation = reactivationGapDays != null && reactivationGapDays > 56 && (row.streak_order_count ?? 0) <= 2;
      if (recentReactivation) {
        healthColor = "orange";
        lifecycleLabel = "Orange — reactivated after prolonged lapse, recovery not yet confirmed";
        reasonCodes.push("RECENT_REACTIVATION");
      } else {
        healthColor = adherencePct != null && adherencePct >= 75 ? "purple" : "green";
        lifecycleLabel = healthColor === "purple" ? "Purple — sustained high engagement" : "Green — stable";
      }
    }

    // Secondary signals layered on top (can only worsen, never override an
    // already-worse red classification).
    const decliningFrequency =
      row.streak_median_gap_days != null && row.median_gap_days != null && row.streak_median_gap_days > row.median_gap_days * 1.3;
    if (decliningFrequency) reasonCodes.push("DECLINING_ORDER_FREQUENCY");

    const lastGrams = row.last_order_grams != null ? Number(row.last_order_grams) : null;
    const priorGrams = row.avg_prior_3_grams != null ? Number(row.avg_prior_3_grams) : null;
    const decliningQuantity = lastGrams != null && priorGrams != null && priorGrams > 0 && lastGrams <= priorGrams * 0.5;
    if (decliningQuantity) reasonCodes.push("DECLINING_PURCHASE_QUANTITY");

    // Utilisation-only Orange: per spec, only fires as a *decline from the
    // patient's own normal pattern* over a completed cycle — approximated
    // here via the frequency/quantity decline signals above, not from the
    // raw percentage alone (a stable low-utilisation patient should NOT be
    // downgraded — see the "utilisation rule needs correction" note).
    if (adherencePct != null && adherencePct >= 25 && adherencePct < 50 && (decliningFrequency || decliningQuantity)) {
      reasonCodes.push("LOW_UTILISATION_VS_BASELINE");
      // NOTE: lifecycleLabel must be kept in sync with healthColor here — a
      // prior bug left the label saying "Green — stable"/"Purple — sustained
      // high engagement" even after this downgraded the colour to orange
      // (found on Stuart Nita, 2026-07-24: health_color=orange, label="Green
      // — stable").
      if (healthColor === "purple" || healthColor === "green") {
        healthColor = "orange";
        lifecycleLabel = "Orange — utilisation declining vs personal baseline";
      }
    }

    if (repeatsRemaining != null && repeatsRemaining <= 0 && !planCurrentlyValid) {
      reasonCodes.push("REPEATS_EXHAUSTED");
      if (healthColor === "purple" || healthColor === "green") {
        healthColor = "orange";
        lifecycleLabel = "Orange — repeats exhausted, plan renewal needed";
      }
    }

    if ((healthColor === "orange" || healthColor === "red") && reasonCodes.length === 0) {
      reasonCodes.push("UNKNOWN_REASON");
    }
  }

  // Treatment-plan expiration overlay (same zoho_contacts.supply_expiration
  // field as planExpiryDate/planCurrentlyValid above) — independent of the
  // cadence/utilisation classification above: a patient can look "on track"
  // by ordering cadence but still be sitting on an expired treatment plan,
  // which the source design spec calls out as one of the strongest
  // repeat-progression stop points ("Treatment plan expired or became
  // unusable" — docs/new-health-page.md). Guarded against stale Zoho sync
  // data: if the patient has ordered again *after* the recorded expiry date,
  // assume they were re-approved (even if Zoho hasn't re-synced yet) and
  // don't flag it.
  const orderedSinceExpiry =
    planExpiryDate != null && row.last_order_at != null && new Date(row.last_order_at).getTime() > planExpiryDate.getTime();
  const daysSinceExpiry = planExpiryDate != null ? (Date.now() - planExpiryDate.getTime()) / MS_PER_DAY : null;
  const planExpired = planExpiryDate != null && daysSinceExpiry! > 0 && !orderedSinceExpiry;

  if (planExpired) {
    reasonCodes.push("TREATMENT_PLAN_EXPIRED");
    // approved_not_ordered patients already carry their own red/orange
    // "never activated" story — tag the reason code but leave that alone.
    if (lifecycleStage !== "approved_not_ordered") {
      // ~90 days without reactivating after expiry is treated as churned (a
      // starting threshold, per the spec's own note that thresholds need
      // calibrating against real behaviour) — shorter than that is "lapsed",
      // still plausibly reactivatable.
      lifecycleStage = daysSinceExpiry! > 90 ? "churned" : "lapsed";
      lifecycleLabel = lifecycleStage === "churned" ? "Red — treatment plan expired, churned" : "Red — treatment plan expired";
      healthColor = "red";
    }
  }

  // Minimum-sample confidence gate — n<4 orders (or <1 completed cycle) means
  // a "personal median" isn't statistically trustworthy yet.
  const sampleConfidence: "thin" | "adequate" = fulfilledOrderCount >= 4 && completedCycles >= 1 ? "adequate" : "thin";

  return {
    email: row.email,
    patient_name: name,
    lifecycle_stage: lifecycleStage,
    lifecycle_label: lifecycleLabel,
    health_color: healthColor,
    watch_flag: watchFlag,
    utilisation_tier: utilisationTier(adherencePct),
    adherence_pct: adherencePct,
    completed_cycles: completedCycles,
    fulfilled_order_count: fulfilledOrderCount,
    median_gap_days: row.median_gap_days != null ? Math.round(Number(row.median_gap_days) * 10) / 10 : null,
    last_order_at: row.last_order_at,
    expected_next_order_at: expectedNextOrderAt,
    days_overdue: daysOverdue != null ? Math.round(daysOverdue) : null,
    reason_codes: reasonCodes,
    sample_confidence: sampleConfidence,
  };
}

async function loadHealth2Rows(): Promise<Health2Row[]> {
  const [cadenceResult, nameResult, population] = await Promise.all([
    db.execute(buildCadenceQuery()),
    db.execute(buildPatientNameQuery()),
    loadPopulation(),
  ]);
  const mirrorNameByEmail = new Map(toRows<PatientNameRow>(nameResult).map((r) => [r.email, r.patient_name]));
  const rows = toRows<CadenceRow>(cadenceResult)
    // Restrict to real, CRM-synced patients (doc-app patient.contactId IS NOT
    // NULL, or its analytics-mirror equivalent) — on top of the approved-plan
    // filter already applied in plan_approval, this excludes test/duplicate
    // signups that never made it into the CRM.
    .filter((row) => population.has(row.email))
    .map((row) => {
      // Prefer doc-app's fullName (source of truth for the population itself);
      // fall back to the analytics mirror's name if doc-app has none on file.
      const name = population.get(row.email) || mirrorNameByEmail.get(row.email) || null;
      return classifyRow(row, name);
    });

  // Ranked queue, not a grid: most urgent first. Funnel-stalled patients
  // (awaiting/failed second repeat) are pinned above pure day-count overdue
  // ones at the same color tier, per the UX design for this page.
  const stageUrgency: Record<LifecycleStage, number> = {
    awaiting_second_repeat: 0,
    second_repeat_completed: 1,
    approved_not_ordered: 2,
    established: 3,
    first_order_completed: 4,
    lapsed: 3,
    churned: 3,
  };
  const colorRank: Record<HealthColor, number> = { red: 0, orange: 1, green: 2, purple: 3 };

  rows.sort((a, b) => {
    const colorDiff = colorRank[a.health_color] - colorRank[b.health_color];
    if (colorDiff !== 0) return colorDiff;
    const stageDiff = stageUrgency[a.lifecycle_stage] - stageUrgency[b.lifecycle_stage];
    if (stageDiff !== 0) return stageDiff;
    return (b.days_overdue ?? -Infinity) - (a.days_overdue ?? -Infinity);
  });

  return rows;
}

export const handler: APIGatewayProxyHandlerV2 = async (): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const rows = await loadHealth2Rows();
    return ok({ rows, count: rows.length, reasonCodesNotAvailable: REASON_CODES_NOT_AVAILABLE });
  } catch (e) {
    console.error("[health2]", e);
    return err("Internal Server Error", 500);
  }
};

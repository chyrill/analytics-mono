import type { ScheduledHandler } from "aws-lambda";
import { db, customers, reconciliationLog, supplyTracking, cartSessions, ordersDispatched, dbPatients, dbTreatmentPlans, dbTreatmentPlanTracker, syncCheckpoints, syncJobs } from "@analytics/db";
import { sql, eq, and } from "drizzle-orm";
import postgres from "postgres";
import type { Sql } from "postgres";

interface DocAppPatient {
  id: string;
  email: string;
  fullName: string | null;
  zohoID: string | null;
  createdAt: Date;
}

interface SupplyRow {
  id: string;
  email: string;
  interval_key: string;
  supply_interval_total: string | null;
  supply_used_interval: string | null;
  supply_remaining_interval: string | null;
  supply_remaining_repeats: number | null;
  created_at: Date;
}

interface CartSessionRow {
  id: string;
  email: string;
  is_converted: boolean;
  is_deleted: boolean;
  created_at: Date;
}

interface OrderRow {
  id: string;
  email: string;
  order_total: string | null;
  order_date: string | null;
  ordered_weight_22: string | null;
  ordered_weight_26: string | null;
  ordered_weight_29: string | null;
  created_at: Date | null;
}

async function openDocAppConn() {
  const url = process.env.DOCAPP_DATABASE_URL;
  if (!url) throw new Error("DOCAPP_DATABASE_URL not set");
  return postgres(url, { ssl: "require", max: 5 });
}

async function fetchDocAppPatients(): Promise<DocAppPatient[]> {
  const conn = await openDocAppConn();
  try {
    const [colRow] = await conn<{ col: string }[]>`
      SELECT column_name AS col
      FROM information_schema.columns
      WHERE table_name = 'patient'
        AND column_name = ANY(ARRAY['zohoID', 'contactID', 'patientID'])
      LIMIT 1
    `;
    const zohoCol = colRow?.col ?? null;
    console.log(`[docapp-sync] zoho column resolved: ${zohoCol ?? "none"}`);

    return zohoCol
      ? await conn<DocAppPatient[]>`
          SELECT id::text, lower(btrim(email)) AS email, "fullName",
            ${conn(zohoCol)} AS "zohoID", "createdAt"
          FROM patient
          WHERE email IS NOT NULL AND btrim(email) != ''
        `
      : await conn<DocAppPatient[]>`
          SELECT id::text, lower(btrim(email)) AS email, "fullName",
            NULL::text AS "zohoID", "createdAt"
          FROM patient
          WHERE email IS NOT NULL AND btrim(email) != ''
        `;
  } finally {
    await conn.end();
  }
}

async function fetchSupplyTracking(): Promise<SupplyRow[]> {
  const conn = await openDocAppConn();
  try {
    return await conn<SupplyRow[]>`
      SELECT
        id::text,
        lower(btrim(email))                              AS email,
        COALESCE(
          next_repeat_date,
          supply_interval_start,
          DATE_TRUNC('month', created_at)::date
        )::text                                          AS interval_key,
        supply_interval_total::text,
        supply_used_interval::text,
        supply_remaining_interval::text,
        supply_remaining_repeats,
        created_at
      FROM user_login_supply_tracking
      WHERE email IS NOT NULL
        AND btrim(email) != ''
    `;
  } finally {
    await conn.end();
  }
}

async function fetchCartSessions(): Promise<CartSessionRow[]> {
  const conn = await openDocAppConn();
  try {
    return await conn<CartSessionRow[]>`
      SELECT
        id::text,
        lower(btrim(email)) AS email,
        is_converted,
        is_deleted,
        created_at
      FROM cart_sessions
      WHERE email IS NOT NULL AND btrim(email) != ''
    `;
  } finally {
    await conn.end();
  }
}

async function fetchOrdersDispatched(): Promise<OrderRow[]> {
  const conn = await openDocAppConn();
  try {
    return await conn<OrderRow[]>`
      SELECT
        id::text,
        lower(btrim(email))      AS email,
        order_total::text,
        order_date::text,
        ordered_weight_22::text,
        ordered_weight_26::text,
        ordered_weight_29::text,
        created_at
      FROM orders_to_dispatch
      WHERE email IS NOT NULL AND btrim(email) != ''
    `;
  } finally {
    await conn.end();
  }
}

const BATCH = 500;

export const handler: ScheduledHandler = async (_event) => {
  console.log("[docapp-sync] starting");
  const runStart = new Date();

  // ── 1. Patients ──────────────────────────────────────────────────────────────
  const patients = await fetchDocAppPatients();
  console.log(`[docapp-sync] fetched ${patients.length} patients`);
  let inserted = 0;
  for (let i = 0; i < patients.length; i += BATCH) {
    const batch = patients.slice(i, i + BATCH);
    await db
      .insert(customers)
      .values(batch.map((p) => ({
        email: p.email.toLowerCase().trim(),
        name: p.fullName ?? null,
        docAppPatientId: p.id,
        zohoContactId: p.zohoID ?? null,
        reconciliationStatus: "gap",
      })))
      .onConflictDoUpdate({
        target: customers.email,
        set: {
          docAppPatientId: sql`excluded.doc_app_patient_id`,
          zohoContactId: sql`COALESCE(excluded.zoho_contact_id, customers.zoho_contact_id)`,
          updatedAt: sql`now()`,
        },
      });
    inserted += batch.length;
  }
  console.log(`[docapp-sync] patients upserted: ${inserted}`);

  // ── 2. Supply tracking ───────────────────────────────────────────────────────
  try {
    const supplyRows = await fetchSupplyTracking();
    console.log(`[docapp-sync] fetched ${supplyRows.length} supply tracking rows`);
    let supplyCount = 0;
    for (let i = 0; i < supplyRows.length; i += BATCH) {
      const batch = supplyRows.slice(i, i + BATCH);
      await db
        .insert(supplyTracking)
        .values(batch.map((r) => ({
          sourceId: r.id,
          email: r.email,
          intervalKey: r.interval_key,
          supplyIntervalTotal: r.supply_interval_total ?? null,
          supplyUsedInterval: r.supply_used_interval ?? null,
          supplyRemainingInterval: r.supply_remaining_interval ?? null,
          supplyRemainingRepeats: r.supply_remaining_repeats ?? null,
          sourceCreatedAt: r.created_at,
        })))
        .onConflictDoUpdate({
          target: supplyTracking.sourceId,
          set: {
            supplyIntervalTotal: sql`excluded.supply_interval_total`,
            supplyUsedInterval: sql`excluded.supply_used_interval`,
            supplyRemainingInterval: sql`excluded.supply_remaining_interval`,
            supplyRemainingRepeats: sql`excluded.supply_remaining_repeats`,
            syncedAt: sql`now()`,
          },
        });
      supplyCount += batch.length;
    }
    console.log(`[docapp-sync] supply_tracking upserted: ${supplyCount}`);
  } catch (e) {
    console.warn(`[docapp-sync] supply_tracking sync failed (skipping): ${(e as Error).message}`);
  }

  // ── 3. Cart sessions ─────────────────────────────────────────────────────────
  try {
    const sessions = await fetchCartSessions();
    console.log(`[docapp-sync] fetched ${sessions.length} cart sessions`);
    let sessionCount = 0;
    for (let i = 0; i < sessions.length; i += BATCH) {
      const batch = sessions.slice(i, i + BATCH);
      await db
        .insert(cartSessions)
        .values(batch.map((r) => ({
          sourceId: r.id,
          email: r.email,
          isConverted: r.is_converted,
          isDeleted: r.is_deleted,
          sourceCreatedAt: r.created_at,
        })))
        .onConflictDoUpdate({
          target: cartSessions.sourceId,
          set: {
            isConverted: sql`excluded.is_converted`,
            isDeleted: sql`excluded.is_deleted`,
            syncedAt: sql`now()`,
          },
        });
      sessionCount += batch.length;
    }
    console.log(`[docapp-sync] cart_sessions upserted: ${sessionCount}`);
  } catch (e) {
    console.warn(`[docapp-sync] cart_sessions sync failed (skipping): ${(e as Error).message}`);
  }

  // ── 4. Orders dispatched ─────────────────────────────────────────────────────
  try {
    const orders = await fetchOrdersDispatched();
    console.log(`[docapp-sync] fetched ${orders.length} orders`);
    let orderCount = 0;
    for (let i = 0; i < orders.length; i += BATCH) {
      const batch = orders.slice(i, i + BATCH);
      await db
        .insert(ordersDispatched)
        .values(batch.map((r) => ({
          sourceId: r.id,
          email: r.email,
          orderTotal: r.order_total ?? null,
          orderDate: r.order_date ?? null,
          weight22: r.ordered_weight_22 ?? null,
          weight26: r.ordered_weight_26 ?? null,
          weight29: r.ordered_weight_29 ?? null,
          sourceCreatedAt: r.created_at ?? null,
        })))
        .onConflictDoUpdate({
          target: ordersDispatched.sourceId,
          set: {
            orderTotal: sql`excluded.order_total`,
            orderDate: sql`excluded.order_date`,
            weight22: sql`excluded.weight_22`,
            weight26: sql`excluded.weight_26`,
            weight29: sql`excluded.weight_29`,
            syncedAt: sql`now()`,
          },
        });
      orderCount += batch.length;
    }
    console.log(`[docapp-sync] orders_dispatched upserted: ${orderCount}`);
  } catch (e) {
    console.warn(`[docapp-sync] orders_dispatched sync failed (skipping): ${(e as Error).message}`);
  }

  await db.insert(reconciliationLog).values({
    source: "docapp",
    runAt: runStart,
    recordsChecked: patients.length,
    gapsFound: 0,
    duplicatesFound: 0,
    mismatchesFound: 0,
    notes: `patients: ${inserted}`,
  });

  console.log("[docapp-sync] done");
};

if (require.main === module) {
  void handler({} as never, {} as never, () => { });
}

// ── Checkpoint helpers ────────────────────────────────────────────────────────

async function getCheckpoint(source: string, entity: string): Promise<Date | null> {
  const rows = await db.select().from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.source, source), eq(syncCheckpoints.entity, entity)))
    .limit(1);
  return rows[0]?.lastSyncedAt ?? null;
}

async function writeCheckpoint(source: string, entity: string, jobId: string | null | undefined, syncedAt: Date) {
  const safeJobId = jobId ?? null;
  await db.insert(syncCheckpoints)
    .values({ source, entity, lastSyncedAt: syncedAt, lastJobId: safeJobId })
    .onConflictDoUpdate({
      target: [syncCheckpoints.source, syncCheckpoints.entity],
      set: { lastSyncedAt: syncedAt, lastJobId: safeJobId },
    });
}

// ── DocApp-specific row types ─────────────────────────────────────────────────

interface DocAppPatientFull {
  id: string;
  email: string;
  full_name: string | null;
  patient_id: string | null;
  zoho_id: string | null;
  contact_id: string | null;
  zoho_customer_id: string | null;
  saleor_id: string | null;
  returning_patient: boolean | null;
  locked: boolean | null;
  dr_locked: string | null;
  state: string | null;
  application_status: string | null;
  last_completed_form: string | null;
  dob: string | null;
  used_cannabis_before: boolean | null;
  mobile: string | null;
  phone_verified: boolean | null;
  consent_form_completed: boolean | null;
  risk_rating: number | null;
  created_at: Date | null;
  updated_at: Date | null;
}

interface DocAppTreatmentPlan {
  id: string;
  email: string | null;
  patient_id: string | null;
  dr_id: string | null;
  dr_name: string | null;
  consultation_id: string | null;
  outcome: string | null;
  dr_notes: string | null;
  date: string | null;
  type: string | null;
  mental_health_doc: string | null;
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
  id_verified: string | null;
  source: string | null;
  diagnosis: string | null;
  last_notes_edited_at: Date | null;
  last_notes_edited_by: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

// ── syncDocPatients ───────────────────────────────────────────────────────────

async function syncDocPatients(
  conn: Sql,
  jobId: string,
): Promise<{ fetched: number; upserted: number }> {
  const since = await getCheckpoint("docapp", "patients");
  const syncedAt = new Date();

  let rows: DocAppPatientFull[];
  if (since) {
    console.log(`[docapp-sync] patients: incremental since ${since.toISOString()}`);
    rows = await conn<DocAppPatientFull[]>`
      SELECT
        id::text,
        lower(btrim(email))           AS email,
        "fullName"                    AS full_name,
        "patientID"                   AS patient_id,
        "zohoID"                      AS zoho_id,
        "contactId"                   AS contact_id,
        "zohoCustomerId"              AS zoho_customer_id,
        "saleorId"                    AS saleor_id,
        "returningPatient"            AS returning_patient,
        locked,
        "drLocked"                    AS dr_locked,
        state,
        "applicationStatus"           AS application_status,
        "lastCompletedForm"           AS last_completed_form,
        dob,
        "usedCannabisBefore"          AS used_cannabis_before,
        mobile,
        "phoneVerified"               AS phone_verified,
        consent_form_completed,
        "riskRating"                  AS risk_rating,
        "createdAt"                   AS created_at,
        "updatedAt"                   AS updated_at
      FROM patient
      WHERE email IS NOT NULL
        AND btrim(email) != ''
        AND "updatedAt" > ${since}
    `;
  } else {
    console.log("[docapp-sync] patients: full scan");
    rows = await conn<DocAppPatientFull[]>`
      SELECT
        id::text,
        lower(btrim(email))           AS email,
        "fullName"                    AS full_name,
        "patientID"                   AS patient_id,
        "zohoID"                      AS zoho_id,
        "contactId"                   AS contact_id,
        "zohoCustomerId"              AS zoho_customer_id,
        "saleorId"                    AS saleor_id,
        "returningPatient"            AS returning_patient,
        locked,
        "drLocked"                    AS dr_locked,
        state,
        "applicationStatus"           AS application_status,
        "lastCompletedForm"           AS last_completed_form,
        dob,
        "usedCannabisBefore"          AS used_cannabis_before,
        mobile,
        "phoneVerified"               AS phone_verified,
        consent_form_completed,
        "riskRating"                  AS risk_rating,
        "createdAt"                   AS created_at,
        "updatedAt"                   AS updated_at
      FROM patient
      WHERE email IS NOT NULL
        AND btrim(email) != ''
    `;
  }

  console.log(`[docapp-sync] fetched ${rows.length} patients`);
  if (rows.length === 0) {
    await writeCheckpoint("docapp", "patients", jobId, syncedAt);
    return { fetched: 0, upserted: 0 };
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.insert(dbPatients)
      .values(batch.map((r) => ({
        sourceId: r.id,
        email: r.email,
        fullName: r.full_name,
        patientId: r.patient_id,
        zohoId: r.zoho_id,
        contactId: r.contact_id,
        zohoCustomerId: r.zoho_customer_id,
        saleorId: r.saleor_id,
        returningPatient: r.returning_patient,
        locked: r.locked,
        drLocked: r.dr_locked,
        state: r.state,
        applicationStatus: r.application_status,
        lastCompletedForm: r.last_completed_form,
        dob: r.dob,
        usedCannabisBefore: r.used_cannabis_before,
        mobile: r.mobile,
        phoneVerified: r.phone_verified,
        consentFormCompleted: r.consent_form_completed,
        riskRating: r.risk_rating,
        sourceCreatedAt: r.created_at,
        sourceUpdatedAt: r.updated_at,
      })))
      .onConflictDoUpdate({
        target: dbPatients.sourceId,
        set: {
          email: sql`excluded.email`,
          fullName: sql`excluded.full_name`,
          patientId: sql`excluded.patient_id`,
          zohoId: sql`excluded.zoho_id`,
          contactId: sql`excluded.contact_id`,
          zohoCustomerId: sql`excluded.zoho_customer_id`,
          saleorId: sql`excluded.saleor_id`,
          returningPatient: sql`excluded.returning_patient`,
          locked: sql`excluded.locked`,
          drLocked: sql`excluded.dr_locked`,
          state: sql`excluded.state`,
          applicationStatus: sql`excluded.application_status`,
          lastCompletedForm: sql`excluded.last_completed_form`,
          dob: sql`excluded.dob`,
          usedCannabisBefore: sql`excluded.used_cannabis_before`,
          mobile: sql`excluded.mobile`,
          phoneVerified: sql`excluded.phone_verified`,
          consentFormCompleted: sql`excluded.consent_form_completed`,
          riskRating: sql`excluded.risk_rating`,
          sourceUpdatedAt: sql`excluded.source_updated_at`,
          syncedAt: sql`now()`,
        },
      });
    upserted += batch.length;
  }

  await writeCheckpoint("docapp", "patients", jobId, syncedAt);
  console.log(`[docapp-sync] db_patients upserted: ${upserted}`);
  return { fetched: rows.length, upserted };
}

// ── syncDocTreatmentPlans ─────────────────────────────────────────────────────

async function syncDocTreatmentPlans(
  conn: Sql,
  jobId: string,
): Promise<{ fetched: number; upserted: number }> {
  const since = await getCheckpoint("docapp", "treatment_plans");
  const syncedAt = new Date();

  let rows: DocAppTreatmentPlan[];
  if (since) {
    console.log(`[docapp-sync] treatment_plans: incremental since ${since.toISOString()}`);
    rows = await conn<DocAppTreatmentPlan[]>`
      SELECT
        id::text,
        lower(btrim(email))               AS email,
        "patientID"                        AS patient_id,
        "drId"                             AS dr_id,
        "drName"                           AS dr_name,
        "consultationId"::text             AS consultation_id,
        outcome,
        "drNotes"                          AS dr_notes,
        date::text,
        type,
        "mentalHealthSupprtingDocument"    AS mental_health_doc,
        "dosePerDay22"::text               AS dose_per_day_22,
        "strengthAndConcentration22"       AS strength_concentration_22,
        "maxDose22"::text                  AS max_dose_22,
        "totalQuantity22"::text            AS total_quantity_22,
        "numberOfRepeat22"                 AS number_of_repeat_22,
        "supplyInterval22"                 AS supply_interval_22,
        "dosePerDay26"::text               AS dose_per_day_26,
        "strengthAndConcentration26"       AS strength_concentration_26,
        "maxDose26"::text                  AS max_dose_26,
        "totalQuantity26"::text            AS total_quantity_26,
        "numberOfRepeat26"                 AS number_of_repeat_26,
        "supplyInterval26"                 AS supply_interval_26,
        "dosePerDay29"::text               AS dose_per_day_29,
        "strengthAndConcentration29"       AS strength_concentration_29,
        "maxDose29"::text                  AS max_dose_29,
        "totalQuantity29"::text            AS total_quantity_29,
        "numberOfRepeat29"                 AS number_of_repeat_29,
        "supplyInterval29"                 AS supply_interval_29,
        "idVerified"                       AS id_verified,
        source,
        diagnosis,
        "lastNotesEditedAt"                AS last_notes_edited_at,
        "lastNotesEditedBy"                AS last_notes_edited_by,
        "createdAt"                        AS created_at,
        "updatedAt"                        AS updated_at
      FROM treatmentplan
      WHERE email IS NOT NULL
        AND btrim(email) != ''
        AND ("updatedAt" > ${since} OR "createdAt" > ${since})
    `;
  } else {
    console.log("[docapp-sync] treatment_plans: full scan");
    rows = await conn<DocAppTreatmentPlan[]>`
      SELECT
        id::text,
        lower(btrim(email))               AS email,
        "patientID"                        AS patient_id,
        "drId"                             AS dr_id,
        "drName"                           AS dr_name,
        "consultationId"::text             AS consultation_id,
        outcome,
        "drNotes"                          AS dr_notes,
        date::text,
        type,
        "mentalHealthSupprtingDocument"    AS mental_health_doc,
        "dosePerDay22"::text               AS dose_per_day_22,
        "strengthAndConcentration22"       AS strength_concentration_22,
        "maxDose22"::text                  AS max_dose_22,
        "totalQuantity22"::text            AS total_quantity_22,
        "numberOfRepeat22"                 AS number_of_repeat_22,
        "supplyInterval22"                 AS supply_interval_22,
        "dosePerDay26"::text               AS dose_per_day_26,
        "strengthAndConcentration26"       AS strength_concentration_26,
        "maxDose26"::text                  AS max_dose_26,
        "totalQuantity26"::text            AS total_quantity_26,
        "numberOfRepeat26"                 AS number_of_repeat_26,
        "supplyInterval26"                 AS supply_interval_26,
        "dosePerDay29"::text               AS dose_per_day_29,
        "strengthAndConcentration29"       AS strength_concentration_29,
        "maxDose29"::text                  AS max_dose_29,
        "totalQuantity29"::text            AS total_quantity_29,
        "numberOfRepeat29"                 AS number_of_repeat_29,
        "supplyInterval29"                 AS supply_interval_29,
        "idVerified"                       AS id_verified,
        source,
        diagnosis,
        "lastNotesEditedAt"                AS last_notes_edited_at,
        "lastNotesEditedBy"                AS last_notes_edited_by,
        "createdAt"                        AS created_at,
        "updatedAt"                        AS updated_at
      FROM treatmentplan
      WHERE email IS NOT NULL
        AND btrim(email) != ''
    `;
  }

  console.log(`[docapp-sync] fetched ${rows.length} treatment plans`);
  if (rows.length === 0) {
    await writeCheckpoint("docapp", "treatment_plans", jobId, syncedAt);
    return { fetched: 0, upserted: 0 };
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.insert(dbTreatmentPlans)
      .values(batch.map((r) => ({
        sourceId: r.id,
        email: r.email ?? "",
        patientId: r.patient_id,
        drId: r.dr_id,
        drName: r.dr_name,
        consultationId: r.consultation_id,
        outcome: r.outcome,
        drNotes: r.dr_notes,
        date: r.date,
        type: r.type,
        mentalHealthDocument: r.mental_health_doc,
        dosePerDay22: r.dose_per_day_22,
        strengthConcentration22: r.strength_concentration_22,
        maxDose22: r.max_dose_22,
        totalQuantity22: r.total_quantity_22,
        numberOfRepeat22: r.number_of_repeat_22,
        supplyInterval22: r.supply_interval_22,
        dosePerDay26: r.dose_per_day_26,
        strengthConcentration26: r.strength_concentration_26,
        maxDose26: r.max_dose_26,
        totalQuantity26: r.total_quantity_26,
        numberOfRepeat26: r.number_of_repeat_26,
        supplyInterval26: r.supply_interval_26,
        dosePerDay29: r.dose_per_day_29,
        strengthConcentration29: r.strength_concentration_29,
        maxDose29: r.max_dose_29,
        totalQuantity29: r.total_quantity_29,
        numberOfRepeat29: r.number_of_repeat_29,
        supplyInterval29: r.supply_interval_29,
        idVerified: r.id_verified,
        source: r.source,
        diagnosis: r.diagnosis,
        lastNotesEditedAt: r.last_notes_edited_at,
        lastNotesEditedBy: r.last_notes_edited_by,
        sourceCreatedAt: r.created_at,
        sourceUpdatedAt: r.updated_at,
      })))
      .onConflictDoUpdate({
        target: dbTreatmentPlans.sourceId,
        set: {
          outcome: sql`excluded.outcome`,
          drNotes: sql`excluded.dr_notes`,
          dosePerDay22: sql`excluded.dose_per_day_22`,
          strengthConcentration22: sql`excluded.strength_concentration_22`,
          maxDose22: sql`excluded.max_dose_22`,
          totalQuantity22: sql`excluded.total_quantity_22`,
          numberOfRepeat22: sql`excluded.number_of_repeat_22`,
          supplyInterval22: sql`excluded.supply_interval_22`,
          dosePerDay26: sql`excluded.dose_per_day_26`,
          strengthConcentration26: sql`excluded.strength_concentration_26`,
          maxDose26: sql`excluded.max_dose_26`,
          totalQuantity26: sql`excluded.total_quantity_26`,
          numberOfRepeat26: sql`excluded.number_of_repeat_26`,
          supplyInterval26: sql`excluded.supply_interval_26`,
          dosePerDay29: sql`excluded.dose_per_day_29`,
          strengthConcentration29: sql`excluded.strength_concentration_29`,
          maxDose29: sql`excluded.max_dose_29`,
          totalQuantity29: sql`excluded.total_quantity_29`,
          numberOfRepeat29: sql`excluded.number_of_repeat_29`,
          supplyInterval29: sql`excluded.supply_interval_29`,
          idVerified: sql`excluded.id_verified`,
          source: sql`excluded.source`,
          diagnosis: sql`excluded.diagnosis`,
          lastNotesEditedAt: sql`excluded.last_notes_edited_at`,
          lastNotesEditedBy: sql`excluded.last_notes_edited_by`,
          sourceUpdatedAt: sql`excluded.source_updated_at`,
          syncedAt: sql`now()`,
        },
      });
    upserted += batch.length;
  }

  await writeCheckpoint("docapp", "treatment_plans", jobId, syncedAt);
  console.log(`[docapp-sync] db_treatment_plans upserted: ${upserted}`);
  return { fetched: rows.length, upserted };
}

// ── syncDocTreatmentPlanTracker ───────────────────────────────────────────────

interface TreatmentPlanTrackerRow {
  email: string;
  synced_date: string | null;
  repeats: number | null;
  script_start_date: string | null;
  script_expiration_date: string | null;
  consulting_doctor: string | null;
  supply_interval: number | null;
  repeats_remaining_22: number | null;
  repeats_remaining_26: number | null;
  repeats_remaining_29: number | null;
  supply_total_22: number | null;
  supply_total_26: number | null;
  supply_total_29: number | null;
  supply_used_total_22: number | null;
  supply_used_total_26: number | null;
  supply_used_total_29: number | null;
  supply_interval_total_22: number | null;
  supply_interval_total_26: number | null;
  supply_interval_total_29: number | null;
  supply_used_interval_22: number | null;
  supply_used_interval_26: number | null;
  supply_used_interval_29: number | null;
  supply_interval_start_22: string | null;
  supply_interval_start_26: string | null;
  supply_interval_start_29: string | null;
  needs_update: boolean | null;
}

async function syncDocTreatmentPlanTracker(
  conn: Sql,
  jobId: string,
): Promise<{ fetched: number; upserted: number }> {
  const syncedAt = new Date();

  // Always full scan — doc-app only sets needsUpdate=TRUE when repeats/script_expiration_date
  // change, it never updates synced_date, so incremental filtering would miss those updates.
  console.log("[docapp-sync] treatment_plan_tracker: full scan");
  const rows = await conn<TreatmentPlanTrackerRow[]>`
    SELECT
      lower(btrim(email))       AS email,
      synced_date::text,
      repeats,
      script_start_date::text,
      script_expiration_date::text,
      consulting_doctor,
      supply_interval,
      repeats_remaining_22,
      repeats_remaining_26,
      repeats_remaining_29,
      supply_total_22,
      supply_total_26,
      supply_total_29,
      supply_used_total_22,
      supply_used_total_26,
      supply_used_total_29,
      supply_interval_total_22,
      supply_interval_total_26,
      supply_interval_total_29,
      supply_used_interval_22,
      supply_used_interval_26,
      supply_used_interval_29,
      supply_interval_start_22::text,
      supply_interval_start_26::text,
      supply_interval_start_29::text,
      "needsUpdate"             AS needs_update
    FROM treatmentplantracker
    WHERE email IS NOT NULL
      AND btrim(email) != ''
  `;

  console.log(`[docapp-sync] fetched ${rows.length} treatment plan tracker rows`);
  if (rows.length === 0) {
    await writeCheckpoint("docapp", "treatment_plan_tracker", jobId, syncedAt);
    return { fetched: 0, upserted: 0 };
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.insert(dbTreatmentPlanTracker)
      .values(batch.map((r) => ({
        email: r.email,
        syncedDate: r.synced_date,
        repeats: r.repeats,
        scriptStartDate: r.script_start_date,
        scriptExpirationDate: r.script_expiration_date,
        consultingDoctor: r.consulting_doctor,
        supplyInterval: r.supply_interval,
        repeatsRemaining22: r.repeats_remaining_22?.toString() ?? null,
        repeatsRemaining26: r.repeats_remaining_26?.toString() ?? null,
        repeatsRemaining29: r.repeats_remaining_29?.toString() ?? null,
        supplyTotal22: r.supply_total_22?.toString() ?? null,
        supplyTotal26: r.supply_total_26?.toString() ?? null,
        supplyTotal29: r.supply_total_29?.toString() ?? null,
        supplyUsedTotal22: r.supply_used_total_22?.toString() ?? null,
        supplyUsedTotal26: r.supply_used_total_26?.toString() ?? null,
        supplyUsedTotal29: r.supply_used_total_29?.toString() ?? null,
        supplyIntervalTotal22: r.supply_interval_total_22?.toString() ?? null,
        supplyIntervalTotal26: r.supply_interval_total_26?.toString() ?? null,
        supplyIntervalTotal29: r.supply_interval_total_29?.toString() ?? null,
        supplyUsedInterval22: r.supply_used_interval_22?.toString() ?? null,
        supplyUsedInterval26: r.supply_used_interval_26?.toString() ?? null,
        supplyUsedInterval29: r.supply_used_interval_29?.toString() ?? null,
        supplyIntervalStart22: r.supply_interval_start_22,
        supplyIntervalStart26: r.supply_interval_start_26,
        supplyIntervalStart29: r.supply_interval_start_29,
        needsUpdate: r.needs_update,
      })))
      .onConflictDoUpdate({
        target: dbTreatmentPlanTracker.email,
        set: {
          syncedDate: sql`excluded.synced_date`,
          repeats: sql`excluded.repeats`,
          scriptStartDate: sql`excluded.script_start_date`,
          scriptExpirationDate: sql`excluded.script_expiration_date`,
          consultingDoctor: sql`excluded.consulting_doctor`,
          supplyInterval: sql`excluded.supply_interval`,
          repeatsRemaining22: sql`excluded.repeats_remaining_22`,
          repeatsRemaining26: sql`excluded.repeats_remaining_26`,
          repeatsRemaining29: sql`excluded.repeats_remaining_29`,
          supplyTotal22: sql`excluded.supply_total_22`,
          supplyTotal26: sql`excluded.supply_total_26`,
          supplyTotal29: sql`excluded.supply_total_29`,
          supplyUsedTotal22: sql`excluded.supply_used_total_22`,
          supplyUsedTotal26: sql`excluded.supply_used_total_26`,
          supplyUsedTotal29: sql`excluded.supply_used_total_29`,
          supplyIntervalTotal22: sql`excluded.supply_interval_total_22`,
          supplyIntervalTotal26: sql`excluded.supply_interval_total_26`,
          supplyIntervalTotal29: sql`excluded.supply_interval_total_29`,
          supplyUsedInterval22: sql`excluded.supply_used_interval_22`,
          supplyUsedInterval26: sql`excluded.supply_used_interval_26`,
          supplyUsedInterval29: sql`excluded.supply_used_interval_29`,
          supplyIntervalStart22: sql`excluded.supply_interval_start_22`,
          supplyIntervalStart26: sql`excluded.supply_interval_start_26`,
          supplyIntervalStart29: sql`excluded.supply_interval_start_29`,
          needsUpdate: sql`excluded.needs_update`,
          syncedAt: sql`now()`,
        },
      });
    upserted += batch.length;
  }

  await writeCheckpoint("docapp", "treatment_plan_tracker", jobId, syncedAt);
  console.log(`[docapp-sync] db_treatment_plan_tracker upserted: ${upserted}`);
  return { fetched: rows.length, upserted };
}

// ── runDocAppSync — entry point for /sync/docapp API route ───────────────────

export async function runDocAppSync(jobId: string): Promise<{ fetched: number; upserted: number }> {
  const conn = postgres(process.env.DOCAPP_DATABASE_URL ?? "", {
    ssl: "require",
    max: 5,
  });
  if (!process.env.DOCAPP_DATABASE_URL) throw new Error("DOCAPP_DATABASE_URL not set");

  try {
    let totalFetched = 0;
    let totalUpserted = 0;

    const p = await syncDocPatients(conn, jobId);
    totalFetched += p.fetched;
    totalUpserted += p.upserted;

    const t = await syncDocTreatmentPlans(conn, jobId);
    totalFetched += t.fetched;
    totalUpserted += t.upserted;

    const tr = await syncDocTreatmentPlanTracker(conn, jobId);
    totalFetched += tr.fetched;
    totalUpserted += tr.upserted;

    return { fetched: totalFetched, upserted: totalUpserted };
  } finally {
    await conn.end();
  }
}


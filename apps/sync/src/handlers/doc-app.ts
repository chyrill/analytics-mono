import type { ScheduledHandler } from "aws-lambda";
import { db, customers, reconciliationLog, supplyTracking, cartSessions, ordersDispatched } from "@analytics/db";
import { sql } from "drizzle-orm";
import postgres from "postgres";

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
        AND supply_interval_total IS NOT NULL
        AND supply_interval_total > 0
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
  void handler({} as never, {} as never, () => {});
}


"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const db_1 = require("@analytics/db");
const drizzle_orm_1 = require("drizzle-orm");
const postgres_1 = __importDefault(require("postgres"));
async function openDocAppConn() {
    const url = process.env.DOCAPP_DATABASE_URL;
    if (!url)
        throw new Error("DOCAPP_DATABASE_URL not set");
    return (0, postgres_1.default)(url, { ssl: "require", max: 5 });
}
async function fetchDocAppPatients() {
    const conn = await openDocAppConn();
    try {
        const [colRow] = await conn `
      SELECT column_name AS col
      FROM information_schema.columns
      WHERE table_name = 'patient'
        AND column_name = ANY(ARRAY['zohoID', 'contactID', 'patientID'])
      LIMIT 1
    `;
        const zohoCol = colRow?.col ?? null;
        console.log(`[docapp-sync] zoho column resolved: ${zohoCol ?? "none"}`);
        return zohoCol
            ? await conn `
          SELECT id::text, lower(btrim(email)) AS email, "fullName",
            ${conn(zohoCol)} AS "zohoID", "createdAt"
          FROM patient
          WHERE email IS NOT NULL AND btrim(email) != ''
        `
            : await conn `
          SELECT id::text, lower(btrim(email)) AS email, "fullName",
            NULL::text AS "zohoID", "createdAt"
          FROM patient
          WHERE email IS NOT NULL AND btrim(email) != ''
        `;
    }
    finally {
        await conn.end();
    }
}
async function fetchSupplyTracking() {
    const conn = await openDocAppConn();
    try {
        return await conn `
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
    }
    finally {
        await conn.end();
    }
}
async function fetchCartSessions() {
    const conn = await openDocAppConn();
    try {
        return await conn `
      SELECT
        id::text,
        lower(btrim(email)) AS email,
        is_converted,
        is_deleted,
        created_at
      FROM cart_sessions
      WHERE email IS NOT NULL AND btrim(email) != ''
    `;
    }
    finally {
        await conn.end();
    }
}
async function fetchOrdersDispatched() {
    const conn = await openDocAppConn();
    try {
        return await conn `
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
    }
    finally {
        await conn.end();
    }
}
const BATCH = 500;
const handler = async (_event) => {
    console.log("[docapp-sync] starting");
    const runStart = new Date();
    // ── 1. Patients ──────────────────────────────────────────────────────────────
    const patients = await fetchDocAppPatients();
    console.log(`[docapp-sync] fetched ${patients.length} patients`);
    let inserted = 0;
    for (let i = 0; i < patients.length; i += BATCH) {
        const batch = patients.slice(i, i + BATCH);
        await db_1.db
            .insert(db_1.customers)
            .values(batch.map((p) => ({
            email: p.email.toLowerCase().trim(),
            name: p.fullName ?? null,
            docAppPatientId: p.id,
            zohoContactId: p.zohoID ?? null,
            reconciliationStatus: "gap",
        })))
            .onConflictDoUpdate({
            target: db_1.customers.email,
            set: {
                docAppPatientId: (0, drizzle_orm_1.sql) `excluded.doc_app_patient_id`,
                zohoContactId: (0, drizzle_orm_1.sql) `COALESCE(excluded.zoho_contact_id, customers.zoho_contact_id)`,
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
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
            await db_1.db
                .insert(db_1.supplyTracking)
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
                target: db_1.supplyTracking.sourceId,
                set: {
                    supplyIntervalTotal: (0, drizzle_orm_1.sql) `excluded.supply_interval_total`,
                    supplyUsedInterval: (0, drizzle_orm_1.sql) `excluded.supply_used_interval`,
                    supplyRemainingInterval: (0, drizzle_orm_1.sql) `excluded.supply_remaining_interval`,
                    supplyRemainingRepeats: (0, drizzle_orm_1.sql) `excluded.supply_remaining_repeats`,
                    syncedAt: (0, drizzle_orm_1.sql) `now()`,
                },
            });
            supplyCount += batch.length;
        }
        console.log(`[docapp-sync] supply_tracking upserted: ${supplyCount}`);
    }
    catch (e) {
        console.warn(`[docapp-sync] supply_tracking sync failed (skipping): ${e.message}`);
    }
    // ── 3. Cart sessions ─────────────────────────────────────────────────────────
    try {
        const sessions = await fetchCartSessions();
        console.log(`[docapp-sync] fetched ${sessions.length} cart sessions`);
        let sessionCount = 0;
        for (let i = 0; i < sessions.length; i += BATCH) {
            const batch = sessions.slice(i, i + BATCH);
            await db_1.db
                .insert(db_1.cartSessions)
                .values(batch.map((r) => ({
                sourceId: r.id,
                email: r.email,
                isConverted: r.is_converted,
                isDeleted: r.is_deleted,
                sourceCreatedAt: r.created_at,
            })))
                .onConflictDoUpdate({
                target: db_1.cartSessions.sourceId,
                set: {
                    isConverted: (0, drizzle_orm_1.sql) `excluded.is_converted`,
                    isDeleted: (0, drizzle_orm_1.sql) `excluded.is_deleted`,
                    syncedAt: (0, drizzle_orm_1.sql) `now()`,
                },
            });
            sessionCount += batch.length;
        }
        console.log(`[docapp-sync] cart_sessions upserted: ${sessionCount}`);
    }
    catch (e) {
        console.warn(`[docapp-sync] cart_sessions sync failed (skipping): ${e.message}`);
    }
    // ── 4. Orders dispatched ─────────────────────────────────────────────────────
    try {
        const orders = await fetchOrdersDispatched();
        console.log(`[docapp-sync] fetched ${orders.length} orders`);
        let orderCount = 0;
        for (let i = 0; i < orders.length; i += BATCH) {
            const batch = orders.slice(i, i + BATCH);
            await db_1.db
                .insert(db_1.ordersDispatched)
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
                target: db_1.ordersDispatched.sourceId,
                set: {
                    orderTotal: (0, drizzle_orm_1.sql) `excluded.order_total`,
                    orderDate: (0, drizzle_orm_1.sql) `excluded.order_date`,
                    weight22: (0, drizzle_orm_1.sql) `excluded.weight_22`,
                    weight26: (0, drizzle_orm_1.sql) `excluded.weight_26`,
                    weight29: (0, drizzle_orm_1.sql) `excluded.weight_29`,
                    syncedAt: (0, drizzle_orm_1.sql) `now()`,
                },
            });
            orderCount += batch.length;
        }
        console.log(`[docapp-sync] orders_dispatched upserted: ${orderCount}`);
    }
    catch (e) {
        console.warn(`[docapp-sync] orders_dispatched sync failed (skipping): ${e.message}`);
    }
    await db_1.db.insert(db_1.reconciliationLog).values({
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
exports.handler = handler;
if (require.main === module) {
    void (0, exports.handler)({}, {}, () => { });
}
//# sourceMappingURL=doc-app.js.map
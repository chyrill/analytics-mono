"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const db_1 = require("@analytics/db");
const drizzle_orm_1 = require("drizzle-orm");
const SALEOR_CUSTOMERS_GQL = `
  query Customers($after: String) {
    customers(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          email
          firstName
          lastName
          dateJoined
        }
      }
    }
  }
`;
const SALEOR_ORDERS_GQL = `
  query Orders($after: String) {
    orders(first: 100, after: $after, filter: { paymentStatus: FULLY_CHARGED }) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          created
          userEmail
          lines {
            quantity
            variant { weight { value unit } }
          }
        }
      }
    }
  }
`;
async function gqlFetch(query, variables) {
    const endpoint = process.env.SALEOR_API_URL ?? "";
    const token = process.env.SALEOR_API_TOKEN;
    if (!token)
        throw new Error("SALEOR_API_TOKEN not set");
    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok)
        throw new Error(`Saleor HTTP ${res.status}`);
    const json = (await res.json());
    return json.data;
}
async function fetchAllSaleorCustomers() {
    const results = [];
    let cursor = null;
    for (;;) {
        const resp = await gqlFetch(SALEOR_CUSTOMERS_GQL, { after: cursor });
        for (const { node } of resp.customers.edges)
            results.push(node);
        if (!resp.customers.pageInfo.hasNextPage)
            break;
        cursor = resp.customers.pageInfo.endCursor;
    }
    return results;
}
async function fetchAllSaleorOrders() {
    const results = [];
    let cursor = null;
    for (;;) {
        const resp = await gqlFetch(SALEOR_ORDERS_GQL, { after: cursor });
        for (const { node } of resp.orders.edges)
            results.push(node);
        if (!resp.orders.pageInfo.hasNextPage)
            break;
        cursor = resp.orders.pageInfo.endCursor;
    }
    return results;
}
const BATCH = 500;
const handler = async (_event) => {
    console.log("[saleor-sync] starting");
    // ── 1. Customers ─────────────────────────────────────────────────────────────
    const saleorCustomers = await fetchAllSaleorCustomers();
    console.log(`[saleor-sync] fetched ${saleorCustomers.length} customers`);
    let reconciled = 0;
    for (let i = 0; i < saleorCustomers.length; i += BATCH) {
        const batch = saleorCustomers.slice(i, i + BATCH);
        await db_1.db
            .insert(db_1.customers)
            .values(batch.map((sc) => ({
            email: sc.email.toLowerCase().trim(),
            name: [sc.firstName, sc.lastName].filter(Boolean).join(" ") || null,
            saleorCustomerId: sc.id,
            reconciliationStatus: "gap",
        })))
            .onConflictDoUpdate({
            target: db_1.customers.email,
            set: {
                saleorCustomerId: (0, drizzle_orm_1.sql) `excluded.saleor_customer_id`,
                reconciliationStatus: (0, drizzle_orm_1.sql) `CASE
            WHEN customers.zoho_contact_id IS NOT NULL
              AND customers.doc_app_patient_id IS NOT NULL THEN 'matched'
            WHEN customers.zoho_contact_id IS NOT NULL
              OR  customers.doc_app_patient_id IS NOT NULL THEN 'gap'
            ELSE 'gap'
          END`,
                updatedAt: (0, drizzle_orm_1.sql) `now()`,
            },
        });
        reconciled += batch.length;
    }
    console.log(`[saleor-sync] customers reconciled: ${reconciled}`);
    // ── 2. Orders (fully-charged, with product weight) ────────────────────────
    const rawOrders = await fetchAllSaleorOrders();
    console.log(`[saleor-sync] fetched ${rawOrders.length} orders`);
    // Only store orders that actually carried grams
    const orderRows = rawOrders.flatMap((node) => {
        const email = node.userEmail?.toLowerCase().trim();
        if (!email)
            return [];
        const totalGrams = (node.lines ?? []).reduce((sum, l) => {
            const w = l.variant?.weight;
            if (!w)
                return sum;
            const g = w.unit?.toUpperCase() === "KG" ? w.value * 1000 : w.value;
            return sum + g * (l.quantity || 1);
        }, 0);
        if (totalGrams <= 0)
            return [];
        return [{ sourceId: node.id, email, totalGrams: String(totalGrams), orderedAt: new Date(node.created) }];
    });
    console.log(`[saleor-sync] ${orderRows.length} orders with grams`);
    let orderCount = 0;
    for (let i = 0; i < orderRows.length; i += BATCH) {
        const batch = orderRows.slice(i, i + BATCH);
        await db_1.db
            .insert(db_1.saleorOrders)
            .values(batch)
            .onConflictDoUpdate({
            target: db_1.saleorOrders.sourceId,
            set: {
                totalGrams: (0, drizzle_orm_1.sql) `excluded.total_grams`,
                orderedAt: (0, drizzle_orm_1.sql) `excluded.ordered_at`,
                syncedAt: (0, drizzle_orm_1.sql) `now()`,
            },
        });
        orderCount += batch.length;
    }
    console.log(`[saleor-sync] orders upserted: ${orderCount}`);
    console.log("[saleor-sync] done");
};
exports.handler = handler;
if (require.main === module) {
    void (0, exports.handler)({}, {}, () => { });
}
//# sourceMappingURL=saleor.js.map
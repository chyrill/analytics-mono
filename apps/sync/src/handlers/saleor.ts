import type { ScheduledHandler } from "aws-lambda";
import { db, customers, saleorOrders } from "@analytics/db";
import { sql } from "drizzle-orm";

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

interface SaleorCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dateJoined: string;
}

interface SaleorOrderNode {
  id: string;
  created: string;
  userEmail: string;
  lines: { quantity: number; variant: { weight: { value: number; unit: string } | null } | null }[];
}

async function gqlFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const endpoint = process.env.SALEOR_API_URL ?? "";
  const token    = process.env.SALEOR_API_TOKEN;
  if (!token) throw new Error("SALEOR_API_TOKEN not set");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Saleor HTTP ${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

type CustomerPageResult = { customers: { edges: { node: SaleorCustomer }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };
type OrderPageResult    = { orders:    { edges: { node: SaleorOrderNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };

async function fetchAllSaleorCustomers(): Promise<SaleorCustomer[]> {
  const results: SaleorCustomer[] = [];
  let cursor: string | null = null;
  for (;;) {
    const resp: CustomerPageResult = await gqlFetch<CustomerPageResult>(SALEOR_CUSTOMERS_GQL, { after: cursor });
    for (const { node } of resp.customers.edges) results.push(node);
    if (!resp.customers.pageInfo.hasNextPage) break;
    cursor = resp.customers.pageInfo.endCursor;
  }
  return results;
}

async function fetchAllSaleorOrders(): Promise<SaleorOrderNode[]> {
  const results: SaleorOrderNode[] = [];
  let cursor: string | null = null;
  for (;;) {
    const resp: OrderPageResult = await gqlFetch<OrderPageResult>(SALEOR_ORDERS_GQL, { after: cursor });
    for (const { node } of resp.orders.edges) results.push(node);
    if (!resp.orders.pageInfo.hasNextPage) break;
    cursor = resp.orders.pageInfo.endCursor;
  }
  return results;
}

const BATCH = 500;

export const handler: ScheduledHandler = async (_event) => {
  console.log("[saleor-sync] starting");

  // ── 1. Customers ─────────────────────────────────────────────────────────────
  const saleorCustomers = await fetchAllSaleorCustomers();
  console.log(`[saleor-sync] fetched ${saleorCustomers.length} customers`);
  let reconciled = 0;
  for (let i = 0; i < saleorCustomers.length; i += BATCH) {
    const batch = saleorCustomers.slice(i, i + BATCH);
    await db
      .insert(customers)
      .values(batch.map((sc) => ({
        email: sc.email.toLowerCase().trim(),
        name: [sc.firstName, sc.lastName].filter(Boolean).join(" ") || null,
        saleorCustomerId: sc.id,
        reconciliationStatus: "gap",
      })))
      .onConflictDoUpdate({
        target: customers.email,
        set: {
          saleorCustomerId: sql`excluded.saleor_customer_id`,
          reconciliationStatus: sql`CASE
            WHEN customers.zoho_contact_id IS NOT NULL
              AND customers.doc_app_patient_id IS NOT NULL THEN 'matched'
            WHEN customers.zoho_contact_id IS NOT NULL
              OR  customers.doc_app_patient_id IS NOT NULL THEN 'gap'
            ELSE 'gap'
          END`,
          updatedAt: sql`now()`,
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
    if (!email) return [];
    const totalGrams = (node.lines ?? []).reduce((sum, l) => {
      const w = l.variant?.weight;
      if (!w) return sum;
      const g = w.unit?.toUpperCase() === "KG" ? w.value * 1000 : w.value;
      return sum + g * (l.quantity || 1);
    }, 0);
    if (totalGrams <= 0) return [];
    return [{ sourceId: node.id, email, totalGrams: String(totalGrams), orderedAt: new Date(node.created) }];
  });
  console.log(`[saleor-sync] ${orderRows.length} orders with grams`);

  let orderCount = 0;
  for (let i = 0; i < orderRows.length; i += BATCH) {
    const batch = orderRows.slice(i, i + BATCH);
    await db
      .insert(saleorOrders)
      .values(batch)
      .onConflictDoUpdate({
        target: saleorOrders.sourceId,
        set: {
          totalGrams: sql`excluded.total_grams`,
          orderedAt:  sql`excluded.ordered_at`,
          syncedAt:   sql`now()`,
        },
      });
    orderCount += batch.length;
  }
  console.log(`[saleor-sync] orders upserted: ${orderCount}`);
  console.log("[saleor-sync] done");
};

if (require.main === module) {
  void handler({} as never, {} as never, () => {});
}

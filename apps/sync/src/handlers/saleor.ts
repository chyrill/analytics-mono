import type { ScheduledHandler } from "aws-lambda";
import { db, customers, saleorOrders } from "@analytics/db";
import { sql } from "drizzle-orm";

const SALEOR_CUSTOMERS_GQL = `
  query Customers($after: String) {
    customers(first: 50, after: $after) {
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
    orders(first: 50, after: $after, filter: { paymentStatus: FULLY_CHARGED }) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          number
          created
          status
          userEmail
          weight { value }
          total {
            gross { amount currency }
          }
          metadata { key value }
          privateMetadata { key value }
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
  number: number;
  created: string;
  status: string;
  userEmail: string;
  weight: { value: number } | null;
  total: { gross: { amount: number; currency: string } } | null;
  metadata: { key: string; value: string }[];
  privateMetadata: { key: string; value: string }[];
}

// ── Rate-limiting / back-off helpers ─────────────────────────────────────────

/** Pause between pages — keeps Saleor's ECS container from being overwhelmed. */
const PAGE_DELAY_MS = 300;
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential back-off with ±25% jitter. */
function backoffDelay(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5);
}

/** True for errors where retrying may succeed (rate-limit, transient server fault). */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function gqlFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const endpoint = process.env.SALEOR_API_URL ?? "";
  const token = process.env.SALEOR_API_TOKEN;
  if (!token) throw new Error("SALEOR_API_TOKEN not set");

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      // Network-level error (ECONNRESET, timeout, etc.)
      if (attempt === MAX_RETRIES) throw err;
      const delay = backoffDelay(attempt);
      console.warn(`[saleor-sync] network error attempt ${attempt + 1}/${MAX_RETRIES + 1}, retry in ${Math.round(delay)}ms`);
      await sleep(delay);
      continue;
    }

    if (isRetryable(res.status)) {
      if (attempt === MAX_RETRIES) throw new Error(`Saleor HTTP ${res.status} after ${MAX_RETRIES + 1} attempts`);
      const retryAfterHeader = res.headers.get("Retry-After");
      const delay = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1_000
        : backoffDelay(attempt);
      console.warn(`[saleor-sync] HTTP ${res.status} attempt ${attempt + 1}/${MAX_RETRIES + 1}, retry in ${Math.round(delay)}ms`);
      await sleep(delay);
      continue;
    }

    if (!res.ok) throw new Error(`Saleor HTTP ${res.status}`);
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  /* istanbul ignore next */
  throw new Error("unreachable");
}

type CustomerPageResult = { customers: { edges: { node: SaleorCustomer }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };
type OrderPageResult = { orders: { edges: { node: SaleorOrderNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string } } };

async function fetchAllSaleorCustomers(): Promise<SaleorCustomer[]> {
  const results: SaleorCustomer[] = [];
  let cursor: string | null = null;
  let page = 0;
  for (; ;) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    const resp: CustomerPageResult = await gqlFetch<CustomerPageResult>(SALEOR_CUSTOMERS_GQL, { after: cursor });
    for (const { node } of resp.customers.edges) results.push(node);
    if (!resp.customers.pageInfo.hasNextPage) break;
    cursor = resp.customers.pageInfo.endCursor;
    page++;
  }
  console.log(`[saleor-sync] customers: ${page + 1} pages fetched`);
  return results;
}

async function fetchAllSaleorOrders(): Promise<SaleorOrderNode[]> {
  const results: SaleorOrderNode[] = [];
  let cursor: string | null = null;
  let page = 0;
  for (; ;) {
    if (page > 0) await sleep(PAGE_DELAY_MS);
    const resp: OrderPageResult = await gqlFetch<OrderPageResult>(SALEOR_ORDERS_GQL, { after: cursor });
    for (const { node } of resp.orders.edges) results.push(node);
    if (!resp.orders.pageInfo.hasNextPage) break;
    cursor = resp.orders.pageInfo.endCursor;
    page++;
  }
  console.log(`[saleor-sync] orders: ${page + 1} pages fetched`);
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

  // ── 2. Orders (fully-charged) ─────────────────────────────────────────────
  const rawOrders = await fetchAllSaleorOrders();
  console.log(`[saleor-sync] fetched ${rawOrders.length} orders`);

  const orderRows = rawOrders.flatMap((node) => {
    const email = node.userEmail?.toLowerCase().trim();
    if (!email) return [];
    const totalGrams = node.weight?.value ?? null;
    const contactId = [...(node.metadata ?? []), ...(node.privateMetadata ?? [])]
      .find((m) => m.key === "contactId")?.value ?? null;
    return [{
      sourceId: node.id,
      email,
      orderNumber: node.number,
      status: node.status,
      totalGrams: totalGrams != null ? String(totalGrams) : null,
      totalAmount: node.total?.gross?.amount != null ? String(node.total.gross.amount) : null,
      currency: node.total?.gross?.currency ?? null,
      contactId,
      orderedAt: new Date(node.created),
    }];
  });
  console.log(`[saleor-sync] ${orderRows.length} orders to upsert`);

  let orderCount = 0;
  for (let i = 0; i < orderRows.length; i += BATCH) {
    const batch = orderRows.slice(i, i + BATCH);
    await db
      .insert(saleorOrders)
      .values(batch)
      .onConflictDoUpdate({
        target: saleorOrders.sourceId,
        set: {
          status: sql`excluded.status`,
          totalGrams: sql`excluded.total_grams`,
          totalAmount: sql`excluded.total_amount`,
          currency: sql`excluded.currency`,
          contactId: sql`excluded.contact_id`,
          orderedAt: sql`excluded.ordered_at`,
          syncedAt: sql`now()`,
        },
      });
    orderCount += batch.length;
  }
  console.log(`[saleor-sync] orders upserted: ${orderCount}`);
  console.log("[saleor-sync] done");
};

if (require.main === module) {
  void handler({} as never, {} as never, () => { });
}

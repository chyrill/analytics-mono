import type { ScheduledHandler } from "aws-lambda";
import { db, customers, saleorOrders, saleorOrderLines, type NewSaleorOrderLine } from "@analytics/db";
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
          lines {
            id
            productName
            variantName
            quantity
            variant {
              id
              weight { value unit }
              attributes { attribute { name } values { name } }
              product {
                id
                attributes { attribute { name } values { name } }
              }
            }
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

interface SaleorAttributeValue {
  name: string;
}

interface SaleorAttributeAssignment {
  attribute: { name: string };
  values: SaleorAttributeValue[];
}

interface SaleorOrderLineNode {
  id: string;
  productName: string;
  variantName: string;
  quantity: number;
  variant: {
    id: string;
    weight: { value: number; unit: string } | null;
    attributes: SaleorAttributeAssignment[];
    product: { id: string; attributes: SaleorAttributeAssignment[] } | null;
  } | null;
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
  lines: SaleorOrderLineNode[];
}

/** First attribute value matching a given attribute name (e.g. "Strain", "THC Level", "cut"). */
function findAttributeValue(attrs: SaleorAttributeAssignment[] | undefined, attributeName: string): string | null {
  return attrs?.find((a) => a.attribute.name === attributeName)?.values[0]?.name ?? null;
}

/**
 * Converts a Saleor Weight `{ value, unit }` to grams. Unlike Order.weight
 * (which Saleor auto-scales to a human-friendly display unit), ProductVariant.weight
 * is returned in the shop's raw configured unit (observed as KG in this store) —
 * so unit-aware conversion is required rather than trusting the raw value.
 */
const GRAMS_PER_UNIT: Record<string, number> = {
  G: 1,
  KG: 1000,
  LB: 453.59237,
  OZ: 28.349523125,
  TONNE: 1_000_000,
};

function weightToGrams(weight: { value: number; unit: string } | null | undefined): number | null {
  if (!weight) return null;
  const multiplier = GRAMS_PER_UNIT[weight.unit];
  if (multiplier == null) {
    console.warn(`[saleor-sync] unknown weight unit "${weight.unit}", skipping conversion`);
    return null;
  }
  return weight.value * multiplier;
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
  const endpoint = process.env.SALEOR_API_URL;
  if (!endpoint) throw new Error("SALEOR_API_URL not set");
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

  const orderRows: (typeof saleorOrders.$inferInsert)[] = [];
  // Line items are captured alongside the order rollup — denormalized at sync
  // time (product/variant attributes snapshotted now) rather than joined live
  // from a products table, so historical strain/THC data survives later
  // re-tagging in Saleor. See docs/customer-health-index-deep-dive.md §2.1.
  const lineRows: NewSaleorOrderLine[] = [];

  for (const node of rawOrders) {
    const email = node.userEmail?.toLowerCase().trim();
    if (!email) continue; // skip lines too — FK requires the parent order to exist
    const totalGrams = node.weight?.value ?? null;
    const contactId = [...(node.metadata ?? []), ...(node.privateMetadata ?? [])]
      .find((m) => m.key === "contactId")?.value ?? null;

    orderRows.push({
      sourceId: node.id,
      email,
      orderNumber: node.number,
      status: node.status,
      totalGrams: totalGrams != null ? String(totalGrams) : null,
      totalAmount: node.total?.gross?.amount != null ? String(node.total.gross.amount) : null,
      currency: node.total?.gross?.currency ?? null,
      contactId,
      orderedAt: new Date(node.created),
    });

    for (const line of node.lines ?? []) {
      const variant = line.variant;
      const unitGrams = weightToGrams(variant?.weight);
      lineRows.push({
        id: line.id,
        orderId: node.id,
        productId: variant?.product?.id ?? null,
        productName: line.productName,
        variantId: variant?.id ?? null,
        variantName: line.variantName,
        strain: findAttributeValue(variant?.product?.attributes, "Strain"),
        thcLevel: findAttributeValue(variant?.product?.attributes, "THC Level"),
        cut: findAttributeValue(variant?.attributes, "cut"),
        grams: unitGrams != null ? String(unitGrams * line.quantity) : null,
        quantity: line.quantity,
      });
    }
  }
  console.log(`[saleor-sync] ${orderRows.length} orders / ${lineRows.length} order lines to upsert`);

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

  let lineCount = 0;
  for (let i = 0; i < lineRows.length; i += BATCH) {
    const batch = lineRows.slice(i, i + BATCH);
    await db
      .insert(saleorOrderLines)
      .values(batch)
      .onConflictDoUpdate({
        target: saleorOrderLines.id,
        set: {
          orderId: sql`excluded.order_id`,
          productId: sql`excluded.product_id`,
          productName: sql`excluded.product_name`,
          variantId: sql`excluded.variant_id`,
          variantName: sql`excluded.variant_name`,
          strain: sql`excluded.strain`,
          thcLevel: sql`excluded.thc_level`,
          cut: sql`excluded.cut`,
          grams: sql`excluded.grams`,
          quantity: sql`excluded.quantity`,
          syncedAt: sql`now()`,
        },
      });
    lineCount += batch.length;
  }
  console.log(`[saleor-sync] order lines upserted: ${lineCount}`);
  console.log("[saleor-sync] done");
};

if (require.main === module) {
  void handler({} as never, {} as never, () => { });
}

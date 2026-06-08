import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as customersSchema from "./schema/customers";
import * as funnelEventsSchema from "./schema/funnel-events";
import * as zohoContactsSchema from "./schema/zoho-contacts";
import * as reconciliationLogSchema from "./schema/reconciliation-log";
import * as supplyTrackingSchema from "./schema/supply-tracking";
import * as cartSessionsSchema from "./schema/cart-sessions";
import * as ordersDispatchedSchema from "./schema/orders-dispatched";
import * as saleorOrdersSchema from "./schema/saleor-orders";

import * as zohoDealsSchema from "./schema/zoho-deals";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const client = postgres(connectionString, {
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
});

const schema = {
  ...customersSchema,
  ...funnelEventsSchema,
  ...zohoContactsSchema,
  ...reconciliationLogSchema,
  ...supplyTrackingSchema,
  ...cartSessionsSchema,
  ...ordersDispatchedSchema,
  ...saleorOrdersSchema,
  ...zohoDealsSchema,
};

export const db = drizzle(client, { schema });

export * from "./schema/customers";
export * from "./schema/funnel-events";
export * from "./schema/zoho-contacts";
export * from "./schema/supply-tracking";
export * from "./schema/cart-sessions";
export * from "./schema/orders-dispatched";
export * from "./schema/saleor-orders";
export * from "./schema/reconciliation-log";
export * from "./schema/zoho-deals";

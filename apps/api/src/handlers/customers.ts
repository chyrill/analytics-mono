import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db, customers } from "@analytics/db";
import { desc, count, sql } from "drizzle-orm";

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  try {
    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit ?? "2000", 10),
      10000,
    );
    const offset = parseInt(event.queryStringParameters?.offset ?? "0", 10);
    const status = event.queryStringParameters?.status;

    const whereClause = status
      ? sql`WHERE reconciliation_status = ${status}`
      : sql``;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(customers)
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(customers),
    ]);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ rows, total, limit, offset }),
    };
  } catch (err) {
    console.error("[customers]", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};

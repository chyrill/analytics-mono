import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { db, syncJobs, syncCheckpoints } from "@analytics/db";
import { eq, desc } from "drizzle-orm";

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? "ap-southeast-2" });

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const WORKER_MAP: Record<string, string> = {
  zoho: `harvest-analytics-sync-zoho-${process.env.STAGE ?? "production"}`,
  saleor: `harvest-analytics-sync-saleor-${process.env.STAGE ?? "production"}`,
  docapp: `harvest-analytics-sync-doc-app-${process.env.STAGE ?? "production"}`,
  db: `harvest-analytics-sync-doc-app-${process.env.STAGE ?? "production"}`,
};

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  const routeKey = event.routeKey ?? "";
  const params = event.pathParameters ?? {};

  try {
    // GET /sync/checkpoints
    if (routeKey === "GET /sync/checkpoints") {
      const source = event.queryStringParameters?.source;
      const rows = source
        ? await db.select().from(syncCheckpoints).where(eq(syncCheckpoints.source, source))
        : await db.select().from(syncCheckpoints);
      return ok(rows);
    }

    // GET /sync/jobs/{jobId}
    if (routeKey === "GET /sync/jobs/{jobId}") {
      const jobId = params.jobId;
      if (!jobId) return err("Missing jobId");
      const [job] = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId));
      if (!job) return err("Job not found", 404);
      return ok(job);
    }

    // POST /sync/{source}
    if (routeKey === "POST /sync/{source}") {
      const source = params.source;
      if (!source || !WORKER_MAP[source]) return err(`Unknown sync source: ${source}`);

      // Create a sync job record
      const [job] = await db
        .insert(syncJobs)
        .values({ source, mode: "full", status: "queued" })
        .returning();

      // Invoke worker Lambda asynchronously (fire-and-forget)
      try {
        await lambda.send(new InvokeCommand({
          FunctionName: WORKER_MAP[source],
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ jobId: job.id })),
        }));
        await db.update(syncJobs).set({ status: "running", startedAt: new Date() }).where(eq(syncJobs.id, job.id));
      } catch (invokeErr) {
        console.error("[sync] Failed to invoke worker:", invokeErr);
        await db.update(syncJobs).set({ status: "failed", errorMessage: String(invokeErr) }).where(eq(syncJobs.id, job.id));
        return err("Failed to trigger sync", 500);
      }

      return ok({ ...job, status: "running" }, 202);
    }

    return err("Not found", 404);
  } catch (e) {
    console.error("[sync]", e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};

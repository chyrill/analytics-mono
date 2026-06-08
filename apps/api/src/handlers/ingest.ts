import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { db, funnelEvents } from "@analytics/db";

interface IngestBody {
  sessionId?: string;
  eventName?: string;
  email?: string;
  properties?: Record<string, unknown>;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const body = JSON.parse(event.body ?? "{}") as IngestBody;

    if (!body.sessionId || !body.eventName) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
        body: JSON.stringify({ error: "sessionId and eventName are required" }),
      };
    }

    await db.insert(funnelEvents).values({
      sessionId: body.sessionId,
      eventName: body.eventName,
      email: body.email ?? null,
      properties: body.properties ?? {},
    });

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("[ingest]", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};

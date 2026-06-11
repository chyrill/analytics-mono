import type { ScheduledHandler } from "aws-lambda";
import {
  db,
  zohoContacts, zohoDeals, zohoEvents,
  customers,
  syncJobs, syncCheckpoints,
} from "@analytics/db";
import { eq, and } from "drizzle-orm";

const ZOHO_API_BASE =
  process.env.ZOHO_API_BASE ?? "https://www.zohoapis.com.au/crm/v6";

const CONTACT_FIELDS = [
  "id", "First_Name", "Last_Name", "Email", "Mobile", "Phone",
  "Member_Status", "Supply_Date_1", "Supply_Expiration", "Order_Date",
  "Total_Deals_Orders_Paid", "Consent_Form_Completed", "Patient_Age",
  "AD_Usecase", "Created_Time", "Modified_Time",
].join(",");

const DEAL_FIELDS = [
  "id", "Deal_Name", "Stage", "Amount", "Probability",
  "Closing_Date", "Lead_Source", "Contact_Name", "Created_Time", "Modified_Time",
].join(",");

const CALL_FIELDS = [
  "id", "Subject", "Call_Type", "Call_Result", "Call_Duration",
  "Description", "Who_Id", "Created_Time", "Modified_Time",
].join(",");

const TASK_FIELDS = [
  "id", "Subject", "Due_Date", "Status", "Priority",
  "Description", "Who_Id", "Created_Time", "Modified_Time",
].join(",");

const EVENT_FIELDS = [
  "id", "Event_Title", "Start_DateTime", "End_DateTime", "Duration_Min_Sec",
  "Description", "Who_Id", "Created_Time", "Modified_Time",
].join(",");

const ACTIVITY_MODULES = [
  { module: "Calls", entity: "calls", fields: CALL_FIELDS },
  { module: "Tasks", entity: "tasks", fields: TASK_FIELDS },
  { module: "Events", entity: "events", fields: EVENT_FIELDS },
] as const;

async function getZohoAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID ?? "",
    client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? "",
  });

  const res = await fetch("https://accounts.zoho.com.au/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Zoho token refresh failed: ${res.status}`);
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Zoho token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

interface ZohoContactRecord {
  id: string;
  Email?: string | null;
  First_Name?: string | null;
  Last_Name?: string | null;
  Mobile?: string | null;
  Phone?: string | null;
  Member_Status?: string | null;
  Supply_Date_1?: string | null;
  Supply_Expiration?: string | null;
  Order_Date?: string | null;
  Total_Deals_Orders_Paid?: number | string | null;
  Consent_Form_Completed?: boolean | null;
  Patient_Age?: number | string | null;
  AD_Usecase?: string | null;
  Created_Time?: string | null;
  Modified_Time?: string | null;
}

interface ZohoDealRecord {
  id: string;
  Deal_Name?: string | null;
  Stage?: string | null;
  Amount?: number | string | null;
  Probability?: number | string | null;
  Closing_Date?: string | null;
  Lead_Source?: string | null;
  Contact_Name?: { name: string; id: string } | null;
  Created_Time?: string | null;
  Modified_Time?: string | null;
}

interface ZohoActivityRecord {
  id: string;
  Subject?: string | null;
  Event_Title?: string | null;
  Description?: string | null;
  Status?: string | null;
  Priority?: string | null;
  Due_Date?: string | null;
  Start_DateTime?: string | null;
  End_DateTime?: string | null;
  Duration_Min_Sec?: string | null;
  Call_Type?: string | null;
  Call_Result?: string | null;
  Call_Duration?: string | null;
  Who_Id?: { id: string; name: string } | null;
  Created_Time?: string | null;
  Modified_Time?: string | null;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchAll<T>(token: string, module: string, fields: string): Promise<T[]> {
  const records: T[] = [];
  let pageToken: string | null = null;
  let page = 1;

  for (; ;) {
    const url = pageToken
      ? `${ZOHO_API_BASE}/${module}?fields=${fields}&page_token=${encodeURIComponent(pageToken)}&per_page=200`
      : `${ZOHO_API_BASE}/${module}?fields=${fields}&page=${page}&per_page=200`;

    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });

    // 204 or empty body = no records for this module
    if (res.status === 204) break;

    const text = await res.text();
    if (!text.trim()) break;

    if (!res.ok) {
      throw new Error(`Zoho ${module} fetch failed: ${res.status} — ${text.slice(0, 300)}`);
    }

    let data: { data?: T[]; info?: { more_records: boolean; next_page_token?: string | null }; code?: string; message?: string };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error(`Zoho ${module} returned non-JSON: ${text.slice(0, 300)}`);
    }

    if (data.code === "NO_DATA") break;
    if (data.code && data.code !== "SUCCESS") throw new Error(`Zoho ${module} error: ${data.message}`);
    if (!data.data?.length) break;
    records.push(...data.data);
    if (!data.info?.more_records) break;
    pageToken = data.info.next_page_token ?? null;
    if (!pageToken) page++;
  }
  return records;
}

/** Incremental fetch via search API — only records modified after `since`. */
async function fetchIncremental<T>(token: string, module: string, fields: string, since: Date): Promise<T[]> {
  const records: T[] = [];
  const sinceStr = since.toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const criteria = encodeURIComponent(`(Modified_Time:greater_than:${sinceStr})`);
  let page = 1;

  for (; ;) {
    const url = `${ZOHO_API_BASE}/${module}/search?criteria=${criteria}&fields=${fields}&page=${page}&per_page=200`;
    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });

    if (res.status === 204) break; // No matching records

    const text = await res.text();
    if (!text.trim()) break;

    if (!res.ok) {
      throw new Error(`Zoho ${module} incremental fetch failed: ${res.status} — ${text.slice(0, 300)}`);
    }

    let data: { data?: T[]; info?: { more_records: boolean }; code?: string; message?: string };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error(`Zoho ${module} returned non-JSON: ${text.slice(0, 300)}`);
    }

    if (data.code === "NO_DATA") break;
    if (data.code && data.code !== "SUCCESS") throw new Error(`Zoho ${module} search error: ${data.message}`);
    if (!data.data?.length) break;
    records.push(...data.data);
    if (!data.info?.more_records) break;
    page++;
  }
  return records;
}

// ── Checkpoint helpers ────────────────────────────────────────────────────────

async function getCheckpoint(source: string, entity: string): Promise<{ lastSyncedAt: Date } | null> {
  const rows = await db
    .select()
    .from(syncCheckpoints)
    .where(and(eq(syncCheckpoints.source, source), eq(syncCheckpoints.entity, entity)))
    .limit(1);
  return rows[0] ?? null;
}

async function writeCheckpoint(source: string, entity: string, jobId: string, syncedAt: Date): Promise<void> {
  await db
    .insert(syncCheckpoints)
    .values({ source, entity, lastSyncedAt: syncedAt, lastJobId: jobId })
    .onConflictDoUpdate({
      target: [syncCheckpoints.source, syncCheckpoints.entity],
      set: { lastSyncedAt: syncedAt, lastJobId: jobId },
    });
}

// ── Email map helper ──────────────────────────────────────────────────────────

async function resolveEmail(contactId: string | null, emailMap: Map<string, string>): Promise<string | null> {
  if (!contactId) return null;
  const cached = emailMap.get(contactId);
  if (cached) return cached;
  const rows = await db
    .select({ email: zohoContacts.email })
    .from(zohoContacts)
    .where(eq(zohoContacts.id, contactId))
    .limit(1);
  const email = rows[0]?.email ?? null;
  if (email) emailMap.set(contactId, email);
  return email;
}

// ── Entity sync functions ─────────────────────────────────────────────────────

async function syncContacts(token: string, jobId: string): Promise<{ fetched: number; upserted: number; emailMap: Map<string, string> }> {
  const syncStart = new Date();
  const checkpoint = await getCheckpoint("zoho", "contacts");
  const records = checkpoint
    ? await fetchIncremental<ZohoContactRecord>(token, "Contacts", CONTACT_FIELDS, checkpoint.lastSyncedAt)
    : await fetchAll<ZohoContactRecord>(token, "Contacts", CONTACT_FIELDS);

  console.log(`[zoho-sync] contacts fetched: ${records.length} (${checkpoint ? "incremental" : "full"})`);

  const emailMap = new Map<string, string>();
  let upserted = 0;

  for (const c of records) {
    const email = c.Email?.toLowerCase().trim() ?? null;
    if (email && c.id) emailMap.set(c.id, email);

    await db.insert(zohoContacts).values({
      id: c.id,
      email,
      firstName: c.First_Name ?? null,
      lastName: c.Last_Name ?? null,
      phone: c.Mobile ?? c.Phone ?? null,
      memberStatus: c.Member_Status ?? null,
      supplyDate: c.Supply_Date_1 ?? null,
      supplyExpiration: c.Supply_Expiration ?? null,
      orderDate: c.Order_Date ?? null,
      totalOrdersPaid: c.Total_Deals_Orders_Paid ? parseInt(String(c.Total_Deals_Orders_Paid)) : null,
      consentFormCompleted: c.Consent_Form_Completed ?? null,
      patientAge: c.Patient_Age ? parseInt(String(c.Patient_Age)) : null,
      adUsecase: c.AD_Usecase ?? null,
      createdAt: c.Created_Time ? new Date(c.Created_Time) : null,
      modifiedAt: c.Modified_Time ? new Date(c.Modified_Time) : null,
      raw: c as unknown as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: zohoContacts.id,
      set: {
        email,
        firstName: c.First_Name ?? null,
        lastName: c.Last_Name ?? null,
        phone: c.Mobile ?? c.Phone ?? null,
        memberStatus: c.Member_Status ?? null,
        supplyDate: c.Supply_Date_1 ?? null,
        supplyExpiration: c.Supply_Expiration ?? null,
        orderDate: c.Order_Date ?? null,
        totalOrdersPaid: c.Total_Deals_Orders_Paid ? parseInt(String(c.Total_Deals_Orders_Paid)) : null,
        consentFormCompleted: c.Consent_Form_Completed ?? null,
        patientAge: c.Patient_Age ? parseInt(String(c.Patient_Age)) : null,
        adUsecase: c.AD_Usecase ?? null,
        modifiedAt: c.Modified_Time ? new Date(c.Modified_Time) : null,
        raw: c as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      },
    });

    if (!email) { upserted++; continue; }
    const existing = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (existing.length > 0) {
      await db.update(customers).set({ zohoContactId: c.id, updatedAt: new Date() }).where(eq(customers.email, email));
    } else {
      await db.insert(customers).values({
        email,
        name: [c.First_Name, c.Last_Name].filter(Boolean).join(" ") || null,
        phone: c.Mobile ?? c.Phone ?? null,
        zohoContactId: c.id,
        reconciliationStatus: "gap",
      }).onConflictDoNothing();
    }
    upserted++;
  }

  await writeCheckpoint("zoho", "contacts", jobId, syncStart);
  return { fetched: records.length, upserted, emailMap };
}

async function syncDeals(token: string, jobId: string, emailMap: Map<string, string>): Promise<{ fetched: number; upserted: number }> {
  const syncStart = new Date();
  const checkpoint = await getCheckpoint("zoho", "deals");
  const records = checkpoint
    ? await fetchIncremental<ZohoDealRecord>(token, "Deals", DEAL_FIELDS, checkpoint.lastSyncedAt)
    : await fetchAll<ZohoDealRecord>(token, "Deals", DEAL_FIELDS);

  console.log(`[zoho-sync] deals fetched: ${records.length} (${checkpoint ? "incremental" : "full"})`);

  let upserted = 0;
  for (const d of records) {
    const contactId = d.Contact_Name?.id ?? null;
    const email = await resolveEmail(contactId, emailMap);

    await db.insert(zohoDeals).values({
      sourceId: d.id,
      contactId,
      email,
      dealName: d.Deal_Name ?? null,
      stage: d.Stage ?? null,
      amount: d.Amount != null ? String(d.Amount) : null,
      probability: d.Probability != null ? String(d.Probability) : null,
      leadSource: d.Lead_Source ?? null,
      closingDate: d.Closing_Date ?? null,
      createdAt: d.Created_Time ? new Date(d.Created_Time) : null,
      modifiedAt: d.Modified_Time ? new Date(d.Modified_Time) : null,
      raw: d as unknown as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: zohoDeals.sourceId,
      set: {
        contactId,
        email,
        dealName: d.Deal_Name ?? null,
        stage: d.Stage ?? null,
        amount: d.Amount != null ? String(d.Amount) : null,
        probability: d.Probability != null ? String(d.Probability) : null,
        leadSource: d.Lead_Source ?? null,
        closingDate: d.Closing_Date ?? null,
        modifiedAt: d.Modified_Time ? new Date(d.Modified_Time) : null,
        raw: d as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      },
    });
    upserted++;
  }

  await writeCheckpoint("zoho", "deals", jobId, syncStart);
  return { fetched: records.length, upserted };
}

async function syncActivityModule(
  token: string,
  jobId: string,
  module: string,
  entity: string,
  fields: string,
  emailMap: Map<string, string>,
): Promise<{ fetched: number; upserted: number }> {
  const syncStart = new Date();
  const checkpoint = await getCheckpoint("zoho", entity);
  const records = checkpoint
    ? await fetchIncremental<ZohoActivityRecord>(token, module, fields, checkpoint.lastSyncedAt)
    : await fetchAll<ZohoActivityRecord>(token, module, fields);

  console.log(`[zoho-sync] ${entity} fetched: ${records.length} (${checkpoint ? "incremental" : "full"})`);

  const activityType = module === "Calls" ? "Call" : module === "Tasks" ? "Task" : "Event";
  let upserted = 0;

  for (const a of records) {
    const contactId = a.Who_Id?.id ?? null;
    const contactEmail = await resolveEmail(contactId, emailMap);
    const subject = a.Event_Title ?? a.Subject ?? null;

    let durationMins: number | null = null;
    const rawDuration = a.Duration_Min_Sec ?? a.Call_Duration ?? null;
    if (rawDuration) {
      const parts = rawDuration.split(":").map(Number);
      if (parts.length >= 2) durationMins = parts[0] * 60 + parts[1];
    }

    await db.insert(zohoEvents).values({
      id: a.id,
      activityType,
      contactId,
      contactEmail,
      subject,
      description: a.Description ?? null,
      status: a.Status ?? null,
      priority: a.Priority ?? null,
      dueDate: a.Due_Date ? new Date(a.Due_Date) : null,
      startDatetime: a.Start_DateTime ? new Date(a.Start_DateTime) : null,
      endDatetime: a.End_DateTime ? new Date(a.End_DateTime) : null,
      durationMins,
      callDirection: a.Call_Type ?? null,
      callResult: a.Call_Result ?? null,
      createdAt: a.Created_Time ? new Date(a.Created_Time) : null,
      modifiedAt: a.Modified_Time ? new Date(a.Modified_Time) : null,
      raw: a as unknown as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: zohoEvents.id,
      set: {
        contactId,
        contactEmail,
        subject,
        description: a.Description ?? null,
        status: a.Status ?? null,
        priority: a.Priority ?? null,
        dueDate: a.Due_Date ? new Date(a.Due_Date) : null,
        startDatetime: a.Start_DateTime ? new Date(a.Start_DateTime) : null,
        endDatetime: a.End_DateTime ? new Date(a.End_DateTime) : null,
        durationMins,
        callDirection: a.Call_Type ?? null,
        callResult: a.Call_Result ?? null,
        modifiedAt: a.Modified_Time ? new Date(a.Modified_Time) : null,
        raw: a as unknown as Record<string, unknown>,
        syncedAt: new Date(),
      },
    });
    upserted++;
  }

  await writeCheckpoint("zoho", entity, jobId, syncStart);
  return { fetched: records.length, upserted };
}

// ── Main sync runner (exported for API-triggered use) ─────────────────────────

export async function runZohoSync(jobId: string): Promise<{ fetched: number; upserted: number }> {
  console.log(`[zoho-sync] job ${jobId} starting`);
  const token = await getZohoAccessToken();
  let totalFetched = 0, totalUpserted = 0;

  const contactsResult = await syncContacts(token, jobId);
  totalFetched += contactsResult.fetched; totalUpserted += contactsResult.upserted;
  console.log(`[zoho-sync] contacts done — fetched: ${contactsResult.fetched}, upserted: ${contactsResult.upserted}`);

  const dealsResult = await syncDeals(token, jobId, contactsResult.emailMap);
  totalFetched += dealsResult.fetched; totalUpserted += dealsResult.upserted;
  console.log(`[zoho-sync] deals done — fetched: ${dealsResult.fetched}, upserted: ${dealsResult.upserted}`);

  for (const { module, entity, fields } of ACTIVITY_MODULES) {
    const result = await syncActivityModule(token, jobId, module, entity, fields, contactsResult.emailMap);
    totalFetched += result.fetched; totalUpserted += result.upserted;
    console.log(`[zoho-sync] ${entity} done — fetched: ${result.fetched}, upserted: ${result.upserted}`);
  }

  console.log(`[zoho-sync] job ${jobId} complete — total fetched: ${totalFetched}, upserted: ${totalUpserted}`);
  return { fetched: totalFetched, upserted: totalUpserted };
}

// ── Scheduled Lambda handler (backward-compat) ────────────────────────────────

export const handler: ScheduledHandler = async (_event) => {
  console.log("[zoho-sync] starting via scheduled handler");

  const [job] = await db
    .insert(syncJobs)
    .values({
      source: "zoho",
      mode: "full",
      entities: ["contacts", "deals", "calls", "tasks", "events"],
      status: "running",
      startedAt: new Date(),
    })
    .returning();

  try {
    const { fetched, upserted } = await runZohoSync(job.id);
    await db.update(syncJobs).set({
      status: "completed", recordsFetched: fetched, recordsUpserted: upserted, completedAt: new Date(),
    }).where(eq(syncJobs.id, job.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[zoho-sync] job ${job.id} failed:`, msg);
    await db.update(syncJobs).set({ status: "failed", errorMessage: msg, completedAt: new Date() })
      .where(eq(syncJobs.id, job.id));
    throw err;
  }
};

// Allow direct invocation: `pnpm run:zoho`
void handler({} as never, {} as never, () => { });



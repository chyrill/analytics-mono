import type { ScheduledHandler } from "aws-lambda";
import { db, zohoContacts, zohoDeals, customers } from "@analytics/db";
import { eq } from "drizzle-orm";

const ZOHO_API_BASE = process.env.ZOHO_API_BASE ?? "https://www.zohoapis.com.au/crm/v6";

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

async function fetchAll<T>(token: string, module: string, fields: string): Promise<T[]> {
  const records: T[] = [];
  let pageToken: string | null = null;
  let page = 1;

  for (;;) {
    const url = pageToken
      ? `${ZOHO_API_BASE}/${module}?fields=${fields}&page_token=${encodeURIComponent(pageToken)}&per_page=200`
      : `${ZOHO_API_BASE}/${module}?fields=${fields}&page=${page}&per_page=200`;

    const res = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Zoho ${module} fetch failed: ${res.status} — ${body.slice(0, 300)}`);
    }
    const data = await res.json() as { data?: T[]; info?: { more_records: boolean; next_page_token?: string | null }; code?: string; message?: string };
    if (data.code && data.code !== "SUCCESS") throw new Error(`Zoho ${module} error: ${data.message}`);
    if (!data.data?.length) break;
    records.push(...data.data);
    if (!data.info?.more_records) break;
    pageToken = data.info.next_page_token ?? null;
    if (!pageToken) page++;
  }
  return records;
}

export const handler: ScheduledHandler = async (_event) => {
  console.log("[zoho-sync] starting");

  const token = await getZohoAccessToken();
  const contacts = await fetchAll<ZohoContactRecord>(token, "Contacts", CONTACT_FIELDS);
  console.log(`[zoho-sync] fetched ${contacts.length} contacts`);
  const deals = await fetchAll<ZohoDealRecord>(token, "Deals", DEAL_FIELDS);
  console.log(`[zoho-sync] fetched ${deals.length} deals`);

  // ── 1. Sync contacts ──────────────────────────────────────────────────────
  // Build contact id→email map for deal email denormalisation
  const contactEmailMap = new Map<string, string>();
  let contactsUpserted = 0;

  for (const c of contacts) {
    const email = c.Email?.toLowerCase().trim() ?? null;
    if (email && c.id) contactEmailMap.set(c.id, email);

    await db.insert(zohoContacts).values({
      id:                   c.id,
      email,
      firstName:            c.First_Name ?? null,
      lastName:             c.Last_Name ?? null,
      phone:                c.Mobile ?? c.Phone ?? null,
      memberStatus:         c.Member_Status ?? null,
      supplyDate:           c.Supply_Date_1 ?? null,
      supplyExpiration:     c.Supply_Expiration ?? null,
      orderDate:            c.Order_Date ?? null,
      totalOrdersPaid:      c.Total_Deals_Orders_Paid ? parseInt(String(c.Total_Deals_Orders_Paid)) : null,
      consentFormCompleted: c.Consent_Form_Completed ?? null,
      patientAge:           c.Patient_Age ? parseInt(String(c.Patient_Age)) : null,
      adUsecase:            c.AD_Usecase ?? null,
      createdAt:            c.Created_Time ? new Date(c.Created_Time) : null,
      modifiedAt:           c.Modified_Time ? new Date(c.Modified_Time) : null,
      raw:                  c as unknown as Record<string, unknown>,
    }).onConflictDoUpdate({
      target: zohoContacts.id,
      set: {
        email,
        firstName:            c.First_Name ?? null,
        lastName:             c.Last_Name ?? null,
        phone:                c.Mobile ?? c.Phone ?? null,
        memberStatus:         c.Member_Status ?? null,
        supplyDate:           c.Supply_Date_1 ?? null,
        supplyExpiration:     c.Supply_Expiration ?? null,
        orderDate:            c.Order_Date ?? null,
        totalOrdersPaid:      c.Total_Deals_Orders_Paid ? parseInt(String(c.Total_Deals_Orders_Paid)) : null,
        consentFormCompleted: c.Consent_Form_Completed ?? null,
        patientAge:           c.Patient_Age ? parseInt(String(c.Patient_Age)) : null,
        adUsecase:            c.AD_Usecase ?? null,
        modifiedAt:           c.Modified_Time ? new Date(c.Modified_Time) : null,
        raw:                  c as unknown as Record<string, unknown>,
        syncedAt:             new Date(),
      },
    });
    contactsUpserted++;

    // Reconcile into customers master record
    if (!email) continue;
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
  }

  // ── 2. Sync deals ─────────────────────────────────────────────────────────
  let dealsUpserted = 0;
  for (const d of deals) {
    const contactId = d.Contact_Name?.id ?? null;
    const email = contactId ? (contactEmailMap.get(contactId) ?? null) : null;

    await db.insert(zohoDeals).values({
      sourceId:    d.id,
      contactId,
      email,
      dealName:    d.Deal_Name ?? null,
      stage:       d.Stage ?? null,
      amount:      d.Amount != null ? String(d.Amount) : null,
      probability: d.Probability != null ? String(d.Probability) : null,
      leadSource:  d.Lead_Source ?? null,
      closingDate: d.Closing_Date ?? null,
      createdAt:   d.Created_Time ? new Date(d.Created_Time) : null,
      modifiedAt:  d.Modified_Time ? new Date(d.Modified_Time) : null,
    }).onConflictDoUpdate({
      target: zohoDeals.sourceId,
      set: {
        contactId,
        email,
        dealName:    d.Deal_Name ?? null,
        stage:       d.Stage ?? null,
        amount:      d.Amount != null ? String(d.Amount) : null,
        probability: d.Probability != null ? String(d.Probability) : null,
        leadSource:  d.Lead_Source ?? null,
        closingDate: d.Closing_Date ?? null,
        modifiedAt:  d.Modified_Time ? new Date(d.Modified_Time) : null,
        syncedAt:    new Date(),
      },
    });
    dealsUpserted++;
  }

  console.log(`[zoho-sync] done — contacts: ${contactsUpserted}, deals: ${dealsUpserted}`);
};

// Allow direct invocation: `pnpm run:zoho`
void handler({} as never, {} as never, () => {});


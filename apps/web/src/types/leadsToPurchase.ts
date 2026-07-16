// Ported from leads-tracker/packages/shared/src/types/leadsToPurchase.ts
// (leads-tracker/apps/web/src/types/leadsToPurchase.ts just re-exports this
// shared shape — no frontend-local override for this one, unlike shopFunnel).

// Shape of a single row returned by GET /api/leads-to-purchase/patients
export interface LeadToPurchaseRow {
    fullName: string;
    email: string;
    createdAt: string;
    source: string;
    state: string | null; // Australian state from Zoho (NSW, VIC, QLD…)
    // Registration journey
    registered: boolean;
    phone_verified: boolean;
    questionnaire_done: boolean;
    q_about_you: boolean;
    q_health_safety: boolean;
    q_treatment_history: boolean;
    q_health_profile: boolean;
    q_conditions: boolean;
    eligible: boolean;
    booked: boolean;
    booked_date: string | null;
    all_booked_dates: string | null; // pipe-separated YYYY-MM-DD, newest first
    consultation: boolean | null; // null = no record, false = Rejected, true = active/approved
    consultation_outcome: string | null; // raw outcome value from treatmentplan
    consultation_date: string | null;
    // Consultation detail
    no_show: boolean | null; // queueTag ILIKE '%no-show%'
    no_show_count: number; // total historical no-shows for this patient
    consultation_queue_tag: string | null; // queueTag from most recent consultation row
    past_consult_history: string | null; // pipe-sep 'YYYY-MM-DD:queueTag' for all past consultations, newest-first
    confirmed_attendance: string | null; // Zoho Confirmed_Consult_Attendance: yes/no/no response/reschedule
    sms_reminder_15m: string | null; // ClickSend: dates 15-min reminder was sent (pipe-sep YYYY-MM-DD), null if never
    sms_consult_link: string | null; // ClickSend: dates consultation link was sent (pipe-sep YYYY-MM-DD), null if never
    sms_follow_up: string | null; // ClickSend: dates follow-up SMS was sent (pipe-sep YYYY-MM-DD), null if never
    consent_form: boolean;
    // Shop journey — lifetime (ever, not date-scoped)
    shop_visit: boolean;
    shop_visit_count: number; // total shop logins ever
    first_shop_visit_date: string | null; // YYYY-MM-DD (Sydney TZ)
    last_shop_visit_date: string | null; // YYYY-MM-DD (Sydney TZ)
    viewed_products: boolean;
    added_to_cart: boolean;
    placed_order: boolean;
    purchase_complete: boolean;
    first_purchase_date: string | null;
    shop_days_viewed: number; // distinct days with product view (lifetime)
    shop_days_carted: number; // distinct days with cart activity (lifetime)
    shop_days_ordered: number; // distinct days with checkout conversion (lifetime)
    allowance_remaining: number | null; // current supply allowance (supply_interval - supply_used_interval_26)
    // Zoho CRM link
    zoho_id: string | null;
    zoho_module: "Leads" | "Contacts" | null;
    zoho_lead_date: string | null; // original Zoho Lead_Date — differs from createdAt for returning patients
}

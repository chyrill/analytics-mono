// Ported from leads-tracker/packages/shared/src/types/lead.ts.
// leads-tracker and analytics-mono are separate repos/workspaces, so these
// types are duplicated here rather than imported cross-repo. Keep in sync
// manually if leads-tracker's shared types change.

export type LeadSource = "meta" | "google_ads" | "organic" | "unknown";

export interface Lead {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    source: LeadSource;
    createdAt: string; // mapped from Lead_Date
    bookedAt: string | null; // set when Consult_Date_Time exists
    consultedAt: string | null; // set when Consult_Date_Time is in the past (Contacts only)
    purchasedAt: string | null; // derived from Member_Status
    stage: "lead" | "booked" | "consulted" | "purchased";
    memberStatus: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    otpStatus: string | null;
    state: string | null;
    confirmedAttendance: string | null; // 'yes' | 'no' | 'no response' | 'reschedule' | null
    dealValue: number | null;
    zohoLeadId: string;
    zohoModule: "Leads" | "Contacts";
    // Saleor order data (only populated for Contacts)
    saleorFirstOrderAt: string | null;
    saleorFirstOrderStatus: string | null;
    saleorTotalSpend: number | null;
    saleorCurrency: string | null;
    saleorOrderCount: number | null;
}

export interface LeadsQueryParams {
    source?: LeadSource;
    stage?: Lead["stage"];
    from?: string; // ISO date
    to?: string; // ISO date
    search?: string;
    consultDate?: "has" | "none";
    memberStatus?: string;
    module?: "Leads" | "Contacts";
    page?: number;
    limit?: number;
}

export interface LeadsSummary {
    total: number;
    booked: number;
    consulted: number;
    purchased: number;
    dbRegistered?: number;
}

export interface PaginatedLeads {
    data: Lead[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summary: LeadsSummary;
}

export interface LeadsStats {
    total: number;
    booked: number;
    consulted: number;
    purchased: number;
    byStage: Record<Lead["stage"], number>;
    conversionRates: {
        bookRate: number;
        showRate: number;
        purchaseRate: number;
    };
    bySource: Array<{
        source: LeadSource;
        total: number;
        booked: number;
        consulted: number;
        purchased: number;
    }>;
    byState: Array<{ state: string; count: number }>;
}

// Ported from leads-tracker/apps/web/src/types/campaignFunnel.ts.

export interface Campaign {
    campaignKey: string;
    campaignName: string;
    subject: string;
    sentDate: string | null;
    status: string;
}

export interface CampaignStats {
    totalSent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    revenue: number;
}

export interface RecipientRow {
    email: string;
    firstName: string | null;
    lastName: string | null;
    campaignStatus: "clicked" | "opened";
    loggedIn: boolean;
    loginTime: string | null;
    lastLoginTime: string | null;
    purchased: boolean;
    purchaseTime: string | null;
    purchaseRevenue: number | null;
    replayUrl: string | null;
    attributionType: "click-through" | "inferred" | "none";
}

export interface RecipientsResponse {
    stats: CampaignStats;
    recipients: RecipientRow[];
}

export interface SummaryStats {
    campaignCount: number;
    emailsSent: number;
    delivered: number;
    loggedIn: number;
    addedToCart: number;
    purchased: number;
    failedPurchase: number;
    didntAddToCart: number;
}

export interface SummaryResponse {
    current: SummaryStats;
    previous: SummaryStats;
    prevFrom: string;
    prevTo: string;
}

export interface CampaignRowStats {
    campaignKey: string;
    campaignName: string;
    subject: string;
    sentDate: string | null;
    sent: number;
    delivered: number;
    loggedIn: number;
    addedToCart: number;
    purchased: number;
    failedPurchase: number;
    didntAddToCart: number;
    revenue: number;
    convRate: number;
}

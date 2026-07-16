// Ported from leads-tracker/apps/web/src/types/shopFunnel.ts (frontend-local
// override of the shared package type — includes allowance/order_count
// fields the shared shopFunnel.ts lacks). Duplicated here since leads-tracker
// and analytics-mono are separate repos/workspaces.

// Shape of a single history row returned by GET /api/shop-funnel/users/:email/history
export interface HistoryRow {
    date: string;
    loginTime: string;
    allowance: number | null;
    viewed_products: boolean;
    added_to_cart: boolean;
    placed_order: boolean;
    purchase_complete: boolean;
    order_count: number;
    replayUrl: string | null;
}

// Shape of a single row returned by GET /api/shop-funnel/users
export interface LoginJourneyRow {
    email: string;
    fullName: string;
    loginTime: string;
    allowance: number | null;
    viewed_products: boolean;
    added_to_cart: boolean;
    placed_order: boolean;
    purchase_complete: boolean;
    order_count: number;
    replayUrl: string | null;
}

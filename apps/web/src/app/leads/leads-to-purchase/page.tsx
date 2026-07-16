"use client";

// Ported from leads-tracker/apps/web/src/pages/LeadsToPurchasePage.tsx.

import { Fragment, useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/leads/DateRangeFilter";
import { useLeadsToPurchaseData } from "@/hooks/useLeadsToPurchaseData";
import { useShopHistory } from "@/hooks/useShopHistory";
import { ShopHistoryPanel } from "@/components/leads/ShopHistoryPanel";
import { MultiSelectFilter } from "@/components/leads/MultiSelectFilter";
import type { LeadToPurchaseRow } from "@/types/leadsToPurchase";

function zohoUrl(id: string | null, module: "Leads" | "Contacts" | null): string | null {
    const zohoOrgId = process.env.NEXT_PUBLIC_ZOHO_ORG_ID ?? "";
    const zohoDatacenter = process.env.NEXT_PUBLIC_ZOHO_DATACENTER ?? "com";
    if (!id || !module || !zohoOrgId) return null;
    return `https://crm.zoho.${zohoDatacenter}/crm/org${zohoOrgId}/tab/${module}/${id}`;
}

function BoolCell({ value, title }: { value: boolean; title?: string }) {
    return (
        <span
            title={title}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${value ? "bg-green-500/15 text-green-400" : "text-muted-foreground"
                }`}
        >
            {value ? "✓" : "—"}
        </span>
    );
}

// tri-state: null = no record (—), true = active/approved (✓ green), false = Rejected (✗ red)
function timeToBuyBucket(
    tpDate: string | null,
    purchaseDate: string | null
): "24h" | "7 days" | "28 days" | "28d+" | null {
    if (!tpDate || !purchaseDate) return null;
    const days = Math.floor((new Date(purchaseDate).getTime() - new Date(tpDate).getTime()) / (1000 * 60 * 60 * 24));
    if (days < 0) return null;
    if (days <= 1) return "24h";
    if (days <= 7) return "7 days";
    if (days <= 28) return "28 days";
    return "28d+";
}

// Returns whole days between two YYYY-MM-DD or ISO date strings, or null if either is missing.
function daysBetween(a: string | null, b: string | null): number | null {
    if (!a || !b) return null;
    const diff = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff : null;
}

const LEAD_SUMMARY_STEPS: { key: keyof LeadToPurchaseRow; label: string }[] = [
    { key: "registered", label: "Registered" },
    { key: "eligible", label: "Eligible" },
    { key: "booked", label: "Booked" },
    { key: "consultation", label: "Consulted" },
    { key: "shop_visit", label: "Shop Visit" },
    { key: "purchase_complete", label: "Purchased" },
];

const CONSULT_SUMMARY_STEPS: { key: keyof LeadToPurchaseRow; label: string }[] = [
    { key: "consultation", label: "TP Approved" },
    { key: "consent_form", label: "Consent Form" },
    { key: "shop_visit", label: "Shop Visit" },
    { key: "purchase_complete", label: "Purchased" },
];

type FunnelStage =
    | "all"
    | "not_eligible"
    | "eligible_not_booked"
    | "booked_not_consulted"
    | "consulted_not_purchased"
    | "shop_not_purchased"
    | "purchased"
    | "tp_approved_not_purchased"
    | "tp_rejected"
    | "placed_order_not_purchased"
    | "approved_no_consent";

const STAGE_OPTIONS: { value: FunnelStage; label: string }[] = [
    { value: "all", label: "All" },
    { value: "not_eligible", label: "Not eligible" },
    { value: "eligible_not_booked", label: "Eligible, not booked" },
    { value: "booked_not_consulted", label: "Booked, not consulted" },
    { value: "consulted_not_purchased", label: "Consulted, not purchased" },
    { value: "shop_not_purchased", label: "Shop visit, not purchased" },
    { value: "purchased", label: "Purchased" },
];

const CONSULT_STAGE_OPTIONS: { value: FunnelStage; label: string }[] = [
    { value: "all", label: "All" },
    { value: "tp_approved_not_purchased", label: "Approved, not purchased" },
    { value: "approved_no_consent", label: "Approved, no consent form" },
    { value: "tp_rejected", label: "TP Rejected" },
    { value: "placed_order_not_purchased", label: "Placed order, not purchased" },
    { value: "purchased", label: "Purchased" },
];

const SOURCE_LABELS: Record<string, string> = {
    ig: "Meta",
    fb: "Meta",
    an: "Meta",
    google: "Google",
    meta: "Meta",
    google_ads: "Google",
    organic: "Organic",
    unknown: "Unknown",
};

const SOURCE_COLORS: Record<string, string> = {
    ig: "bg-blue-500/15 text-blue-400",
    fb: "bg-blue-500/15 text-blue-400",
    an: "bg-blue-500/15 text-blue-400",
    google: "bg-orange-500/15 text-orange-400",
    meta: "bg-blue-500/15 text-blue-400",
    google_ads: "bg-orange-500/15 text-orange-400",
    organic: "bg-green-500/15 text-green-400",
};

function RawSourceBadge({ source }: { source: string }) {
    if (!source || source === "unknown") return null;
    const color = SOURCE_COLORS[source] ?? "bg-muted text-muted-foreground";
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
            {SOURCE_LABELS[source] ?? source}
        </span>
    );
}

function normalizeSource(s: string): string {
    if (s === "ig" || s === "fb" || s === "an" || s === "meta") return "meta";
    if (s === "google" || s === "google_ads") return "google";
    return s;
}

type LeadSortKey =
    | "lead_date"
    | "eligible"
    | "booked"
    | "attendance"
    | "no_show_count"
    | "consultation_outcome"
    | "consent_form"
    | "purchased"
    | "shop_visit_count"
    | "last_shop_visit_date"
    | "time_to_buy";

function matchesStage(r: LeadToPurchaseRow, stage: FunnelStage): boolean {
    switch (stage) {
        case "not_eligible":
            return !r.eligible;
        case "eligible_not_booked":
            return r.eligible && !r.booked;
        case "booked_not_consulted":
            return r.booked && r.consultation !== true;
        case "consulted_not_purchased":
            return r.consultation === true && !r.purchase_complete;
        case "shop_not_purchased":
            return r.shop_visit && !r.purchase_complete;
        case "purchased":
            return r.purchase_complete;
        case "tp_approved_not_purchased":
            return r.consultation === true && !r.purchase_complete;
        case "approved_no_consent":
            return r.consultation === true && !r.consent_form;
        case "tp_rejected":
            return r.consultation === false;
        case "placed_order_not_purchased":
            return r.placed_order && !r.purchase_complete;
        default:
            return true;
    }
}

export default function LeadsToPurchasePage() {
    const {
        rows,
        loading,
        error,
        filterAxis,
        setFilterAxis,
        dateMode,
        setDateMode,
        dateFrom,
        setDateFrom,
        dateTo,
        setDateTo,
        consultDateMode,
        setConsultDateMode,
        consultFrom,
        setConsultFrom,
        consultTo,
        setConsultTo,
        appliedFrom,
        appliedTo,
        appliedConsultFrom,
        appliedConsultTo,
        fetchData,
        applyLeadDates,
        applyConsultDates,
        rangeLabel,
    } = useLeadsToPurchaseData();

    const [funnelStage, setFunnelStage] = useState<FunnelStage>("all");
    const [selectedSources, setSelectedSources] = useState<string[]>([]);
    const [selectedStates, setSelectedStates] = useState<string[]>([]);
    const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
    const [leadSortKey, setLeadSortKey] = useState<LeadSortKey>("lead_date");
    const [leadSortDir, setLeadSortDir] = useState<"asc" | "desc">("desc");

    function toggleLeadSort(key: LeadSortKey) {
        if (leadSortKey === key) {
            setLeadSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setLeadSortKey(key);
            setLeadSortDir("asc");
        }
    }
    const [filtersOpen, setFiltersOpen] = useState<boolean>(() => {
        try {
            return localStorage.getItem("ltp-filters-open") !== "false";
        } catch {
            return false;
        }
    });
    const { data: historyData, loading: historyLoading, fetch: fetchHistory } = useShopHistory();

    // Derived from loaded rows — used by filter pills
    const availableSources = [...new Set(rows.map((r) => normalizeSource(r.source)).filter((s) => s !== "unknown"))].sort();
    const availableStates = [...new Set(rows.map((r) => r.state).filter((s): s is string => !!s))].sort();

    const SUMMARY_STEPS = filterAxis === "consult" ? CONSULT_SUMMARY_STEPS : LEAD_SUMMARY_STEPS;

    const filteredRows = rows.filter((r) => {
        if (funnelStage === "not_eligible" && r.eligible) return false;
        if (funnelStage === "eligible_not_booked" && !(r.eligible && !r.booked)) return false;
        if (funnelStage === "booked_not_consulted" && !(r.booked && r.consultation !== true)) return false;
        if (funnelStage === "consulted_not_purchased" && !(r.consultation === true && !r.purchase_complete)) return false;
        if (funnelStage === "shop_not_purchased" && !(r.shop_visit && !r.purchase_complete)) return false;
        if (funnelStage === "purchased" && !r.purchase_complete) return false;
        if (funnelStage === "tp_approved_not_purchased" && !(r.consultation === true && !r.purchase_complete)) return false;
        if (funnelStage === "approved_no_consent" && !(r.consultation === true && !r.consent_form)) return false;
        if (funnelStage === "tp_rejected" && r.consultation !== false) return false;
        if (funnelStage === "placed_order_not_purchased" && !(r.placed_order && !r.purchase_complete)) return false;
        if (selectedSources.length > 0 && !selectedSources.includes(normalizeSource(r.source))) return false;
        if (selectedStates.length > 0 && !selectedStates.includes(r.state ?? "")) return false;
        return true;
    });

    // Rows filtered only by source/state — used to count each segment without the stage filter
    const preStageRows = rows.filter(
        (r) =>
            (selectedSources.length === 0 || selectedSources.includes(normalizeSource(r.source))) &&
            (selectedStates.length === 0 || selectedStates.includes(r.state ?? ""))
    );
    const segmentCounts = Object.fromEntries(
        (filterAxis === "consult" ? CONSULT_STAGE_OPTIONS : STAGE_OPTIONS)
            .filter((o) => o.value !== "all")
            .map((o) => [o.value, preStageRows.filter((r) => matchesStage(r, o.value as FunnelStage)).length])
    ) as Partial<Record<FunnelStage, number>>;

    const displayRows: LeadToPurchaseRow[] =
        filterAxis !== "consult"
            ? [...filteredRows].sort((a, b) => {
                let cmp = 0;
                switch (leadSortKey) {
                    case "lead_date":
                        cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
                        break;
                    case "eligible":
                        cmp = (a.eligible ? 1 : 0) - (b.eligible ? 1 : 0);
                        break;
                    case "booked":
                        cmp = (a.booked_date ?? "").localeCompare(b.booked_date ?? "");
                        break;
                    case "attendance":
                        cmp = (a.confirmed_attendance ?? "").localeCompare(b.confirmed_attendance ?? "");
                        break;
                    case "no_show_count":
                        cmp = (a.no_show_count ?? 0) - (b.no_show_count ?? 0);
                        break;
                    case "consultation_outcome":
                        cmp = (a.consultation_outcome ?? "").localeCompare(b.consultation_outcome ?? "");
                        break;
                    case "consent_form":
                        cmp = (a.consent_form ? 1 : 0) - (b.consent_form ? 1 : 0);
                        break;
                    case "purchased":
                        cmp = (a.purchase_complete ? 1 : 0) - (b.purchase_complete ? 1 : 0);
                        break;
                    case "shop_visit_count":
                        cmp = (a.shop_visit_count ?? 0) - (b.shop_visit_count ?? 0);
                        break;
                    case "last_shop_visit_date":
                        cmp = (a.last_shop_visit_date ?? "").localeCompare(b.last_shop_visit_date ?? "");
                        break;
                    case "time_to_buy": {
                        const tA =
                            a.first_shop_visit_date && a.first_purchase_date
                                ? new Date(a.first_purchase_date).getTime() - new Date(a.first_shop_visit_date).getTime()
                                : null;
                        const tB =
                            b.first_shop_visit_date && b.first_purchase_date
                                ? new Date(b.first_purchase_date).getTime() - new Date(b.first_shop_visit_date).getTime()
                                : null;
                        cmp = tA == null && tB == null ? 0 : tA == null ? 1 : tB == null ? -1 : tA - tB;
                        break;
                    }
                }
                return leadSortDir === "asc" ? cmp : -cmp;
            })
            : filteredRows;

    const counts = SUMMARY_STEPS.reduce(
        (acc, s) => ({ ...acc, [s.key]: filteredRows.filter((r) => r[s.key]).length }),
        {} as Record<string, number>
    );

    const tpApprovedCount = filterAxis === "consult" ? rows.filter((r) => r.consultation === true).length : 0;
    const tpPurchasedCount =
        filterAxis === "consult" ? rows.filter((r) => r.consultation === true && r.purchase_complete).length : 0;
    const gpReferralCount =
        filterAxis === "consult" ? rows.filter((r) => r.consultation_outcome?.toLowerCase().includes("gp referral")).length : 0;

    const purchasedApproved = filterAxis === "consult" ? rows.filter((r) => r.consultation === true && r.purchase_complete) : [];
    const within24h = purchasedApproved.filter((r) => timeToBuyBucket(r.consultation_date, r.first_purchase_date) === "24h").length;
    const within7d = purchasedApproved.filter((r) => timeToBuyBucket(r.consultation_date, r.first_purchase_date) === "7 days").length;
    const within28d = purchasedApproved.filter((r) => timeToBuyBucket(r.consultation_date, r.first_purchase_date) === "28 days").length;

    function exportCsv() {
        const BOOL = (v: boolean) => (v ? "Yes" : "No");
        const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;

        const headers =
            filterAxis === "consult"
                ? [
                    "Name", "Email", "State", "Source", "TP Date", "Confirmed Attendance", "15m SMS", "Link SMS",
                    "Follow-up SMS", "TP Status", "No Shows", "Consent Form", "Time to Buy", "Original Lead Date",
                    "Zoho ID", "Zoho Module", "Shop Visit", "Shop Visits (count)", "First Shop Visit", "Last Shop Visit",
                    "Days Since Last Visit", "Days TP→First Shop Visit", "Viewed Products", "Shop Days (Viewed)",
                    "Added to Cart", "Shop Days (Carted)", "Placed Order", "Shop Days (Ordered)", "Shop Cart Rate",
                    "Shop Order Rate", "Cart-to-Order Rate", "Purchased", "First Purchase Date", "Days TP→Purchase",
                    "Days Shop→Purchase", "Allowance Remaining",
                ]
                : [
                    "Name", "Email", "State", "Source", "Lead Date", "Phone ✓", "About You", "Health Safety",
                    "Tx History", "Health Profile", "Conditions", "Eligible", "Questionnaire Done", "Booked",
                    "All Booking Dates", "Days Reg→First Booking", "Confirmed Attendance", "15m SMS", "Link SMS",
                    "Follow-up SMS", "Consultation History", "TP Date", "TP Outcome", "Days Reg→Consultation",
                    "Days Booking→Consultation", "No Shows", "Consent Form", "Original Lead Date", "Zoho ID",
                    "Zoho Module", "Shop Visit", "Shop Visits (count)", "First Shop Visit", "Last Shop Visit",
                    "Days Since Last Visit", "Days Reg→First Shop Visit", "Days Consultation→Shop", "Viewed Products",
                    "Shop Days (Viewed)", "Added to Cart", "Shop Days (Carted)", "Placed Order", "Shop Days (Ordered)",
                    "Shop Cart Rate", "Shop Order Rate", "Cart-to-Order Rate", "Purchased", "First Purchase Date",
                    "Days Consultation→Purchase", "Days Shop→Purchase", "Time to Buy (Shop→Purchase)", "Allowance Remaining",
                ];

        const csvRows = filteredRows.map((r) =>
            filterAxis === "consult"
                ? [
                    esc(r.fullName || ""),
                    esc(r.email || ""),
                    esc(r.state ?? ""),
                    esc(r.source || ""),
                    esc(r.consultation_date ?? ""),
                    esc(r.confirmed_attendance ?? ""),
                    esc((r.sms_reminder_15m ?? "").replace(/\|/g, " · ")),
                    esc((r.sms_consult_link ?? "").replace(/\|/g, " · ")),
                    esc((r.sms_follow_up ?? "").replace(/\|/g, " · ")),
                    esc(r.consultation_outcome ?? ""),
                    String(r.no_show_count ?? 0),
                    BOOL(r.consent_form),
                    esc(timeToBuyBucket(r.consultation_date, r.first_purchase_date) ?? ""),
                    esc(r.zoho_lead_date ?? ""),
                    esc(r.zoho_id ?? ""),
                    esc(r.zoho_module ?? ""),
                    BOOL(r.shop_visit),
                    String(r.shop_visit_count ?? 0),
                    esc(r.first_shop_visit_date ?? ""),
                    esc(r.last_shop_visit_date ?? ""),
                    r.last_shop_visit_date
                        ? String(Math.floor((Date.now() - new Date(r.last_shop_visit_date).getTime()) / 86_400_000))
                        : "",
                    daysBetween(r.consultation_date, r.first_shop_visit_date) !== null
                        ? String(daysBetween(r.consultation_date, r.first_shop_visit_date))
                        : "",
                    BOOL(r.viewed_products),
                    String(r.shop_days_viewed ?? 0),
                    BOOL(r.added_to_cart),
                    String(r.shop_days_carted ?? 0),
                    BOOL(r.placed_order),
                    String(r.shop_days_ordered ?? 0),
                    r.shop_days_viewed > 0 ? (r.shop_days_carted / r.shop_days_viewed).toFixed(2) : "",
                    r.shop_days_viewed > 0 ? (r.shop_days_ordered / r.shop_days_viewed).toFixed(2) : "",
                    r.shop_days_carted > 0 ? (r.shop_days_ordered / r.shop_days_carted).toFixed(2) : "",
                    BOOL(r.purchase_complete),
                    esc(r.first_purchase_date ?? ""),
                    daysBetween(r.consultation_date, r.first_purchase_date) !== null
                        ? String(daysBetween(r.consultation_date, r.first_purchase_date))
                        : "",
                    daysBetween(r.first_shop_visit_date, r.first_purchase_date) !== null
                        ? String(daysBetween(r.first_shop_visit_date, r.first_purchase_date))
                        : "",
                    r.allowance_remaining !== null ? String(r.allowance_remaining) : "",
                ]
                : [
                    esc(r.fullName || ""),
                    esc(r.email || ""),
                    esc(r.state ?? ""),
                    esc(r.source || ""),
                    esc(r.createdAt ? format(new Date(r.createdAt), "yyyy-MM-dd") : ""),
                    BOOL(r.phone_verified),
                    BOOL(r.q_about_you),
                    BOOL(r.q_health_safety),
                    BOOL(r.q_treatment_history),
                    BOOL(r.q_health_profile),
                    BOOL(r.q_conditions),
                    BOOL(r.eligible),
                    BOOL(r.questionnaire_done),
                    BOOL(r.booked),
                    esc((r.all_booked_dates ?? r.booked_date ?? "").replace(/\|/g, " · ")),
                    daysBetween(r.createdAt, r.booked_date) !== null ? String(daysBetween(r.createdAt, r.booked_date)) : "",
                    esc(r.confirmed_attendance ?? ""),
                    esc((r.sms_reminder_15m ?? "").replace(/\|/g, " · ")),
                    esc((r.sms_consult_link ?? "").replace(/\|/g, " · ")),
                    esc((r.sms_follow_up ?? "").replace(/\|/g, " · ")),
                    esc((r.past_consult_history ?? "").replace(/\|/g, " · ")),
                    esc(r.consultation_date ?? ""),
                    esc(r.consultation_outcome ?? ""),
                    daysBetween(r.createdAt, r.consultation_date) !== null
                        ? String(daysBetween(r.createdAt, r.consultation_date))
                        : "",
                    daysBetween(r.booked_date, r.consultation_date) !== null
                        ? String(daysBetween(r.booked_date, r.consultation_date))
                        : "",
                    String(r.no_show_count ?? 0),
                    BOOL(r.consent_form),
                    esc(r.zoho_lead_date ?? ""),
                    esc(r.zoho_id ?? ""),
                    esc(r.zoho_module ?? ""),
                    BOOL(r.shop_visit),
                    String(r.shop_visit_count ?? 0),
                    esc(r.first_shop_visit_date ?? ""),
                    esc(r.last_shop_visit_date ?? ""),
                    r.last_shop_visit_date
                        ? String(Math.floor((Date.now() - new Date(r.last_shop_visit_date).getTime()) / 86_400_000))
                        : "",
                    daysBetween(r.createdAt, r.first_shop_visit_date) !== null
                        ? String(daysBetween(r.createdAt, r.first_shop_visit_date))
                        : "",
                    daysBetween(r.consultation_date, r.first_shop_visit_date) !== null
                        ? String(daysBetween(r.consultation_date, r.first_shop_visit_date))
                        : "",
                    BOOL(r.viewed_products),
                    String(r.shop_days_viewed ?? 0),
                    BOOL(r.added_to_cart),
                    String(r.shop_days_carted ?? 0),
                    BOOL(r.placed_order),
                    String(r.shop_days_ordered ?? 0),
                    r.shop_days_viewed > 0 ? (r.shop_days_carted / r.shop_days_viewed).toFixed(2) : "",
                    r.shop_days_viewed > 0 ? (r.shop_days_ordered / r.shop_days_viewed).toFixed(2) : "",
                    r.shop_days_carted > 0 ? (r.shop_days_ordered / r.shop_days_carted).toFixed(2) : "",
                    BOOL(r.purchase_complete),
                    esc(r.first_purchase_date ?? ""),
                    daysBetween(r.consultation_date, r.first_purchase_date) !== null
                        ? String(daysBetween(r.consultation_date, r.first_purchase_date))
                        : "",
                    daysBetween(r.first_shop_visit_date, r.first_purchase_date) !== null
                        ? String(daysBetween(r.first_shop_visit_date, r.first_purchase_date))
                        : "",
                    esc(timeToBuyBucket(r.first_shop_visit_date, r.first_purchase_date) ?? ""),
                    r.allowance_remaining !== null ? String(r.allowance_remaining) : "",
                ]
        );

        const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
            filterAxis === "consult"
                ? `tp-conversion-${appliedConsultFrom}${appliedConsultFrom !== appliedConsultTo ? `_${appliedConsultTo}` : ""}.csv`
                : `leads-to-purchase-${appliedFrom}${appliedFrom !== appliedTo ? `_${appliedTo}` : ""}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const th = "text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap select-none px-2 py-1.5 text-center";
    const borderL = "border-l border-border/40";

    const sortLeadTh = (key: LeadSortKey, label: string, extraCls = "", tooltip?: string) => {
        const active = leadSortKey === key;
        return (
            <th
                key={key}
                className={`${th} ${extraCls} cursor-pointer hover:text-foreground`}
                title={tooltip}
                onClick={() => toggleLeadSort(key)}
            >
                <span className="inline-flex items-center justify-center gap-0.5">
                    {label}
                    <span className="text-[9px] opacity-40">{active ? (leadSortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                </span>
            </th>
        );
    };

    return (
        <div className="flex flex-col gap-4 min-h-0 flex-1">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Patient Journey</h1>
                    <p className="text-sm text-muted-foreground">
                        {filterAxis === "consult"
                            ? `TP approval to purchase journey · ${rangeLabel}`
                            : `Full journey from registration to first purchase · ${rangeLabel}`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                    {rows.length > 0 && (
                        <Button variant="outline" size="sm" onClick={exportCsv}>
                            <Download className="h-4 w-4 mr-2" />
                            CSV
                        </Button>
                    )}
                </div>
            </div>

            {/* Collapsible filter panel */}
            <div className="border rounded-md bg-card">
                <button
                    onClick={() => {
                        const next = !filtersOpen;
                        setFiltersOpen(next);
                        try {
                            localStorage.setItem("ltp-filters-open", String(next));
                        } catch {
                            /* */
                        }
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors bg-transparent"
                >
                    <span className="flex items-center gap-2">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? "" : "-rotate-90"}`} />
                        Filters
                        {!filtersOpen &&
                            (filterAxis !== "lead" || funnelStage !== "all" || selectedSources.length > 0 || selectedStates.length > 0) && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary text-primary-foreground">
                                    active
                                </span>
                            )}
                    </span>
                    <span className="text-xs text-muted-foreground/60">{rangeLabel}</span>
                </button>

                {filtersOpen && (
                    <div className="px-3 pb-3 flex flex-col gap-2 border-t">
                        {/* Date filter */}
                        <div className="flex flex-col gap-2 pt-2">
                            <div className="flex gap-1">
                                {(["lead", "consult"] as const).map((axis) => (
                                    <button
                                        key={axis}
                                        onClick={() => {
                                            setFilterAxis(axis);
                                            setFunnelStage("all");
                                        }}
                                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${filterAxis === axis
                                                ? "bg-secondary text-foreground border-foreground/30"
                                                : "bg-background text-muted-foreground border-border hover:border-primary/50"
                                            }`}
                                    >
                                        {axis === "lead" ? "Lead date" : "TP Consultation"}
                                    </button>
                                ))}
                            </div>
                            {filterAxis === "lead" ? (
                                <DateRangeFilter
                                    dateMode={dateMode}
                                    dateFrom={dateFrom}
                                    dateTo={dateTo}
                                    onModeChange={setDateMode}
                                    onDateFromChange={setDateFrom}
                                    onDateToChange={setDateTo}
                                    onApply={applyLeadDates}
                                />
                            ) : (
                                <DateRangeFilter
                                    label="Consultation"
                                    dateMode={consultDateMode}
                                    dateFrom={consultFrom}
                                    dateTo={consultTo}
                                    onModeChange={setConsultDateMode}
                                    onDateFromChange={setConsultFrom}
                                    onDateToChange={setConsultTo}
                                    onApply={applyConsultDates}
                                />
                            )}
                        </div>

                        {/* Funnel stage + Source + State filters */}
                        {rows.length > 0 && (
                            <div className="flex flex-wrap gap-3 items-start">
                                {/* Funnel stage pills */}
                                <div className="flex flex-wrap gap-1">
                                    {(filterAxis === "consult" ? CONSULT_STAGE_OPTIONS : STAGE_OPTIONS)
                                        .filter((opt) => opt.value === "all" || (segmentCounts[opt.value as FunnelStage] ?? 0) > 0)
                                        .map((opt) => (
                                            <button
                                                key={opt.value}
                                                onClick={() => setFunnelStage(opt.value)}
                                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${funnelStage === opt.value
                                                        ? "bg-secondary text-foreground border-foreground/30"
                                                        : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                                                    }`}
                                            >
                                                {opt.label}
                                                {opt.value !== "all" && (
                                                    <span className="ml-1.5 font-normal opacity-70 tabular-nums">
                                                        {segmentCounts[opt.value as FunnelStage] ?? 0}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                </div>
                                {/* Source pills */}
                                {availableSources.some((s) => s !== "unknown") && (
                                    <div className="flex flex-wrap gap-1 border-l border-border pl-3">
                                        {availableSources.map((src) => (
                                            <button
                                                key={src}
                                                onClick={() =>
                                                    setSelectedSources((prev) => (prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]))
                                                }
                                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${selectedSources.includes(src)
                                                        ? "bg-secondary text-foreground border-foreground/30"
                                                        : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                                                    }`}
                                            >
                                                {SOURCE_LABELS[src] ?? src}
                                            </button>
                                        ))}
                                        {selectedSources.length > 0 && (
                                            <button
                                                onClick={() => setSelectedSources([])}
                                                className="px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground"
                                            >
                                                ✕ Clear
                                            </button>
                                        )}
                                    </div>
                                )}
                                {/* State multi-select dropdown */}
                                {availableStates.length > 0 && (
                                    <div className="border-l border-border pl-3">
                                        <MultiSelectFilter label="State" options={availableStates} selected={selectedStates} onChange={setSelectedStates} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {error && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
            )}

            {loading && <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>}

            {!loading && rows.length === 0 && !error && (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No leads found for the selected date range.</div>
            )}

            {!loading && rows.length > 0 && (
                <>
                    {/* CEO conversion stat — consult mode only */}
                    {filterAxis === "consult" && (
                        <div className="rounded-lg border bg-card px-5 py-3 shrink-0 flex items-center gap-6 flex-wrap">
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-muted-foreground">TP Approved → Purchased</span>
                                <span className="font-bold text-lg tabular-nums">
                                    {tpPurchasedCount} / {tpApprovedCount}
                                </span>
                                {tpApprovedCount > 0 && (
                                    <span className="text-sm text-muted-foreground">({Math.round((tpPurchasedCount / tpApprovedCount) * 100)}%)</span>
                                )}
                            </div>
                            {tpPurchasedCount > 0 && (
                                <div className="flex items-center gap-4 border-l border-border pl-6">
                                    <div className="flex flex-col items-center">
                                        <span className="font-semibold tabular-nums text-sm">{within24h}</span>
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">within 24h</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="font-semibold tabular-nums text-sm">{within7d}</span>
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">within 7d</span>
                                    </div>
                                    <div className="flex flex-col items-center">
                                        <span className="font-semibold tabular-nums text-sm">{within28d}</span>
                                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">within 28d</span>
                                    </div>
                                </div>
                            )}
                            {gpReferralCount > 0 && (
                                <div className="flex items-center gap-2 border-l border-border pl-6">
                                    <span className="text-sm text-muted-foreground">GP Referral</span>
                                    <span className="font-bold text-lg tabular-nums text-green-400">{gpReferralCount}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Funnel summary bar */}
                    <div className="flex items-center overflow-x-auto rounded-lg border bg-card p-1 shrink-0">
                        {SUMMARY_STEPS.map((s, i) => (
                            <div key={s.key} className="flex items-center min-w-0">
                                {i > 0 && <span className="text-muted-foreground px-1 shrink-0 text-sm">›</span>}
                                <div className="flex flex-col items-center px-4 py-1 min-w-[80px]">
                                    <span className="text-lg font-bold tabular-nums">{counts[s.key]}</span>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">{s.label}</span>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Table */}
                    <div className="overflow-auto rounded-lg border bg-card flex-1 min-h-0">
                        <table className="w-full text-sm border-collapse" style={{ minWidth: filterAxis === "consult" ? "1400px" : "2200px" }}>
                            <thead className="bg-muted sticky top-0 z-10">
                                {/* Group labels: User | Registration Journey | Consultation | Shop Journey */}
                                <tr className="border-b border-border/50">
                                    <th className="px-3 py-1 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide" colSpan={2} />
                                    {filterAxis !== "consult" && (
                                        <th className={`${borderL} py-1 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wide`} colSpan={8}>
                                            Registration Journey
                                        </th>
                                    )}
                                    <th className={`${borderL} py-1 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wide`} colSpan={7}>
                                        Consultation
                                    </th>
                                    <th
                                        className={`${borderL} py-1 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wide`}
                                        colSpan={filterAxis !== "consult" ? 8 : 7}
                                    >
                                        Shop Journey (Lifetime)
                                    </th>
                                </tr>
                                {/* Column headers */}
                                <tr className="border-b">
                                    <th className={`${th} text-left px-3 min-w-[220px]`}>User</th>
                                    {filterAxis === "consult" ? <th className={`${th} w-20`}>TP Date</th> : sortLeadTh("lead_date", "Lead Date", "w-20")}
                                    {filterAxis !== "consult" && (
                                        <>
                                            <th className={`${th} w-14 ${borderL}`} title="Phone Verified">
                                                Phone ✓
                                            </th>
                                            <th className={`${th} w-14`} title="Tell Us About You">
                                                About
                                            </th>
                                            <th className={`${th} w-14`} title="Your Health & Safety">
                                                Health
                                            </th>
                                            <th className={`${th} w-16`} title="Treatment History">
                                                Tx Hist.
                                            </th>
                                            <th className={`${th} w-14`} title="Your Health Profile">
                                                Profile
                                            </th>
                                            <th className={`${th} w-16`} title="Your Conditions">
                                                Conditions
                                            </th>
                                            <th className={`${th} w-14`}>Eligible</th>
                                            {sortLeadTh("booked", "Booked", "w-14")}
                                        </>
                                    )}
                                    {filterAxis !== "consult"
                                        ? sortLeadTh(
                                            "attendance",
                                            "Attendance",
                                            `w-24 ${borderL}`,
                                            "Patient confirmed attendance before the consultation (Zoho: Confirmed_Consult_Attendance)"
                                        )
                                        : (
                                            <th
                                                className={`${th} w-24 ${borderL}`}
                                                title="Patient confirmed attendance before the consultation (Zoho: Confirmed_Consult_Attendance)"
                                            >
                                                Attendance
                                            </th>
                                        )}
                                    <th className={`${th} w-18`} title="ClickSend: 15-minute reminder SMS sent">
                                        15m SMS
                                    </th>
                                    <th className={`${th} w-18`} title="ClickSend: consultation link SMS sent">
                                        Link SMS
                                    </th>
                                    <th
                                        className={`${th} w-20`}
                                        title={filterAxis === "consult" ? "treatmentplan.outcome" : "consultation.queueTag: ✓ = showed up, ✗ = no-show, — = no record"}
                                    >
                                        {filterAxis === "consult" ? "TP Status" : "Consultation"}
                                    </th>
                                    {filterAxis !== "consult"
                                        ? sortLeadTh("no_show_count", "No Shows", "w-18", "Total historical no-shows for this patient")
                                        : (
                                            <th className={`${th} w-18`} title="Total historical no-shows for this patient">
                                                No Shows
                                            </th>
                                        )}
                                    {filterAxis !== "consult" && sortLeadTh("consultation_outcome", "TP Status", "w-24", "treatmentplan.outcome")}
                                    {filterAxis !== "consult"
                                        ? sortLeadTh("consent_form", "Consent Form", "w-20", "lastCompletedForm = consent")
                                        : (
                                            <th className={`${th} w-20`} title="lastCompletedForm = consent">
                                                Consent Form
                                            </th>
                                        )}
                                    {filterAxis === "consult" && (
                                        <th className={`${th} w-20`} title="Days from TP date to first purchase">
                                            Time to Buy
                                        </th>
                                    )}
                                    <th className={`${th} w-18 ${borderL}`} title="Ever logged into the shop">
                                        Shop Visit
                                    </th>
                                    <th className={`${th} w-18`} title="Ever viewed a product page">
                                        Viewed Prod.
                                    </th>
                                    <th className={`${th} w-18`} title="Ever added a variant to cart">
                                        Added Cart
                                    </th>
                                    <th
                                        className={`${th} w-18`}
                                        title="Converted a checkout to an order in the shop (audit log). May differ from 'Purchased' if there's an email mismatch or the order was voided before dispatch."
                                    >
                                        Placed Order
                                    </th>
                                    {filterAxis !== "consult"
                                        ? sortLeadTh(
                                            "purchased",
                                            "Purchased",
                                            "w-20",
                                            "Email found in orders_to_dispatch, OR converted checkout to order in audit_logs (fallback for email-changed patients)"
                                        )
                                        : (
                                            <th
                                                className={`${th} w-20`}
                                                title="Email found in orders_to_dispatch, OR converted checkout to order in audit_logs (fallback for email-changed patients)"
                                            >
                                                Purchased
                                            </th>
                                        )}
                                    {filterAxis !== "consult"
                                        ? sortLeadTh("shop_visit_count", "Visits", "w-18", "Total shop logins ever")
                                        : (
                                            <th className={`${th} w-18`} title="Total shop logins ever">
                                                Visits
                                            </th>
                                        )}
                                    {filterAxis !== "consult"
                                        ? sortLeadTh("last_shop_visit_date", "Last Visit", "w-20", "Date of most recent shop login")
                                        : (
                                            <th className={`${th} w-20`} title="Date of most recent shop login">
                                                Last Visit
                                            </th>
                                        )}
                                    {filterAxis !== "consult" && sortLeadTh("time_to_buy", "Time to Buy", "w-20", "Time from first shop visit to first purchase")}
                                </tr>
                            </thead>
                            <tbody>
                                {displayRows.map((r, i) => {
                                    const isExpanded = expandedEmail === r.email;
                                    const colCount = filterAxis === "consult" ? 16 : 25;
                                    return (
                                        <Fragment key={`row-${i}`}>
                                            <tr className={`border-t hover:bg-muted/30 transition-colors ${isExpanded ? "bg-muted/20" : ""}`}>
                                                <td className="px-3 py-1.5 min-w-[220px] overflow-hidden">
                                                    {/* Line 1: name + source badge */}
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        {(() => {
                                                            const href = zohoUrl(r.zoho_id, r.zoho_module);
                                                            return href ? (
                                                                <a
                                                                    href={href}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="font-medium truncate flex items-center gap-1 hover:underline text-foreground text-sm shrink"
                                                                    title={`Open ${r.fullName} in Zoho CRM`}
                                                                >
                                                                    <span className="truncate">{r.fullName || "—"}</span>
                                                                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                                                                </a>
                                                            ) : (
                                                                <div className="font-medium truncate text-sm shrink" title={r.fullName}>
                                                                    {r.fullName || "—"}
                                                                </div>
                                                            );
                                                        })()}
                                                        {r.source && r.source !== "unknown" && (
                                                            <div className="shrink-0">
                                                                <RawSourceBadge source={r.source} />
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Line 2: email + state + returning badge */}
                                                    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                                        <span className="text-[11px] text-muted-foreground truncate shrink" title={r.email}>
                                                            {r.email}
                                                        </span>
                                                        {r.state && <span className="text-[10px] text-muted-foreground/70 shrink-0">{r.state}</span>}
                                                        {(() => {
                                                            if (!r.zoho_lead_date || !r.createdAt) return null;
                                                            const zohoDays = Math.floor(
                                                                (new Date(r.createdAt).getTime() - new Date(r.zoho_lead_date).getTime()) / 86400000
                                                            );
                                                            if (zohoDays < 60) return null;
                                                            return (
                                                                <span
                                                                    className="shrink-0 inline-flex items-center px-1 py-0 rounded text-[9px] font-medium bg-slate-500/15 text-slate-400"
                                                                    title={`Originally a lead since ${r.zoho_lead_date.slice(0, 7)}`}
                                                                >
                                                                    ↩{format(parseISO(r.zoho_lead_date), "MMM yy")}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-1.5 text-center text-xs text-muted-foreground whitespace-nowrap">
                                                    {filterAxis === "consult"
                                                        ? r.consultation_date
                                                            ? format(new Date(r.consultation_date), "MMM d")
                                                            : "—"
                                                        : r.createdAt
                                                            ? format(new Date(r.createdAt), "MMM d")
                                                            : "—"}
                                                </td>
                                                {filterAxis !== "consult" && (
                                                    <>
                                                        <td className={`px-2 py-1.5 text-center ${borderL}`}>
                                                            <BoolCell value={r.phone_verified} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <BoolCell value={r.q_about_you} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <BoolCell value={r.q_health_safety} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <BoolCell value={r.q_treatment_history} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <BoolCell value={r.q_health_profile} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <BoolCell value={r.q_conditions} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            <BoolCell value={r.eligible} />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-center">
                                                            {(() => {
                                                                const dates = r.all_booked_dates?.split("|") ?? (r.booked_date ? [r.booked_date] : []);
                                                                if (dates.length === 0) return <span className="text-muted-foreground/30">—</span>;
                                                                const MAX = 3;
                                                                const shown = dates.slice(0, MAX);
                                                                const extra = dates.length - MAX;
                                                                return (
                                                                    <span className="text-xs text-muted-foreground whitespace-nowrap" title={dates.join(" · ")}>
                                                                        {shown.map((d) => format(new Date(d), "MMM d")).join(" · ")}
                                                                        {extra > 0 && <span className="text-muted-foreground/50"> +{extra}</span>}
                                                                    </span>
                                                                );
                                                            })()}
                                                        </td>
                                                    </>
                                                )}
                                                <td className={`px-2 py-1.5 text-center ${borderL}`}>
                                                    {(() => {
                                                        const raw = r.confirmed_attendance;
                                                        if (!raw) return <span className="text-muted-foreground/30 select-none">—</span>;
                                                        const val = raw.toLowerCase().trim();
                                                        const color =
                                                            val === "yes"
                                                                ? "bg-green-500 text-white"
                                                                : val === "no"
                                                                    ? "bg-red-500 text-white"
                                                                    : val === "no response"
                                                                        ? "bg-amber-500 text-white"
                                                                        : val === "reschedule"
                                                                            ? "bg-amber-500 text-white"
                                                                            : "bg-slate-500/20 text-slate-300";
                                                        return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${color}`}>{raw}</span>;
                                                    })()}
                                                </td>
                                                {(["sms_reminder_15m", "sms_consult_link"] as const).map((f) => (
                                                    <td key={f} className="px-2 py-1.5 text-center">
                                                        {r[f] ? (
                                                            <span className="text-xs font-medium text-green-400 whitespace-nowrap">
                                                                {r[f]!.split("|")
                                                                    .map((d) => format(new Date(d), "MMM d"))
                                                                    .join(" · ")}
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted-foreground/30 select-none">—</span>
                                                        )}
                                                    </td>
                                                ))}
                                                <td className="px-2 py-1.5 text-center">
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        {filterAxis === "consult" ? (
                                                            <span
                                                                className={`text-xs font-medium ${r.consultation === true || r.consultation_outcome?.toLowerCase().includes("gp referral")
                                                                        ? "text-green-400"
                                                                        : r.consultation === false
                                                                            ? "text-red-400"
                                                                            : "text-muted-foreground"
                                                                    }`}
                                                            >
                                                                {r.consultation_outcome ?? "—"}
                                                            </span>
                                                        ) : (
                                                            (() => {
                                                                const entries = r.past_consult_history
                                                                    ? r.past_consult_history.split("|").map((e) => {
                                                                        const [date, tag] = e.split(":");
                                                                        return { date, tag: tag ?? "" };
                                                                    })
                                                                    : [];
                                                                if (entries.length === 0) return <span className="text-muted-foreground text-sm">—</span>;
                                                                return (
                                                                    <div className="flex flex-col items-center gap-0.5">
                                                                        {entries.map(({ date, tag }) => {
                                                                            const noShow = /no.?show/i.test(tag);
                                                                            const showedUp = /showed.?up/i.test(tag);
                                                                            const color = noShow ? "text-red-400" : showedUp ? "text-green-400" : "text-muted-foreground";
                                                                            return (
                                                                                <span key={date} className={`text-xs font-medium whitespace-nowrap ${color}`}>
                                                                                    {format(new Date(date), "MMM d")}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                );
                                                            })()
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    {r.no_show_count > 0 ? (
                                                        <span className="text-xs font-medium tabular-nums text-red-400">{r.no_show_count}</span>
                                                    ) : (
                                                        <span className="text-muted-foreground/30 select-none">—</span>
                                                    )}
                                                </td>
                                                {filterAxis !== "consult" && (
                                                    <td className="px-2 py-1.5 text-center">
                                                        <span
                                                            className={`text-xs font-medium ${r.consultation === true || r.consultation_outcome?.toLowerCase().includes("gp referral")
                                                                    ? "text-green-400"
                                                                    : r.consultation === false
                                                                        ? "text-red-400"
                                                                        : "text-muted-foreground"
                                                                }`}
                                                        >
                                                            {r.consultation_outcome ?? "—"}
                                                        </span>
                                                    </td>
                                                )}
                                                <td className="px-2 py-1.5 text-center">
                                                    <BoolCell value={r.consent_form} />
                                                </td>
                                                {filterAxis === "consult" &&
                                                    (() => {
                                                        const bucket = timeToBuyBucket(r.consultation_date, r.first_purchase_date);
                                                        return (
                                                            <td className="px-2 py-1.5 text-center">
                                                                {bucket ? (
                                                                    <span
                                                                        className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${bucket === "24h"
                                                                                ? "bg-green-500/15 text-green-400"
                                                                                : bucket === "7 days"
                                                                                    ? "bg-blue-500/15 text-blue-400"
                                                                                    : bucket === "28 days"
                                                                                        ? "bg-yellow-500/15 text-yellow-400"
                                                                                        : "bg-muted text-muted-foreground"
                                                                            }`}
                                                                    >
                                                                        {bucket}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-muted-foreground text-sm">—</span>
                                                                )}
                                                            </td>
                                                        );
                                                    })()}
                                                <td className={`px-2 py-1.5 text-center ${borderL}`}>
                                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                        {r.first_shop_visit_date ? format(new Date(r.first_shop_visit_date), "MMM d") : "—"}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    <BoolCell value={r.viewed_products} />
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    <BoolCell value={r.added_to_cart} />
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    <BoolCell value={r.placed_order} />
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    <BoolCell value={r.purchase_complete} />
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    {r.shop_visit_count > 0 ? (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (isExpanded) {
                                                                    setExpandedEmail(null);
                                                                } else {
                                                                    setExpandedEmail(r.email);
                                                                    fetchHistory(r.email);
                                                                }
                                                            }}
                                                            className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-primary hover:underline"
                                                        >
                                                            {r.shop_visit_count}
                                                            <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                                        </button>
                                                    ) : (
                                                        <span className="text-muted-foreground/30 select-none">—</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-1.5 text-center">
                                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                                        {r.last_shop_visit_date ? format(new Date(r.last_shop_visit_date), "MMM d") : "—"}
                                                    </span>
                                                </td>
                                                {filterAxis !== "consult" &&
                                                    (() => {
                                                        const bucket = timeToBuyBucket(r.first_shop_visit_date, r.first_purchase_date);
                                                        return (
                                                            <td className="px-2 py-1.5 text-center">
                                                                {bucket ? (
                                                                    <span
                                                                        className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${bucket === "24h"
                                                                                ? "bg-green-500/15 text-green-400"
                                                                                : bucket === "7 days"
                                                                                    ? "bg-blue-500/15 text-blue-400"
                                                                                    : bucket === "28 days"
                                                                                        ? "bg-yellow-500/15 text-yellow-400"
                                                                                        : "bg-muted text-muted-foreground"
                                                                            }`}
                                                                    >
                                                                        {bucket}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-muted-foreground text-sm">—</span>
                                                                )}
                                                            </td>
                                                        );
                                                    })()}
                                            </tr>
                                            {isExpanded && (
                                                <tr className="bg-muted/10 border-t border-border/30">
                                                    <td colSpan={colCount} className="p-0">
                                                        <div className="border-l-2 border-primary/30 ml-3 my-1 rounded">
                                                            <ShopHistoryPanel
                                                                email={r.email}
                                                                rows={historyData.get(r.email.toLowerCase()) ?? []}
                                                                loading={historyLoading.has(r.email.toLowerCase())}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <p className="text-xs text-muted-foreground shrink-0">
                        {filteredRows.length !== rows.length ? (
                            <>
                                {filteredRows.length} of {rows.length} leads shown ·{" "}
                            </>
                        ) : filterAxis === "consult" ? (
                            <>
                                {rows.length} patient{rows.length !== 1 ? "s" : ""} with a TP in the selected period ·{" "}
                            </>
                        ) : (
                            <>
                                {rows.length} lead{rows.length !== 1 ? "s" : ""} registered in the selected period ·{" "}
                            </>
                        )}
                        Shop journey columns show <strong>lifetime</strong> activity (not scoped to the date filter).
                    </p>
                </>
            )}
        </div>
    );
}

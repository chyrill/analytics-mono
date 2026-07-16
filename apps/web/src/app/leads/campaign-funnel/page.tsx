"use client";

// Ported from leads-tracker/apps/web/src/pages/CampaignFunnelPage.tsx.

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import type { ElementType } from "react";
import { format } from "date-fns";
import {
    RefreshCw,
    ExternalLink,
    ChevronUp,
    ChevronDown,
    ChevronsUpDown,
    Download,
    Send,
    MailCheck,
    LogIn,
    ShoppingBag,
    AlertCircle,
    ShoppingCart,
    MinusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import type { Campaign, CampaignStats, CampaignRowStats, RecipientRow, RecipientsResponse } from "@/types/campaignFunnel";

type SortKey = keyof RecipientRow;
type FilterMode = "all" | "clicked" | "opened" | "loggedIn" | "purchased";

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: "asc" | "desc" }) {
    if (col !== sortKey) return <ChevronsUpDown className="inline ml-1 h-3 w-3 text-muted-foreground/40" />;
    return sortDir === "asc" ? <ChevronUp className="inline ml-1 h-3 w-3" /> : <ChevronDown className="inline ml-1 h-3 w-3" />;
}

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat("en-AU", {
            timeZone: "Australia/Sydney",
            day: "2-digit",
            month: "short",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })
            .format(new Date(iso))
            .replace(",", "");
    } catch {
        return "—";
    }
}

function formatSentDate(iso: string | null): string {
    if (!iso) return "—";
    try {
        return format(new Date(iso.slice(0, 10)), "dd MMM yyyy");
    } catch {
        return iso;
    }
}

function formatRevenue(amount: number | null): string {
    if (amount == null || amount === 0) return "—";
    return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function exportCsv(rows: RecipientRow[], campaignName: string) {
    const sydneyFmt = (iso: string) =>
        new Intl.DateTimeFormat("en-AU", {
            timeZone: "Australia/Sydney",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        })
            .format(new Date(iso))
            .replace(",", "");

    const headers = [
        "Email", "First Name", "Last Name", "Status", "Attribution", "Logged In", "Login Time", "Last Login",
        "Purchased", "Purchase Time", "Revenue",
    ];
    const lines = rows
        .map((r) =>
            [
                r.email,
                r.firstName ?? "",
                r.lastName ?? "",
                r.campaignStatus,
                r.attributionType,
                r.loggedIn ? "Yes" : "No",
                r.loginTime ? sydneyFmt(r.loginTime) : "",
                r.lastLoginTime ? sydneyFmt(r.lastLoginTime) : "",
                r.purchased ? "Yes" : "No",
                r.purchaseTime ? sydneyFmt(r.purchaseTime) : "",
                r.purchaseRevenue != null ? r.purchaseRevenue.toFixed(2) : "",
            ]
                .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                .join(",")
        );

    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaignName.replace(/[^a-z0-9]/gi, "_")}_recipients.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function CampaignFunnelPage() {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [campaignsLoading, setCampaignsLoading] = useState(false);
    const [campaignsError, setCampaignsError] = useState<string | null>(null);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [recipients, setRecipients] = useState<RecipientRow[]>([]);
    const [stats, setStats] = useState<CampaignStats | null>(null);
    const [recipientsLoading, setRecipientsLoading] = useState(false);
    const [recipientsError, setRecipientsError] = useState<string | null>(null);

    const [filterMode, setFilterMode] = useState<FilterMode>("all");
    const [sortKey, setSortKey] = useState<SortKey>("email");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    const [campaignSortDir, setCampaignSortDir] = useState<"asc" | "desc">("desc");
    const [dateFrom, setDateFrom] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    });
    const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [appliedFrom, setAppliedFrom] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    });
    const [appliedTo, setAppliedTo] = useState(() => new Date().toISOString().slice(0, 10));

    const [campaignRows, setCampaignRows] = useState<CampaignRowStats[]>([]);
    const [campaignRowsLoading, setCampaignRowsLoading] = useState(false);
    const [prevCampaignRows, setPrevCampaignRows] = useState<CampaignRowStats[]>([]);

    // Compute previous month date range from appliedFrom
    const prevMonthDates = useMemo(() => {
        const anchor = appliedFrom ? new Date(appliedFrom) : new Date();
        const prevEnd = new Date(anchor.getFullYear(), anchor.getMonth(), 0);
        const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
        return {
            from: prevStart.toISOString().slice(0, 10),
            to: prevEnd.toISOString().slice(0, 10),
        };
    }, [appliedFrom]);

    // ── Fetch campaign rows (current + prev month) ───────────────────────────

    const fetchCampaignRows = useCallback(async (from: string, to: string) => {
        setCampaignRowsLoading(true);
        try {
            const params = new URLSearchParams();
            if (from) params.set("from", from);
            if (to) params.set("to", to);
            const res = await leadsApiFetch(`/api/zoho-campaigns/campaign-stats?${params.toString()}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            setCampaignRows((await res.json()) as CampaignRowStats[]);
        } catch {
            setCampaignRows([]);
        } finally {
            setCampaignRowsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCampaignRows(appliedFrom, appliedTo);
    }, [fetchCampaignRows, appliedFrom, appliedTo]);

    // Fetch previous month campaign rows for % comparison
    const fetchPrevCampaignRows = useCallback(async (from: string, to: string) => {
        try {
            const params = new URLSearchParams({ from, to });
            const res = await leadsApiFetch(`/api/zoho-campaigns/campaign-stats?${params.toString()}`);
            if (!res.ok) return;
            setPrevCampaignRows((await res.json()) as CampaignRowStats[]);
        } catch {
            setPrevCampaignRows([]);
        }
    }, []);

    useEffect(() => {
        fetchPrevCampaignRows(prevMonthDates.from, prevMonthDates.to);
    }, [fetchPrevCampaignRows, prevMonthDates.from, prevMonthDates.to]);

    // ── Fetch campaigns ───────────────────────────────────────────────────────

    const fetchCampaigns = useCallback(async () => {
        setCampaignsLoading(true);
        setCampaignsError(null);
        try {
            const res = await leadsApiFetch("/api/zoho-campaigns/list");
            if (!res.ok) throw new Error(`Error ${res.status}`);
            setCampaigns((await res.json()) as Campaign[]);
        } catch (e) {
            setCampaignsError(e instanceof Error ? e.message : "Failed to load campaigns");
        } finally {
            setCampaignsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCampaigns();
    }, [fetchCampaigns]);

    // ── Fetch recipients ──────────────────────────────────────────────────────

    const fetchRecipients = useCallback(async (campaign: Campaign) => {
        setRecipientsLoading(true);
        setRecipientsError(null);
        setRecipients([]);
        setStats(null);
        try {
            const params = new URLSearchParams({ campaignkey: campaign.campaignKey });
            if (campaign.sentDate) params.set("sentDate", campaign.sentDate.slice(0, 10));
            const res = await leadsApiFetch(`/api/zoho-campaigns/recipients?${params.toString()}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            const data = (await res.json()) as RecipientsResponse;
            setStats(data.stats);
            setRecipients(data.recipients);
        } catch (e) {
            setRecipientsError(e instanceof Error ? e.message : "Failed to load recipients");
        } finally {
            setRecipientsLoading(false);
        }
    }, []);

    function handleSelectCampaign(campaign: Campaign) {
        if (selectedKey === campaign.campaignKey) {
            setSelectedKey(null);
            return;
        }
        setSelectedKey(campaign.campaignKey);
        setFilterMode("all");
        setSortKey("email");
        setSortDir("asc");
        fetchRecipients(campaign);
    }

    function handleSort(key: SortKey) {
        if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else {
            setSortKey(key);
            setSortDir("asc");
        }
    }

    // ── Derived data ──────────────────────────────────────────────────────────

    const filtered = useMemo(() => {
        let rows = recipients;
        if (filterMode === "clicked") rows = rows.filter((r) => r.campaignStatus === "clicked");
        if (filterMode === "opened") rows = rows.filter((r) => r.campaignStatus === "opened");
        if (filterMode === "loggedIn") rows = rows.filter((r) => r.loggedIn);
        if (filterMode === "purchased") rows = rows.filter((r) => r.purchased);

        return [...rows].sort((a, b) => {
            const av = a[sortKey],
                bv = b[sortKey];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
            return sortDir === "asc" ? cmp : -cmp;
        });
    }, [recipients, filterMode, sortKey, sortDir]);

    const visibleCols = useMemo(() => {
        const cols: { key: SortKey; label: string }[] = [
            { key: "email", label: "Email" },
            { key: "firstName", label: "Name" },
            { key: "campaignStatus", label: "Status" },
            { key: "attributionType", label: "Attribution" },
            { key: "loginTime", label: "Logged In" },
            { key: "purchaseRevenue", label: "Purchase" },
        ];
        return cols.filter((c) => c.key !== "campaignStatus" || (filterMode !== "clicked" && filterMode !== "opened"));
    }, [filterMode]);

    // Aggregate campaign rows into a SummaryStats-shaped object
    const toSummary = (rows: CampaignRowStats[]) => ({
        campaignCount: rows.length,
        emailsSent: rows.reduce((s, r) => s + r.sent, 0),
        delivered: rows.reduce((s, r) => s + r.delivered, 0),
        loggedIn: rows.reduce((s, r) => s + r.loggedIn, 0),
        addedToCart: rows.reduce((s, r) => s + r.addedToCart, 0),
        purchased: rows.reduce((s, r) => s + r.purchased, 0),
        failedPurchase: rows.reduce((s, r) => s + r.failedPurchase, 0),
        didntAddToCart: rows.reduce((s, r) => s + r.didntAddToCart, 0),
    });

    const currentSummary = useMemo(() => toSummary(campaignRows), [campaignRows]);
    const prevSummary = useMemo(() => toSummary(prevCampaignRows), [prevCampaignRows]);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-6 overflow-auto pb-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h1 className="text-xl font-semibold tracking-tight">Campaigns Dashboard</h1>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-8 rounded-md border border-input bg-secondary px-3 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:border-ring"
                    />
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-8 rounded-md border border-input bg-secondary px-3 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:border-ring"
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setAppliedFrom(dateFrom);
                            setAppliedTo(dateTo);
                        }}
                    >
                        Apply
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchCampaigns} disabled={campaignsLoading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${campaignsLoading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Summary metric cards */}
            <div className="grid grid-cols-7 gap-3">
                {(
                    [
                        { label: "Campaigns Sent", key: "campaignCount", color: "bg-slate-500/10 border-slate-500/30 text-slate-300", Icon: Send },
                        { label: "Emails Delivered", key: "delivered", color: "bg-slate-500/10 border-slate-500/30 text-slate-300", Icon: MailCheck },
                        { label: "Logged In", key: "loggedIn", color: "bg-sky-500/10 border-sky-500/30 text-sky-400", Icon: LogIn },
                        { label: "Purchased", key: "purchased", color: "bg-green-500/10 border-green-500/30 text-green-400", Icon: ShoppingBag },
                        { label: "Failed Purchase", key: "failedPurchase", color: "bg-red-500/10 border-red-500/30 text-red-400", Icon: AlertCircle },
                        { label: "Added to Cart", key: "addedToCart", color: "bg-amber-500/10 border-amber-500/30 text-amber-400", Icon: ShoppingCart },
                        { label: "Didn't Add to Cart", key: "didntAddToCart", color: "bg-orange-500/10 border-orange-500/30 text-orange-400", Icon: MinusCircle },
                    ] as { label: string; key: keyof typeof currentSummary; color: string; Icon: ElementType }[]
                ).map((card) => {
                    const cur = currentSummary[card.key] ?? 0;
                    const prev = prevSummary[card.key] ?? 0;
                    const diff = prev === 0 ? null : ((cur - prev) / prev) * 100;
                    const diffLabel =
                        diff === null ? null : diff === 0 ? (
                            <span className="text-muted-foreground/50">—</span>
                        ) : (
                            <span className={diff > 0 ? "text-green-400" : "text-red-400"}>
                                {diff > 0 ? "↑" : "↓"} {Math.abs(Math.round(diff))}%
                            </span>
                        );

                    return (
                        <div key={card.label} className={`rounded-lg border p-3 flex flex-col items-start text-left gap-1 ${card.color}`}>
                            <card.Icon className="h-6 w-6 opacity-60 shrink-0" />
                            <div className="text-xs font-medium leading-tight">{card.label}</div>
                            <div className="text-xl font-bold">
                                {campaignRowsLoading ? <span className="text-muted-foreground/40 text-base">…</span> : cur.toLocaleString()}
                            </div>
                            <div className="text-xs">
                                {campaignRowsLoading ? null : diffLabel}
                                {!campaignRowsLoading && <span className="text-muted-foreground/50 ml-1">vs prev</span>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Campaigns list */}
            <section>
                <h2 className="text-lg font-semibold mb-3">Campaign Performance</h2>
                {campaignsError && <p className="text-sm text-red-400 mb-2">{campaignsError}</p>}
                {(campaignsLoading || campaignRowsLoading) && <p className="text-sm text-muted-foreground">Loading campaigns…</p>}
                {!campaignsLoading && !campaignRowsLoading && !campaignsError && campaignRows.length === 0 && (
                    <p className="text-sm text-muted-foreground">No campaigns found.</p>
                )}

                {campaignRows.length > 0 && (
                    <div className="border rounded-md overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-muted text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                                    <tr>
                                        <th className="text-left px-3 py-2 whitespace-nowrap">Campaign</th>
                                        <th
                                            className="text-right px-3 py-2 cursor-pointer select-none whitespace-nowrap"
                                            onClick={() => setCampaignSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                                        >
                                            Sent Date
                                            {campaignSortDir === "desc" ? (
                                                <ChevronDown className="inline ml-1 h-3 w-3" />
                                            ) : (
                                                <ChevronUp className="inline ml-1 h-3 w-3" />
                                            )}
                                        </th>
                                        <th className="text-right px-2 py-2 whitespace-nowrap">Sent</th>
                                        <th className="text-right px-2 py-2 whitespace-nowrap">Logged In</th>
                                        <th className="text-right px-2 py-2 whitespace-nowrap">Cart</th>
                                        <th className="text-right px-2 py-2 whitespace-nowrap">Purchased</th>
                                        <th className="text-right px-2 py-2 whitespace-nowrap">Conv. %</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {[...campaignRows]
                                        .sort((a, b) => {
                                            const ad = a.sentDate ?? "",
                                                bd = b.sentDate ?? "";
                                            return campaignSortDir === "desc" ? bd.localeCompare(ad) : ad.localeCompare(bd);
                                        })
                                        .map((row) => {
                                            const campaign = campaigns.find((c) => c.campaignKey === row.campaignKey);
                                            return (
                                                <Fragment key={row.campaignKey}>
                                                    <tr
                                                        onClick={() => campaign && handleSelectCampaign(campaign)}
                                                        className={`cursor-pointer transition-colors hover:bg-accent ${
                                                            selectedKey === row.campaignKey ? "bg-primary/5 border-l-2 border-l-primary" : ""
                                                        }`}
                                                    >
                                                        <td className="px-2 py-2 font-medium max-w-[260px]">
                                                            <span className="flex items-center gap-2">
                                                                <ChevronDown
                                                                    className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${
                                                                        selectedKey === row.campaignKey ? "rotate-180" : ""
                                                                    }`}
                                                                />
                                                                <span className="truncate">{row.campaignName}</span>
                                                            </span>
                                                            <span
                                                                className="ml-5 font-mono text-[10px] text-muted-foreground bg-slate-500/15 px-1 py-0.5 rounded cursor-pointer hover:bg-slate-500/25 select-all"
                                                                title="Click to copy campaignkey (use as utm_campaign in Zoho email link)"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    navigator.clipboard.writeText(row.campaignKey);
                                                                }}
                                                            >
                                                                {row.campaignKey}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-2 text-right text-muted-foreground whitespace-nowrap">{formatSentDate(row.sentDate)}</td>
                                                        <td className="px-2 py-2 text-right">{row.sent.toLocaleString()}</td>
                                                        <td className="px-2 py-2 text-right">{row.loggedIn.toLocaleString()}</td>
                                                        <td className="px-2 py-2 text-right text-amber-400">{row.addedToCart.toLocaleString()}</td>
                                                        <td className="px-2 py-2 text-right">
                                                            <span className="font-medium text-green-400">{row.purchased.toLocaleString()}</span>
                                                            {row.revenue > 0 && (
                                                                <span className="text-xs text-muted-foreground ml-1">({formatRevenue(row.revenue)})</span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-2 text-right">
                                                            <span
                                                                className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                                                    row.convRate > 0 ? "bg-green-500/15 text-green-400" : "text-muted-foreground"
                                                                }`}
                                                            >
                                                                {row.convRate > 0 ? `${row.convRate}%` : "—"}
                                                            </span>
                                                        </td>
                                                    </tr>

                                                    {selectedKey === row.campaignKey && (
                                                        <tr>
                                                            <td colSpan={7} className="px-4 py-4 bg-muted/30 border-t">
                                                                {recipientsLoading && <p className="text-sm text-muted-foreground py-2">Loading recipients and PostHog data…</p>}
                                                                {recipientsError && <p className="text-sm text-red-400 py-2">{recipientsError}</p>}

                                                                {/* Recipient table */}
                                                                {!recipientsLoading && !recipientsError && recipients.length > 0 && (
                                                                    <div className="border rounded-md overflow-hidden bg-card">
                                                                        <div className="px-3 py-2 bg-muted/50 text-xs text-muted-foreground flex items-center gap-2 border-b">
                                                                            {filterMode !== "all" && (
                                                                                <button
                                                                                    className="text-primary underline underline-offset-2"
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setFilterMode("all");
                                                                                    }}
                                                                                >
                                                                                    Clear filter
                                                                                </button>
                                                                            )}
                                                                            <span className="text-muted-foreground">
                                                                                {recipients.length.toLocaleString()} engaged (opened / clicked)
                                                                            </span>
                                                                            <button
                                                                                className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    exportCsv(filtered, row.campaignName);
                                                                                }}
                                                                            >
                                                                                <Download className="h-3 w-3" />
                                                                                Export CSV
                                                                            </button>
                                                                        </div>
                                                                        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                                                                            <table className="w-full text-sm">
                                                                                <thead className="bg-card sticky top-0 border-b text-xs text-muted-foreground font-semibold uppercase tracking-wide">
                                                                                    <tr>
                                                                                        {visibleCols.map(({ key, label }) => (
                                                                                            <th
                                                                                                key={key}
                                                                                                className="text-left px-2 py-1.5 cursor-pointer select-none whitespace-nowrap"
                                                                                                onClick={(e) => {
                                                                                                    e.stopPropagation();
                                                                                                    handleSort(key);
                                                                                                }}
                                                                                            >
                                                                                                {label}
                                                                                                <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                                                                                            </th>
                                                                                        ))}
                                                                                        <th className="px-2 py-1.5 text-left">Replay</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody className="divide-y">
                                                                                    {filtered.map((r) => (
                                                                                        <tr key={r.email} className="hover:bg-accent/50 transition-colors">
                                                                                            <td className="px-2 py-1.5 font-mono text-xs max-w-[180px] truncate" title={r.email}>
                                                                                                {r.email}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                                                                                                {r.firstName || r.lastName ? (
                                                                                                    `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim()
                                                                                                ) : (
                                                                                                    <span className="text-muted-foreground/30">—</span>
                                                                                                )}
                                                                                            </td>
                                                                                            {filterMode !== "clicked" && filterMode !== "opened" && (
                                                                                                <td className="px-2 py-1.5">
                                                                                                    <span
                                                                                                        className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${
                                                                                                            r.campaignStatus === "clicked"
                                                                                                                ? "bg-green-500/15 text-green-400"
                                                                                                                : "bg-sky-500/15 text-sky-400"
                                                                                                        }`}
                                                                                                    >
                                                                                                        {r.campaignStatus}
                                                                                                    </span>
                                                                                                </td>
                                                                                            )}
                                                                                            <td className="px-2 py-1.5">
                                                                                                {r.attributionType === "click-through" ? (
                                                                                                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-500/15 text-green-400">
                                                                                                        click-thru
                                                                                                    </span>
                                                                                                ) : r.attributionType === "inferred" ? (
                                                                                                    <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-500/15 text-yellow-400">
                                                                                                        inferred
                                                                                                    </span>
                                                                                                ) : (
                                                                                                    <span className="text-muted-foreground/30 text-xs">—</span>
                                                                                                )}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                                                                                                {formatDate(r.loginTime)}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5 text-xs font-medium whitespace-nowrap">
                                                                                                {r.purchased ? (
                                                                                                    <span className="text-green-400">{formatRevenue(r.purchaseRevenue) || "Purchased"}</span>
                                                                                                ) : (
                                                                                                    <span className="text-muted-foreground/30">—</span>
                                                                                                )}
                                                                                            </td>
                                                                                            <td className="px-2 py-1.5">
                                                                                                {r.replayUrl ? (
                                                                                                    <a
                                                                                                        href={r.replayUrl}
                                                                                                        target="_blank"
                                                                                                        rel="noopener noreferrer"
                                                                                                        className="text-primary hover:opacity-70"
                                                                                                        onClick={(e) => e.stopPropagation()}
                                                                                                    >
                                                                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                                                                    </a>
                                                                                                ) : (
                                                                                                    <span className="text-muted-foreground/30">—</span>
                                                                                                )}
                                                                                            </td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {!recipientsLoading && !recipientsError && recipients.length === 0 && stats && (
                                                                    <p className="text-sm text-muted-foreground">No opens or clicks recorded for this campaign.</p>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )}
                                                </Fragment>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}


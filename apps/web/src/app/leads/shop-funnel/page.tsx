"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { format } from "date-fns";
import { RefreshCw, Download, ChevronUp, ChevronDown, ChevronsUpDown, ExternalLink, ChevronRight } from "lucide-react";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import { Button } from "@/components/ui/button";
import type { LoginJourneyRow, HistoryRow } from "@/types/shopFunnel";

type SortKey = keyof LoginJourneyRow;
function todayStr() {
    return format(new Date(), "yyyy-MM-dd");
}

const FUNNEL_STEPS: { label: string; key: keyof LoginJourneyRow; color: string }[] = [
    { label: "Logged In", key: "loginTime", color: "bg-slate-500/15 text-slate-300" },
    { label: "Viewed Products", key: "viewed_products", color: "bg-sky-500/15 text-sky-400" },
    { label: "Added to Cart", key: "added_to_cart", color: "bg-orange-500/15 text-orange-400" },
    { label: "Placed Order", key: "placed_order", color: "bg-violet-500/15 text-violet-400" },
    { label: "Purchase Complete", key: "purchase_complete", color: "bg-green-500/15 text-green-400" },
];

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string; sortDir: "asc" | "desc" }) {
    if (col !== sortKey) return <ChevronsUpDown className="inline ml-1 h-3 w-3 text-muted-foreground/40" />;
    return sortDir === "asc" ? (
        <ChevronUp className="inline ml-1 h-3 w-3" />
    ) : (
        <ChevronDown className="inline ml-1 h-3 w-3" />
    );
}

function BoolCell({ value }: { value: boolean }) {
    return value ? (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500/15 text-green-400 text-xs font-bold select-none">
            ✓
        </span>
    ) : (
        <span className="text-muted-foreground/30 select-none">—</span>
    );
}

export default function ShopFunnelPage() {
    const [allUsers, setAllUsers] = useState<LoginJourneyRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [date, setDate] = useState(todayStr());
    const [appliedDate, setAppliedDate] = useState(todayStr());
    const [sortKey, setSortKey] = useState<SortKey>("fullName");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

    // Accordion state
    const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
    const [loadingEmail, setLoadingEmail] = useState<string | null>(null);
    const [historyCache, setHistoryCache] = useState<Record<string, HistoryRow[]>>({});
    const historyCacheRef = useRef<Record<string, HistoryRow[]>>({});

    // Clear accordion when date changes
    useEffect(() => {
        setExpandedEmail(null);
        setHistoryCache({});
        historyCacheRef.current = {};
    }, [appliedDate]);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ date: appliedDate });
            const res = await leadsApiFetch(`/api/shop-funnel/users?${params.toString()}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            const data: LoginJourneyRow[] = await res.json();
            setAllUsers(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load data");
        } finally {
            setLoading(false);
        }
    }, [appliedDate]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    function handleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir("asc");
        }
    }

    const users = allUsers;

    const sorted = useMemo(() => {
        return [...users].sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            let cmp: number;
            if (typeof av === "boolean" && typeof bv === "boolean") {
                cmp = av === bv ? 0 : av ? -1 : 1;
            } else {
                cmp = String(av ?? "").localeCompare(String(bv ?? ""));
            }
            return sortDir === "asc" ? cmp : -cmp;
        });
    }, [users, sortKey, sortDir]);

    const counts = useMemo(
        () => ({
            total: allUsers.length,
            viewed_products: users.filter((u) => u.viewed_products).length,
            added_to_cart: users.filter((u) => u.added_to_cart).length,
            placed_order: users.filter((u) => u.placed_order).length,
            purchase_complete: users.reduce((sum, u) => sum + (u.order_count ?? (u.purchase_complete ? 1 : 0)), 0),
        }),
        [allUsers, users]
    );

    async function handleExpand(email: string) {
        if (expandedEmail === email) {
            setExpandedEmail(null);
            return;
        }
        setExpandedEmail(email);
        if (email in historyCacheRef.current) return;
        setLoadingEmail(email);
        try {
            const params = new URLSearchParams({ endDate: appliedDate });
            const res = await leadsApiFetch(`/api/shop-funnel/users/${encodeURIComponent(email)}/history?${params}`);
            const data: HistoryRow[] = res.ok ? await res.json() : [];
            historyCacheRef.current = { ...historyCacheRef.current, [email]: data };
            setHistoryCache(historyCacheRef.current);
        } catch {
            historyCacheRef.current = { ...historyCacheRef.current, [email]: [] };
            setHistoryCache(historyCacheRef.current);
        } finally {
            setLoadingEmail(null);
        }
    }

    function applyDate() {
        setAppliedDate(date);
    }

    function exportCsv() {
        const BOOL = (v: boolean) => (v ? "Yes" : "No");
        const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const headers = ["Email", "Full Name", "Viewed Products", "Added to Cart", "Placed Order", "Purchase Complete"];
        const rows = sorted.map((u) =>
            [
                esc(u.email),
                esc(u.fullName),
                BOOL(u.viewed_products),
                BOOL(u.added_to_cart),
                BOOL(u.placed_order),
                BOOL(u.purchase_complete),
            ].join(",")
        );
        const csv = [headers.join(","), ...rows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `shop-funnel-${appliedDate}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const thClass = (_col: SortKey) =>
        `text-xs font-semibold uppercase tracking-wide text-muted-foreground sticky top-0 bg-muted z-10 cursor-pointer select-none hover:text-foreground transition-colors`;

    const dateLabel = format(new Date(appliedDate + "T00:00:00"), "MMM d, yyyy");

    return (
        <div className="flex flex-col gap-6 h-full min-h-0">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Shop Funnel</h1>
                    <p className="text-sm text-muted-foreground">
                        {allUsers.length} patient{allUsers.length !== 1 ? "s" : ""} logged in · {dateLabel}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exportCsv} disabled={sorted.length === 0}>
                        <Download className="h-4 w-4 mr-2" />
                        Export CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Date picker */}
                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Date</label>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && applyDate()}
                        className="h-8 rounded-md border border-input bg-secondary px-3 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:border-ring"
                    />
                    <Button size="sm" onClick={applyDate} disabled={date === appliedDate || loading}>
                        Apply
                    </Button>
                </div>
            </div>

            {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md p-4">{error}</div>}
            {loading && !allUsers.length && (
                <div className="text-sm text-muted-foreground text-center py-16">Loading…</div>
            )}

            {allUsers.length > 0 && (
                <>
                    {/* Funnel summary bar */}
                    <div className="flex flex-wrap gap-2 text-sm">
                        {FUNNEL_STEPS.map((s, i) => {
                            const count = s.key === "loginTime" ? counts.total : counts[s.key as keyof typeof counts];
                            return (
                                <span
                                    key={s.key}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md font-medium ${s.color}`}
                                >
                                    {i > 0 && <span className="opacity-40 font-normal">›</span>}
                                    {s.label}
                                    <span className="font-bold">{count}</span>
                                </span>
                            );
                        })}
                    </div>

                    {/* Table */}
                    <div className="border rounded-lg overflow-auto flex-1 min-h-0">
                        <table className="w-full text-sm">
                            <thead className="bg-muted">
                                <tr>
                                    <th className={`${thClass("fullName")} text-left px-3 py-2 w-60`} onClick={() => handleSort("fullName")}>
                                        User <SortIcon col="fullName" sortKey={sortKey} sortDir={sortDir} />
                                    </th>
                                    <th
                                        className={`${thClass("allowance")} text-center px-2 py-2 w-24`}
                                        onClick={() => handleSort("allowance")}
                                        title="Days of supply remaining at time of login"
                                    >
                                        Allowance <SortIcon col="allowance" sortKey={sortKey} sortDir={sortDir} />
                                    </th>
                                    <th className={`${thClass("viewed_products")} text-center px-2 py-2 w-28`} onClick={() => handleSort("viewed_products")}>
                                        Viewed Products <SortIcon col="viewed_products" sortKey={sortKey} sortDir={sortDir} />
                                    </th>
                                    <th className={`${thClass("added_to_cart")} text-center px-2 py-2 w-28`} onClick={() => handleSort("added_to_cart")}>
                                        Added to Cart <SortIcon col="added_to_cart" sortKey={sortKey} sortDir={sortDir} />
                                    </th>
                                    <th
                                        className={`${thClass("placed_order")} text-center px-2 py-2 w-28`}
                                        onClick={() => handleSort("placed_order")}
                                        title="Placed Order means an order record was created in Saleor. Payment confirmation via Stripe is tracked separately."
                                    >
                                        Placed Order *{" "}
                                        <SortIcon col="placed_order" sortKey={sortKey} sortDir={sortDir} />
                                    </th>
                                    <th
                                        className={`${thClass("purchase_complete")} text-center px-2 py-2 w-32`}
                                        onClick={() => handleSort("purchase_complete")}
                                        title="Purchase Complete means the patient's email appears in orders_to_dispatch for that date (Sydney time)."
                                    >
                                        Purchase Complete
                                        <SortIcon col="purchase_complete" sortKey={sortKey} sortDir={sortDir} />
                                    </th>
                                    <th className="font-medium text-muted-foreground sticky top-0 bg-muted z-10 text-center px-2 py-2 w-20">
                                        Replay
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="text-center text-muted-foreground py-10">
                                            No patients logged in on this date.
                                        </td>
                                    </tr>
                                ) : (
                                    sorted.map((u, i) => {
                                        const isExpanded = expandedEmail === u.email;
                                        const isLoading = loadingEmail === u.email;
                                        const history = historyCache[u.email];
                                        return (
                                            <Fragment key={i}>
                                                {/* ── Main row ── */}
                                                <tr
                                                    className="border-t hover:bg-muted/30 transition-colors cursor-pointer"
                                                    onClick={() => handleExpand(u.email)}
                                                >
                                                    <td className="px-3 py-2.5 overflow-hidden max-w-0 w-60">
                                                        <div className="flex items-center gap-1.5">
                                                            {isExpanded ? (
                                                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                                                            ) : (
                                                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                                                            )}
                                                            <div className="min-w-0">
                                                                <div className="font-medium truncate" title={u.fullName}>
                                                                    {u.fullName || "—"}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground truncate" title={u.email}>
                                                                    {u.email}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-2.5 text-center">
                                                        {u.allowance != null ? (
                                                            <span
                                                                className={`text-sm font-medium ${Number(u.allowance) === 0 ? "text-red-400" : "text-green-400"}`}
                                                            >
                                                                {u.allowance}
                                                            </span>
                                                        ) : (
                                                            <span className="text-muted-foreground/30 select-none">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-2.5 text-center">
                                                        <BoolCell value={u.viewed_products} />
                                                    </td>
                                                    <td className="px-2 py-2.5 text-center">
                                                        <BoolCell value={u.added_to_cart} />
                                                    </td>
                                                    <td className="px-2 py-2.5 text-center">
                                                        <BoolCell value={u.placed_order} />
                                                    </td>
                                                    <td className="px-2 py-2.5 text-center">
                                                        <div className="inline-flex items-center gap-1">
                                                            <BoolCell value={u.purchase_complete} />
                                                            {u.order_count > 1 && (
                                                                <span className="text-[10px] font-bold text-green-400 bg-green-500/15 rounded px-1">
                                                                    ×{u.order_count}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-2 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                        {u.replayUrl ? (
                                                            <a
                                                                href={u.replayUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
                                                            >
                                                                <ExternalLink className="h-3 w-3" />
                                                                Watch
                                                            </a>
                                                        ) : (
                                                            <span className="text-muted-foreground/30 select-none">—</span>
                                                        )}
                                                    </td>
                                                </tr>

                                                {/* ── Accordion: loading skeletons ── */}
                                                {isExpanded &&
                                                    isLoading &&
                                                    [1, 2, 3].map((n) => (
                                                        <tr key={`skel-${n}`} className="bg-muted/20 border-t">
                                                            <td className="px-3 py-2 pl-8 border-l-2 border-blue-500/30">
                                                                <div className="h-3 bg-muted/70 rounded animate-pulse w-24" />
                                                            </td>
                                                            {[...Array(6)].map((_, k) => (
                                                                <td key={k} className="px-2 py-2 text-center">
                                                                    <div className="h-3 bg-muted/50 rounded animate-pulse w-5 mx-auto" />
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}

                                                {/* ── Accordion: history rows ── */}
                                                {isExpanded &&
                                                    !isLoading &&
                                                    history !== undefined &&
                                                    (history.length === 0 ? (
                                                        <tr className="bg-muted/20 border-t">
                                                            <td colSpan={7} className="pl-10 py-2.5 text-xs text-muted-foreground italic">
                                                                No sessions in the past 7 days
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        history.map((h, j) => (
                                                            <tr key={`h-${j}`} className="bg-muted/20 border-t text-xs">
                                                                <td className="px-3 py-2 pl-7 border-l-2 border-blue-500/30 w-60">
                                                                    <div className="font-medium text-muted-foreground">
                                                                        {format(new Date(h.date + "T00:00:00"), "MMM d, yyyy")}
                                                                    </div>
                                                                    <div className="text-muted-foreground/60">
                                                                        {h.loginTime ? format(new Date(h.loginTime), "h:mm a") : "—"}
                                                                    </div>
                                                                </td>
                                                                <td className="px-2 py-2 text-center">
                                                                    {h.allowance != null ? (
                                                                        <span
                                                                            className={`font-medium ${Number(h.allowance) === 0 ? "text-red-400" : "text-green-400"}`}
                                                                        >
                                                                            {h.allowance}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-muted-foreground/30">—</span>
                                                                    )}
                                                                </td>
                                                                <td className="px-2 py-2 text-center">
                                                                    <BoolCell value={h.viewed_products} />
                                                                </td>
                                                                <td className="px-2 py-2 text-center">
                                                                    <BoolCell value={h.added_to_cart} />
                                                                </td>
                                                                <td className="px-2 py-2 text-center">
                                                                    <BoolCell value={h.placed_order} />
                                                                </td>
                                                                <td className="px-2 py-2 text-center">
                                                                    <div className="inline-flex items-center gap-1">
                                                                        <BoolCell value={h.purchase_complete} />
                                                                        {h.order_count > 1 && (
                                                                            <span className="text-[10px] font-bold text-green-400 bg-green-500/15 rounded px-1">
                                                                                ×{h.order_count}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-2 py-2 text-center">
                                                                    {h.replayUrl ? (
                                                                        <a
                                                                            href={h.replayUrl}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline"
                                                                        >
                                                                            <ExternalLink className="h-3 w-3" />
                                                                            Watch
                                                                        </a>
                                                                    ) : (
                                                                        <span className="text-muted-foreground/30">—</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    ))}
                                            </Fragment>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Footnote */}
                    <p className="text-xs text-muted-foreground">
                        * <strong>Placed Order</strong> means an order record was created in Saleor (pre-payment).
                        <strong> Purchase Complete</strong> means the patient&apos;s email appears in{" "}
                        <code>orders_to_dispatch</code> for that date (Sydney time).
                    </p>
                </>
            )}

            {!loading && allUsers.length === 0 && !error && (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                    No patients logged in on {dateLabel}.
                </div>
            )}
        </div>
    );
}

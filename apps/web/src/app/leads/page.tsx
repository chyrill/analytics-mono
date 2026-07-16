"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format } from "date-fns";
import { Search, RefreshCw, ChevronDown } from "lucide-react";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import type { Lead, PaginatedLeads, LeadSource, LeadsSummary } from "@/types/lead";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { SourceBadge, StageBadge } from "@/components/leads/LeadBadges";
import { DateRangeFilter } from "@/components/leads/DateRangeFilter";

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
    { value: "none", label: "No status" },
    { value: "1 - Reg Form Completed", label: "1 - Reg Form Completed" },
    { value: "2 - Questionnaire Completed", label: "2 - Questionnaire Completed" },
    { value: "8 - Booking Page Reached", label: "8 - Booking Page Reached" },
    { value: "9a - Doctor Approved Unrestricted", label: "9a - Doctor Approved Unrestricted" },
    { value: "9b - Approve Subject To Discharge", label: "9b - Approve Subject To Discharge" },
    { value: "10 - Doctor Rejected", label: "10 - Doctor Rejected" },
    { value: "13 - Consult Booked", label: "13 - Consult Booked" },
    { value: "20 - Booking Not Confirmed", label: "20 - Booking Not Confirmed" },
];
const ALL_STATUSES = STATUS_OPTIONS.map((o) => o.value);

function StatusMultiSelect({
    value,
    onChange,
}: {
    value: string[];
    onChange: (v: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        if (open) document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const allSelected = value.length === 0 || value.length === ALL_STATUSES.length;
    const label = allSelected
        ? "Any status"
        : value.length === 1
            ? (STATUS_OPTIONS.find((o) => o.value === value[0])?.label ?? value[0])
            : `${value.length} statuses`;

    function toggleAll() {
        onChange(allSelected ? [] : [...ALL_STATUSES]);
    }

    function toggle(v: string) {
        onChange(value.includes(v) ? value.filter((s) => s !== v) : [...value, v]);
    }

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex h-8 w-56 items-center justify-between rounded-md border border-input bg-secondary px-3 py-1.5 text-xs gap-2"
            >
                <span className="truncate text-left">{label}</span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
            </button>
            {open && (
                <div className="absolute z-50 mt-1 w-64 rounded-md border bg-popover">
                    <div className="p-1">
                        <label className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent cursor-pointer select-none">
                            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4" />
                            <span className="font-medium">All</span>
                        </label>
                        <div className="my-1 border-t" />
                        {STATUS_OPTIONS.map((opt) => (
                            <label
                                key={opt.value}
                                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent cursor-pointer select-none"
                            >
                                <input
                                    type="checkbox"
                                    checked={value.length === 0 || value.includes(opt.value)}
                                    onChange={() => toggle(opt.value)}
                                    className="h-4 w-4"
                                />
                                {opt.value === "none" ? (
                                    <span className="italic text-muted-foreground">{opt.label}</span>
                                ) : (
                                    <span>{opt.label}</span>
                                )}
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function todayStr() {
    return format(new Date(), "yyyy-MM-dd");
}

export default function LeadsPage() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [summary, setSummary] = useState<LeadsSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useState("");
    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [stageFilter, setStageFilter] = useState<string>("all");
    const [consultDateFilter, setConsultDateFilter] = useState<string>("all");
    const [memberStatusFilter, setMemberStatusFilter] = useState<string[]>([]);
    const [moduleFilter, setModuleFilter] = useState<string>("all");
    const [dateFrom, setDateFrom] = useState(todayStr());
    const [dateTo, setDateTo] = useState(todayStr());
    const [appliedFrom, setAppliedFrom] = useState(todayStr());
    const [appliedTo, setAppliedTo] = useState(todayStr());
    const [dateMode, setDateMode] = useState<"range" | "specific">("specific");

    // Sentinel thrown when API is still starting — triggers silent retry
    const API_NOT_READY = "API_NOT_READY";

    const fetchLeads = useCallback(
        async (currentPage: number) => {
            setLoading(true);
            setError(null);
            try {
                const params = new URLSearchParams({
                    page: String(currentPage),
                    limit: String(PAGE_SIZE),
                });
                if (search) params.set("search", search);
                if (sourceFilter !== "all") params.set("source", sourceFilter);
                if (stageFilter !== "all") params.set("stage", stageFilter);
                if (consultDateFilter !== "all") params.set("consultDate", consultDateFilter);
                if (memberStatusFilter.length > 0 && memberStatusFilter.length < ALL_STATUSES.length) {
                    params.set("memberStatus", memberStatusFilter.join(","));
                }
                if (moduleFilter !== "all") params.set("module", moduleFilter);
                if (appliedFrom) params.set("from", appliedFrom);
                if (appliedTo) params.set("to", appliedTo);

                const res = await leadsApiFetch(`/api/leads?${params.toString()}`);
                if (res.status === 503) throw API_NOT_READY;
                if (!res.ok) throw new Error(`Error ${res.status}`);
                const data: PaginatedLeads = await res.json();
                setLeads(data.data);
                setTotal(data.total);
                setTotalPages(data.totalPages);
                setSummary(data.summary ?? null);
                setConnecting(false);
            } catch (e) {
                throw e;
            } finally {
                setLoading(false);
            }
        },
        [search, sourceFilter, stageFilter, consultDateFilter, memberStatusFilter, moduleFilter, appliedFrom, appliedTo]
    );

    useEffect(() => {
        setPage(1);
    }, [search, sourceFilter, stageFilter, consultDateFilter, memberStatusFilter, moduleFilter, appliedFrom, appliedTo]);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout>;

        const attempt = (delay: number) => {
            retryTimer = setTimeout(async () => {
                if (cancelled) return;
                try {
                    await fetchLeads(page);
                } catch (e) {
                    if (!cancelled) {
                        if (e === API_NOT_READY) {
                            // API still booting — show spinner, retry with back-off
                            setConnecting(true);
                            setError(null);
                            attempt(Math.min(Math.max(delay * 2, 1000), 8000));
                        } else {
                            // Real error — show it, stop retrying
                            setConnecting(false);
                            setError(e instanceof Error ? e.message : "Failed to load leads");
                        }
                    }
                }
            }, delay);
        };

        attempt(0);
        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
        };
    }, [fetchLeads, page]);

    function formatDate(iso: string | null) {
        if (!iso) return "—";
        try {
            return format(new Date(iso), "MMM d, yyyy");
        } catch {
            return iso;
        }
    }

    function formatDateTime(iso: string | null) {
        if (!iso) return "—";
        try {
            return format(new Date(iso), "MMM d, yyyy h:mm a");
        } catch {
            return iso;
        }
    }

    const zohoDatacenter = process.env.NEXT_PUBLIC_ZOHO_DATACENTER ?? "com";
    const zohoOrgId = process.env.NEXT_PUBLIC_ZOHO_ORG_ID ?? "";

    return (
        <div className="flex flex-col h-full min-h-0 gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
                    <p className="text-sm text-muted-foreground">{total} leads in range</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchLeads(page)} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </div>

            {/* Date Filter */}
            <DateRangeFilter
                dateMode={dateMode}
                dateFrom={dateFrom}
                dateTo={dateTo}
                label="Lead date"
                onModeChange={setDateMode}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onApply={(from, to) => {
                    setAppliedFrom(from);
                    setAppliedTo(to);
                }}
            />

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search name, email, phone…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9"
                    />
                </div>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All sources</SelectItem>
                        <SelectItem value="meta">Meta</SelectItem>
                        <SelectItem value="google_ads">Google</SelectItem>
                        <SelectItem value="organic">Organic</SelectItem>
                        <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={stageFilter} onValueChange={setStageFilter}>
                    <SelectTrigger className="w-36">
                        <SelectValue placeholder="All stages" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All stages</SelectItem>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="booked">Booked</SelectItem>
                        <SelectItem value="consulted">Consulted</SelectItem>
                        <SelectItem value="purchased">Purchased</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={consultDateFilter} onValueChange={setConsultDateFilter}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="Consult date" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Any consult date</SelectItem>
                        <SelectItem value="has">Has consult date</SelectItem>
                        <SelectItem value="none">No consult date</SelectItem>
                    </SelectContent>
                </Select>
                <StatusMultiSelect value={memberStatusFilter} onChange={setMemberStatusFilter} />
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                    <SelectTrigger className="w-40">
                        <SelectValue placeholder="All modules" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All modules</SelectItem>
                        <SelectItem value="Leads">Leads only</SelectItem>
                        <SelectItem value="Contacts">Contacts (converted)</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-0 flex flex-col gap-6">
                {connecting ? (
                    <div className="text-sm text-muted-foreground bg-muted rounded-md p-4 flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                        Connecting to API…
                    </div>
                ) : error ? (
                    <div className="text-sm text-destructive bg-destructive/10 rounded-md p-4">{error}</div>
                ) : (
                    <>
                        {summary && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {[
                                    {
                                        label: "Total Leads",
                                        value: summary.total.toLocaleString(),
                                        sub: summary.dbRegistered != null ? `${summary.dbRegistered.toLocaleString()} registered in app` : null,
                                        color: "text-foreground",
                                    },
                                    {
                                        label: "Has Booking",
                                        value: summary.booked.toLocaleString(),
                                        sub: summary.total > 0 ? `${((summary.booked / summary.total) * 100).toFixed(0)}% of leads` : null,
                                        color: "text-violet-400",
                                    },
                                    {
                                        label: "Consulted",
                                        value: summary.consulted.toLocaleString(),
                                        sub: summary.booked > 0 ? `${((summary.consulted / summary.booked) * 100).toFixed(0)}% of booked` : null,
                                        color: "text-blue-400",
                                    },
                                    {
                                        label: "Activated",
                                        value: summary.purchased.toLocaleString(),
                                        sub: summary.consulted > 0 ? `${((summary.purchased / summary.consulted) * 100).toFixed(0)}% of consulted` : null,
                                        color: "text-green-400",
                                    },
                                ].map(({ label, value, sub, color }) => (
                                    <div key={label} className="bg-card border rounded-lg px-4 py-3">
                                        <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
                                        <div className={`text-xl font-bold ${color}`}>{value}</div>
                                        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="border rounded-lg flex-1 min-h-0 overflow-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="sticky top-0 bg-muted z-10">Name</TableHead>
                                        <TableHead className="sticky top-0 bg-muted z-10">Campaign</TableHead>
                                        <TableHead className="sticky top-0 bg-muted z-10">Lead Date</TableHead>
                                        <TableHead className="sticky top-0 bg-muted z-10">Stage</TableHead>
                                        <TableHead className="sticky top-0 bg-muted z-10">Consult Date</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading && leads.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                                                Loading…
                                            </TableCell>
                                        </TableRow>
                                    ) : leads.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                                                No leads found for this date range.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        leads.map((lead) => (
                                            <TableRow key={lead.id}>
                                                <TableCell>
                                                    <a
                                                        href={`https://crm.zoho.${zohoDatacenter}/crm/org${zohoOrgId}/tab/${lead.zohoModule}/${lead.zohoLeadId}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-medium hover:underline text-blue-400"
                                                    >
                                                        {lead.name || "—"}
                                                    </a>
                                                    <div
                                                        className={`text-xs ${lead.email?.toLowerCase().includes("test") ? "text-amber-400 font-medium" : "text-muted-foreground"}`}
                                                    >
                                                        {lead.email?.toLowerCase().includes("test") ? "⚠ " : ""}
                                                        {lead.email ?? lead.phone ?? ""}
                                                    </div>
                                                    <div className="mt-0.5">
                                                        <SourceBadge source={lead.source as LeadSource} />
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="text-sm">{lead.utmCampaign ?? "—"}</div>
                                                    {lead.utmMedium && <div className="text-xs text-muted-foreground">{lead.utmMedium}</div>}
                                                </TableCell>
                                                <TableCell className="text-sm">{formatDate(lead.createdAt)}</TableCell>
                                                <TableCell>
                                                    <StageBadge stage={lead.stage} />
                                                </TableCell>
                                                <TableCell className="text-sm">{formatDateTime(lead.bookedAt)}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                        Page {page} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

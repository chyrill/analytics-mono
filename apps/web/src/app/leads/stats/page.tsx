"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import type { LeadsStats, LeadSource } from "@/types/lead";
import type { PatientRow } from "@/types/funnel";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "@/components/leads/LeadBadges";
import { DateRangeFilter } from "@/components/leads/DateRangeFilter";

function pct(n: number) {
    return n > 0 ? `${(n * 100).toFixed(1)}%` : "—";
}

function todayStr() {
    return format(new Date(), "yyyy-MM-dd");
}

export default function StatsPage() {
    const [stats, setStats] = useState<LeadsStats | null>(null);
    const [funnelPatients, setFunnelPatients] = useState<PatientRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [dateFrom, setDateFrom] = useState(todayStr());
    const [dateTo, setDateTo] = useState(todayStr());
    const [appliedFrom, setAppliedFrom] = useState(todayStr());
    const [appliedTo, setAppliedTo] = useState(todayStr());
    const [dateMode, setDateMode] = useState<"range" | "specific">("specific");

    const fetchStats = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (appliedFrom) params.set("from", appliedFrom);
            if (appliedTo) params.set("to", appliedTo);
            const [statsRes, funnelRes] = await Promise.all([
                leadsApiFetch(`/api/leads/stats?${params.toString()}`),
                leadsApiFetch(`/api/funnel/patients?from=${appliedFrom}&to=${appliedTo}`),
            ]);
            if (!statsRes.ok) throw new Error(`Error ${statsRes.status}`);
            const data: LeadsStats = await statsRes.json();
            setStats(data);
            if (funnelRes.ok) {
                const funnelData: PatientRow[] = await funnelRes.json();
                setFunnelPatients(funnelData);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load stats");
        } finally {
            setLoading(false);
        }
    }, [appliedFrom, appliedTo]);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    const rangeLabel =
        appliedFrom === appliedTo
            ? format(new Date(appliedFrom), "MMM d, yyyy")
            : `${format(new Date(appliedFrom), "MMM d")} – ${format(new Date(appliedTo), "MMM d, yyyy")}`;

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Sticky header + date filter */}
            <div className="shrink-0 flex flex-col gap-4 pb-4 sticky top-0 z-10 bg-background">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-0">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight">Stats</h1>
                        <p className="text-sm text-muted-foreground">
                            {stats ? `${stats.total} leads · ${rangeLabel}` : rangeLabel}
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
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
            </div>

            {/* Scrollable content */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-6">
                {error && (
                    <div className="text-sm text-destructive bg-destructive/10 rounded-md p-4">{error}</div>
                )}

                {loading && !stats && (
                    <div className="text-sm text-muted-foreground text-center py-16">Loading stats…</div>
                )}

                {/* Funnel Drop-off */}
                {funnelPatients.length > 0 &&
                    (() => {
                        const total = funnelPatients.length;
                        const steps: { key: keyof PatientRow; label: string }[] = [
                            { key: "phone_verified", label: "Phone Verified" },
                            { key: "q_about_you", label: "About You" },
                            { key: "q_health_safety", label: "Health & Safety" },
                            { key: "q_treatment_history", label: "Tx History" },
                            { key: "q_health_profile", label: "Health Profile" },
                            { key: "q_conditions", label: "Conditions" },
                            { key: "eligible", label: "Eligible" },
                            { key: "booked", label: "Booked" },
                        ];
                        const counts = steps.map((s) => ({
                            ...s,
                            count: funnelPatients.filter((p) => p[s.key]).length,
                        }));
                        return (
                            <div>
                                <h2 className="text-lg font-semibold mb-3">Funnel Drop-off</h2>
                                <div className="border rounded-lg overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/50">
                                            <tr>
                                                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Step</th>
                                                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Passed</th>
                                                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">% of Registered</th>
                                                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dropped off</th>
                                                <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Drop-off %</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr className="border-t">
                                                <td className="px-4 py-2.5 font-medium">Registered</td>
                                                <td className="px-4 py-2.5 text-right">{total}</td>
                                                <td className="px-4 py-2.5 text-right">100%</td>
                                                <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                                                <td className="px-4 py-2.5 text-right text-muted-foreground">—</td>
                                            </tr>
                                            {counts.map((s, i) => {
                                                const prev = i === 0 ? total : counts[i - 1].count;
                                                const dropped = prev - s.count;
                                                return (
                                                    <tr key={s.key as string} className="border-t hover:bg-muted/30 transition-colors">
                                                        <td className="px-4 py-2.5">{s.label}</td>
                                                        <td className="px-4 py-2.5 text-right">{s.count}</td>
                                                        <td className="px-4 py-2.5 text-right">{pct(s.count / total)}</td>
                                                        <td className="px-4 py-2.5 text-right text-red-500">{dropped > 0 ? dropped : "—"}</td>
                                                        <td className="px-4 py-2.5 text-right text-red-500 font-medium">
                                                            {prev > 0 && dropped > 0 ? pct(dropped / prev) : "—"}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })()}

                {stats && (
                    <div>
                        <h2 className="text-lg font-semibold mb-3">By UTM Source</h2>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leads</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Booked</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consulted</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Purchased</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Book Rate</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Show Rate</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.bySource
                                        .filter((r) => r.total > 0)
                                        .sort((a, b) => b.total - a.total)
                                        .map((row) => (
                                            <tr key={row.source} className="border-t hover:bg-muted/30 transition-colors">
                                                <td className="px-4 py-2.5">
                                                    <SourceBadge source={row.source as LeadSource} />
                                                </td>
                                                <td className="px-4 py-2.5 text-right">{row.total.toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right text-violet-400">{row.booked}</td>
                                                <td className="px-4 py-2.5 text-right text-blue-400">{row.consulted}</td>
                                                <td className="px-4 py-2.5 text-right text-green-400 font-medium">{row.purchased}</td>
                                                <td className="px-4 py-2.5 text-right font-medium">
                                                    {row.total > 0 ? pct(row.booked / row.total) : "—"}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-medium">
                                                    {row.booked > 0 ? pct(row.consulted / row.booked) : "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    {stats.bySource.every((r) => r.total === 0) && (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                                                No leads in this date range.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot className="border-t bg-muted/30 font-semibold">
                                    <tr>
                                        <td className="px-4 py-2.5 text-muted-foreground">Total</td>
                                        <td className="px-4 py-2.5 text-right">{stats.total.toLocaleString()}</td>
                                        <td className="px-4 py-2.5 text-right text-violet-400">{stats.booked}</td>
                                        <td className="px-4 py-2.5 text-right text-blue-400">{stats.consulted}</td>
                                        <td className="px-4 py-2.5 text-right text-green-400">{stats.purchased}</td>
                                        <td className="px-4 py-2.5 text-right">{pct(stats.conversionRates.bookRate)}</td>
                                        <td className="px-4 py-2.5 text-right">{pct(stats.conversionRates.showRate)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

                {/* By State */}
                {stats && stats.byState.length > 0 && (
                    <div>
                        <h2 className="text-lg font-semibold mb-3">By State</h2>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">State</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leads</th>
                                        <th className="text-right px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">% of Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stats.byState.map(({ state, count }) => (
                                        <tr key={state} className="border-t hover:bg-muted/30 transition-colors">
                                            <td className="px-4 py-2.5">{state}</td>
                                            <td className="px-4 py-2.5 text-right">{count}</td>
                                            <td className="px-4 py-2.5 text-right text-muted-foreground">{pct(count / stats.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

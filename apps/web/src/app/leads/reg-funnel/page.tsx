"use client";

import { useState } from "react";
import { format } from "date-fns";
import { RefreshCw, ExternalLink, Download, Sparkles } from "lucide-react";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "@/components/leads/LeadBadges";
import { DateRangeFilter } from "@/components/leads/DateRangeFilter";
import { useRegFunnelData } from "@/hooks/useRegFunnelData";
import type { PatientRow } from "@/types/funnel";

interface Annotation {
    link: string;
    note: string;
}
type Annotations = Record<string, Annotation>;

function loadAnnotations(): Annotations {
    try {
        return JSON.parse(localStorage.getItem("funnel-annotations") ?? "{}");
    } catch {
        return {};
    }
}
function saveAnnotations(a: Annotations) {
    localStorage.setItem("funnel-annotations", JSON.stringify(a));
}

// Top-level funnel steps shown in the summary bar + filter tabs
const STEPS: { key: keyof PatientRow; label: string; short: string }[] = [
    { key: "registered", label: "Registered", short: "Reg" },
    { key: "phone_verified", label: "Phone ✓", short: "Phone" },
    { key: "questionnaire_done", label: "Questionnaire", short: "Quest." },
    { key: "eligible", label: "Eligible", short: "Eligible" },
    { key: "booked", label: "Booked", short: "Booked" },
];

// Sub-step columns shown inside the questionnaire section
const Q_STEPS: { key: keyof PatientRow; short: string }[] = [
    { key: "q_about_you", short: "About" },
    { key: "q_health_safety", short: "Health" },
    { key: "q_treatment_history", short: "Tx Hist." },
    { key: "q_health_profile", short: "Profile" },
    { key: "q_conditions", short: "Conditions" },
];

const FURTHEST_STEP_META: Record<string, { label: string; color: string }> = {
    registered: { label: "Registered", color: "bg-slate-500/15 text-slate-300" },
    phone_verified: { label: "Phone Verified", color: "bg-yellow-500/15 text-yellow-400" },
    questionnaire_done: { label: "Questionnaire", color: "bg-orange-500/15 text-orange-400" },
    eligible: { label: "Eligible", color: "bg-blue-500/15 text-blue-400" },
    booked: { label: "Booked", color: "bg-violet-500/15 text-violet-400" },
    pending_review: { label: "Pending Review", color: "bg-green-500/15 text-green-400" },
    rejected: { label: "Rejected", color: "bg-red-500/15 text-red-400" },
};

export default function FunnelPage() {
    const {
        patients,
        loading,
        error,
        dateMode,
        setDateMode,
        dateFrom,
        setDateFrom,
        dateTo,
        setDateTo,
        fetchPatients,
        applyDates,
        rangeLabel,
    } = useRegFunnelData();

    const [annotations, setAnnotations] = useState<Annotations>(loadAnnotations);
    const [stepFilter, setStepFilter] = useState<string>("all");
    const [noteOpen, setNoteOpen] = useState<string | null>(null);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [summaryText, setSummaryText] = useState<string | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    const updateAnnotation = (email: string, field: keyof Annotation, value: string) => {
        setAnnotations((prev) => {
            const next = { ...prev, [email]: { ...prev[email], [field]: value } };
            saveAnnotations(next);
            return next;
        });
    };

    // Cumulative counts — how many patients have reached at least this step (boolean = true)
    const counts = [...STEPS, { key: "rejected" as keyof PatientRow, label: "Rejected" }].reduce(
        (acc, s) => {
            acc[s.key as string] = patients.filter((p) => p[s.key as keyof PatientRow]).length;
            return acc;
        },
        {} as Record<string, number>
    );

    // Filter: show patients who have that step = true (cumulative — reached at least here)
    const filtered =
        stepFilter === "all" ? patients : patients.filter((p) => p[stepFilter as keyof PatientRow]);

    function exportCsv() {
        const BOOL = (v: boolean) => (v ? "Yes" : "No");
        const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const headers = [
            "Name",
            "Email",
            "Registered At",
            "Source",
            "Furthest Step",
            "Phone Verified",
            "Questionnaire",
            "About You",
            "Health Safety",
            "Tx History",
            "Health Profile",
            "Conditions",
            "Eligible",
            "Pending Review",
            "State",
            "Booked",
            "Link",
            "Note",
        ];
        const rows = filtered.map((p) => [
            esc(p.fullName || ""),
            esc(p.email || ""),
            esc(p.createdAt ? format(new Date(p.createdAt), "yyyy-MM-dd HH:mm") : ""),
            esc(p.source || ""),
            esc(p.furthestStep || ""),
            BOOL(p.phone_verified),
            BOOL(p.questionnaire_done),
            BOOL(p.q_about_you),
            BOOL(p.q_health_safety),
            BOOL(p.q_treatment_history),
            BOOL(p.q_health_profile),
            BOOL(p.q_conditions),
            BOOL(p.eligible),
            BOOL(p.pending_review),
            esc(p.state ?? ""),
            BOOL(p.booked),
            esc(annotations[p.email]?.link ?? ""),
            esc(annotations[p.email]?.note ?? ""),
        ]);
        const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `funnel-${rangeLabel.replace(/[^a-zA-Z0-9-]/g, "_")}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const notesWithContent = filtered.filter((p) => annotations[p.email]?.note?.trim());

    async function generateSummary() {
        setSummaryLoading(true);
        setSummaryError(null);
        try {
            const res = await leadsApiFetch("/api/funnel/summarize-notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dateLabel: rangeLabel,
                    notes: notesWithContent.map((p) => ({
                        name: p.fullName || p.email,
                        email: p.email,
                        note: annotations[p.email].note,
                        furthestStep: p.furthestStep || undefined,
                    })),
                }),
            });
            if (!res.ok) throw new Error(`Error ${res.status}`);
            const data = await res.json();
            setSummaryText(data.summary);
        } catch (e) {
            setSummaryError(e instanceof Error ? e.message : "Failed to generate summary");
        } finally {
            setSummaryLoading(false);
        }
    }

    return (
        <div className="flex flex-col gap-6 h-full min-h-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Reg. Funnel Tracker</h1>
                    <p className="text-sm text-muted-foreground">
                        {patients.length} patients · {rangeLabel}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
                        <Download className="h-4 w-4 mr-2" />
                        Export CSV
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setSummaryOpen(true);
                            setSummaryText(null);
                            setSummaryError(null);
                        }}
                        disabled={notesWithContent.length === 0}
                    >
                        <Sparkles className="h-4 w-4 mr-2" />
                        Note Summary
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchPatients} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Date Filter */}
            <DateRangeFilter
                dateMode={dateMode}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onModeChange={setDateMode}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onApply={applyDates}
            />

            {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md p-4">{error}</div>}
            {loading && !patients.length && (
                <div className="text-sm text-muted-foreground text-center py-16">Loading…</div>
            )}

            {patients.length > 0 && (
                <>
                    {/* Summary bar — clickable to filter */}
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setStepFilter("all")}
                            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                                stepFilter === "all"
                                    ? "bg-secondary text-foreground border-foreground/30"
                                    : "border-input hover:bg-accent"
                            }`}
                        >
                            All <span className="font-semibold ml-1">{patients.length}</span>
                        </button>
                        {STEPS.map((s) => (
                            <button
                                key={s.key as string}
                                onClick={() => setStepFilter(stepFilter === s.key ? "all" : (s.key as string))}
                                className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                                    stepFilter === s.key
                                        ? "bg-secondary text-foreground border-foreground/30"
                                        : "border-input hover:bg-accent"
                                }`}
                            >
                                {s.label} <span className="font-semibold ml-1">{counts[s.key as string]}</span>
                            </button>
                        ))}
                        <button
                            onClick={() => setStepFilter(stepFilter === "rejected" ? "all" : "rejected")}
                            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                                stepFilter === "rejected"
                                    ? "bg-destructive text-destructive-foreground border-destructive"
                                    : "border-input text-red-400 hover:bg-red-500/10"
                            }`}
                        >
                            Rejected <span className="font-semibold ml-1">{counts["rejected"]}</span>
                        </button>
                    </div>

                    {/* Table */}
                    <div className="border rounded-lg overflow-auto flex-1 min-h-0">
                        <table className="w-full text-sm table-fixed">
                            <thead className="bg-muted">
                                <tr>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground sticky top-0 bg-muted z-10 w-44">
                                        Name
                                    </th>
                                    {/* Top-level funnel steps: Phone, Quest. */}
                                    {STEPS.slice(1, 3).map((s) => (
                                        <th
                                            key={s.key as string}
                                            className="text-center px-2 py-2 font-medium text-muted-foreground w-16 sticky top-0 bg-muted z-10"
                                        >
                                            {s.short}
                                        </th>
                                    ))}
                                    {/* Questionnaire sub-steps */}
                                    {Q_STEPS.map((s) => (
                                        <th
                                            key={s.key as string}
                                            className="text-center px-2 py-2 font-medium text-muted-foreground/60 w-16 text-xs italic sticky top-0 bg-muted z-10"
                                        >
                                            {s.short}
                                        </th>
                                    ))}
                                    {/* Remaining top-level steps: Eligible, Booked */}
                                    {STEPS.slice(3, 5).map((s) => (
                                        <th
                                            key={s.key as string}
                                            className="text-center px-2 py-2 font-medium text-muted-foreground w-16 sticky top-0 bg-muted z-10"
                                        >
                                            {s.short}
                                        </th>
                                    ))}
                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground w-24 sticky top-0 bg-muted z-10">
                                        State
                                    </th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground sticky top-0 bg-muted z-10 w-24">
                                        Furthest
                                    </th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground sticky top-0 bg-muted z-10 w-28">
                                        Link
                                    </th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground sticky top-0 bg-muted z-10 w-32">
                                        Note
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={16} className="text-center text-muted-foreground py-10">
                                            No patients at this step.{" "}
                                            <button className="underline text-primary" onClick={() => setStepFilter("all")}>
                                                Clear filter
                                            </button>
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map((p, i) => {
                                        const meta = FURTHEST_STEP_META[p.furthestStep] ?? FURTHEST_STEP_META["registered"];
                                        return (
                                            <tr key={i} className="border-t hover:bg-muted/30 transition-colors">
                                                <td className="px-3 py-2.5 overflow-hidden">
                                                    <div className="font-medium truncate" title={p.fullName}>
                                                        {p.fullName || "—"}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground truncate" title={p.email}>
                                                        {p.email}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <SourceBadge source={p.source} />
                                                        {p.createdAt && (
                                                            <span className="text-xs text-muted-foreground/60">
                                                                {format(new Date(p.createdAt), "MMM d, h:mm a")}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                {STEPS.slice(1, 3).map((s) => (
                                                    <td key={s.key as string} className="px-2 py-2.5 text-center">
                                                        {p[s.key] ? (
                                                            <span className="text-green-400">✓</span>
                                                        ) : (
                                                            <span className="text-muted-foreground/40">—</span>
                                                        )}
                                                    </td>
                                                ))}
                                                {Q_STEPS.map((s) => (
                                                    <td key={s.key as string} className="px-2 py-2.5 text-center">
                                                        {p[s.key] ? (
                                                            <span className="text-green-400/80 text-xs">✓</span>
                                                        ) : (
                                                            <span className="text-muted-foreground/30 text-xs">—</span>
                                                        )}
                                                    </td>
                                                ))}
                                                {STEPS.slice(3, 5).map((s) => (
                                                    <td key={s.key as string} className="px-2 py-2.5 text-center">
                                                        {p[s.key] ? (
                                                            <span className="text-green-400">✓</span>
                                                        ) : (
                                                            <span className="text-muted-foreground/40">—</span>
                                                        )}
                                                    </td>
                                                ))}
                                                <td className="px-2 py-2.5 text-center text-xs text-muted-foreground">
                                                    {p.state ?? "—"}
                                                </td>
                                                <td className="px-3 py-2.5 overflow-hidden">
                                                    <span
                                                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}
                                                    >
                                                        {meta.label}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-2">
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="url"
                                                            value={annotations[p.email]?.link ?? ""}
                                                            onChange={(e) => updateAnnotation(p.email, "link", e.target.value)}
                                                            placeholder="https://"
                                                            className="w-full text-xs rounded border border-input bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                                                        />
                                                        {annotations[p.email]?.link && (
                                                            <a
                                                                href={annotations[p.email].link}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="shrink-0 text-muted-foreground hover:text-primary"
                                                            >
                                                                <ExternalLink className="h-3.5 w-3.5" />
                                                            </a>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-2">
                                                    <button
                                                        onClick={() => setNoteOpen(p.email)}
                                                        className="w-full text-left text-xs truncate px-2 py-1 rounded border border-input bg-background hover:bg-accent transition-colors min-h-[26px]"
                                                        title={annotations[p.email]?.note || undefined}
                                                    >
                                                        {annotations[p.email]?.note ? (
                                                            <span className="truncate">{annotations[p.email].note}</span>
                                                        ) : (
                                                            <span className="text-muted-foreground/50">Add note…</span>
                                                        )}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {!loading && patients.length === 0 && !error && (
                <div className="text-center text-muted-foreground py-16">No patients found for this date range.</div>
            )}

            {summaryOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/65"
                    onClick={() => setSummaryOpen(false)}
                >
                    <div
                        className="bg-card border rounded-md p-5 w-[620px] max-w-[92vw] flex flex-col gap-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-semibold flex items-center gap-1.5">
                                    <Sparkles className="h-4 w-4 text-violet-400" />
                                    Note Summary
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                    {notesWithContent.length} note{notesWithContent.length !== 1 ? "s" : ""} · {rangeLabel}
                                </div>
                            </div>
                            <button
                                onClick={() => setSummaryOpen(false)}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <span className="text-lg leading-none">&times;</span>
                            </button>
                        </div>

                        {!summaryText && !summaryLoading && (
                            <p className="text-sm text-muted-foreground">
                                Click <strong>Generate Summary</strong> to have Gemini analyse the {notesWithContent.length}{" "}
                                note{notesWithContent.length !== 1 ? "s" : ""} from this date range and provide a summary with
                                actionable suggestions.
                            </p>
                        )}

                        {summaryLoading && (
                            <div className="text-sm text-muted-foreground text-center py-6">Generating summary…</div>
                        )}

                        {summaryError && (
                            <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">{summaryError}</div>
                        )}

                        {summaryText && (
                            <div className="text-sm whitespace-pre-wrap bg-muted/40 rounded-lg p-4 max-h-[50vh] overflow-y-auto leading-relaxed">
                                {summaryText}
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setSummaryOpen(false)}>
                                Close
                            </Button>
                            <Button size="sm" onClick={generateSummary} disabled={summaryLoading}>
                                <Sparkles className="h-4 w-4 mr-2" />
                                {summaryText ? "Regenerate" : "Generate Summary"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {noteOpen !== null && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/65"
                    onClick={() => setNoteOpen(null)}
                >
                    <div
                        className="bg-card border rounded-md p-5 w-[560px] max-w-[90vw] flex flex-col gap-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="text-sm font-semibold">Note</div>
                        <div className="text-xs text-muted-foreground truncate">{noteOpen}</div>
                        <textarea
                            autoFocus
                            rows={10}
                            value={annotations[noteOpen]?.note ?? ""}
                            onChange={(e) => updateAnnotation(noteOpen, "note", e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") setNoteOpen(null);
                            }}
                            placeholder="Add a note…"
                            className="w-full text-sm rounded border border-input bg-background px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        <div className="flex justify-end">
                            <button
                                onClick={() => setNoteOpen(null)}
                                className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

"use client";

import { useState } from "react";
import {
    format,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    startOfWeek,
    endOfWeek,
    isSameMonth,
    isToday,
    parseISO,
    addMonths,
    subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "@/components/leads/LeadBadges";
import { DateRangeFilter } from "@/components/leads/DateRangeFilter";
import { useBookingsData } from "@/hooks/useBookingsData";
import type { LeadSource } from "@/types/lead";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BookingsPage() {
    const {
        month,
        setMonth,
        data,
        loading,
        error,
        fetchBookings,
        rangeDateMode,
        setRangeDateMode,
        rangeFrom,
        setRangeFrom,
        rangeTo,
        setRangeTo,
        appliedRangeFrom,
        appliedRangeTo,
        rangeData,
        rangeLoading,
        applyRangeDates,
    } = useBookingsData();

    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [compareOpen, setCompareOpen] = useState(false);

    // Calendar grid: full weeks that contain the month
    const gridStart = startOfWeek(startOfMonth(month));
    const gridEnd = endOfWeek(endOfMonth(month));
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

    const isTestxEntry = (e: { email: string | null; name: string }) =>
        e.email?.toLowerCase().includes("testx") || e.name?.toLowerCase().includes("testx");

    const selectedEntries = selectedDate
        ? (data?.entries ?? []).filter((e) => e.consultDate === selectedDate && !isTestxEntry(e))
        : [];

    const totalForMonth = (data?.entries ?? []).filter((e) => !isTestxEntry(e)).length;

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Sticky top: header + month nav */}
            <div className="shrink-0 flex flex-col gap-4 pb-4 sticky top-0 z-10 bg-background">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-0">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight">Bookings Calendar</h1>
                        <p className="text-sm text-muted-foreground">
                            {loading
                                ? "Loading…"
                                : `${totalForMonth} booking${totalForMonth !== 1 ? "s" : ""} in ${format(month, "MMMM yyyy")}`}
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1 max-w-lg">
                            Shows leads &amp; contacts whose <strong>Consult Date</strong> falls in this month. Past dates
                            reflect whoever still has that date set — rescheduled patients will appear on their new date, not
                            the original one.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchBookings} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                </div>

                {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md p-4">{error}</div>}

                {/* Range summary */}
                <div className="flex flex-col gap-3">
                    <DateRangeFilter
                        dateMode={rangeDateMode}
                        dateFrom={rangeFrom}
                        dateTo={rangeTo}
                        label="Consult date"
                        onModeChange={setRangeDateMode}
                        onDateFromChange={setRangeFrom}
                        onDateToChange={setRangeTo}
                        onApply={applyRangeDates}
                    />
                    {rangeData !== null && (
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => setCompareOpen(true)}
                                className="bg-card border rounded-lg px-4 py-3 text-left hover:bg-accent transition-colors"
                            >
                                <div className="text-xs text-muted-foreground font-medium mb-1">Bookings in Range</div>
                                <div className="flex items-baseline gap-3">
                                    <span className="text-xl font-bold text-violet-400">
                                        {rangeLoading
                                            ? "…"
                                            : rangeData.entries
                                                  .filter(
                                                      (e) =>
                                                          !e.email?.toLowerCase().includes("testx") &&
                                                          !e.name?.toLowerCase().includes("testx")
                                                  )
                                                  .length.toLocaleString()}
                                        <span className="text-xs font-normal text-muted-foreground ml-1">CRM</span>
                                    </span>
                                    <span className="text-muted-foreground text-sm">·</span>
                                    <span className="text-xl font-bold text-blue-400">
                                        {rangeLoading ? "…" : rangeData.dbEntries.length.toLocaleString()}
                                        <span className="text-xs font-normal text-muted-foreground ml-1">DB</span>
                                    </span>
                                </div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                    {appliedRangeFrom === appliedRangeTo
                                        ? appliedRangeFrom
                                        : `${appliedRangeFrom} – ${appliedRangeTo}`}
                                    {" · "}Click to compare
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                {/* Month navigation */}
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="sm" onClick={() => setMonth(subMonths(month, 1))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-base font-semibold min-w-[140px] text-center">{format(month, "MMMM yyyy")}</span>
                    <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, 1))}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground"
                        onClick={() => setMonth(new Date())}
                    >
                        Today
                    </Button>
                </div>
            </div>

            {/* Scrollable area: calendar + detail */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-6">
                {/* Calendar grid */}
                <div className="border rounded-lg overflow-hidden">
                    {/* Day-of-week headers */}
                    <div className="grid grid-cols-7 bg-muted border-b">
                        {DOW.map((d) => (
                            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
                                {d}
                            </div>
                        ))}
                    </div>

                    {/* Day cells */}
                    <div className="grid grid-cols-7">
                        {days.map((day) => {
                            const key = format(day, "yyyy-MM-dd");
                            const count = (data?.entries ?? []).filter(
                                (e) => e.consultDate === key && !isTestxEntry(e)
                            ).length;
                            const inMonth = isSameMonth(day, month);
                            const isSelected = selectedDate === key;
                            const today = isToday(day);

                            return (
                                <button
                                    key={key}
                                    onClick={() => setSelectedDate(isSelected ? null : key)}
                                    disabled={!inMonth}
                                    className={[
                                        "min-h-[72px] p-2 text-left border-b border-r flex flex-col gap-1 transition-colors",
                                        !inMonth ? "bg-muted/30 cursor-default" : "hover:bg-accent cursor-pointer",
                                        isSelected ? "bg-primary/10 ring-2 ring-inset ring-primary" : "",
                                    ].join(" ")}
                                >
                                    <span
                                        className={[
                                            "text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full",
                                            today ? "bg-primary text-primary-foreground" : "",
                                            !inMonth ? "text-muted-foreground/40" : "",
                                        ].join(" ")}
                                    >
                                        {format(day, "d")}
                                    </span>
                                    {inMonth && count > 0 && (
                                        <span className="inline-flex items-center justify-center rounded-full bg-violet-500/15 text-violet-400 text-xs font-semibold px-2 py-0.5 self-start">
                                            {count} booking{count !== 1 ? "s" : ""}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Day detail panel */}
                {selectedDate && (
                    <div className="border rounded-lg">
                        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted">
                            <span className="font-semibold text-sm">
                                {format(parseISO(selectedDate), "EEEE, MMMM d, yyyy")} — {selectedEntries.length} booking
                                {selectedEntries.length !== 1 ? "s" : ""}
                            </span>
                            <button onClick={() => setSelectedDate(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {selectedEntries.length === 0 ? (
                            <div className="text-sm text-muted-foreground text-center py-8">No bookings on this day.</div>
                        ) : (
                            <div className="overflow-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50">
                                        <tr>
                                            <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</th>
                                            <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
                                            <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Module</th>
                                            <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consult Time</th>
                                            <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedEntries.map((e) => (
                                            <tr key={e.id} className="border-t hover:bg-muted/30 transition-colors">
                                                <td className="px-4 py-2.5">
                                                    <div className="font-medium">{e.name || "—"}</div>
                                                    {e.email && <div className="text-xs text-muted-foreground">{e.email}</div>}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <SourceBadge source={e.source as LeadSource} />
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <span
                                                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                                            e.module === "Contacts"
                                                                ? "bg-blue-500/15 text-blue-400"
                                                                : "bg-slate-500/15 text-slate-300"
                                                        }`}
                                                    >
                                                        {e.module}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-sm text-muted-foreground">
                                                    {format(parseISO(e.consultAt), "h:mm a")}
                                                </td>
                                                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                                    {e.memberStatus ?? "—"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Compare modal */}
            {compareOpen && rangeData && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
                    onClick={() => setCompareOpen(false)}
                >
                    <div
                        className="bg-card rounded-md border w-full max-w-4xl max-h-[80vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                            <div>
                                <div className="font-semibold text-base">Bookings Comparison</div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                    {appliedRangeFrom === appliedRangeTo
                                        ? appliedRangeFrom
                                        : `${appliedRangeFrom} – ${appliedRangeTo}`}
                                    {" · "}DB includes all scheduled consultations
                                </div>
                            </div>
                            <button onClick={() => setCompareOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Legend */}
                        <div className="px-5 py-2.5 border-b bg-muted/30 shrink-0 flex flex-col gap-1 text-xs text-muted-foreground">
                            <div className="whitespace-nowrap">
                                <span className="font-semibold text-amber-400">CRM only</span> — scheduled in Zoho for this
                                date but no matching record in the app DB (e.g. booked directly in Zoho)
                            </div>
                            <div className="whitespace-nowrap">
                                <span className="font-semibold text-amber-400">DB only</span> — app DB has a record for this
                                date but CRM date is blank; usually the patient cancelled and the CRM workflow cleared it
                            </div>
                            <div className="whitespace-nowrap">
                                <span className="font-semibold text-sky-400">Rescheduled → [date]</span> — consultation was
                                moved to a new date; both the old and new DB records are present
                            </div>
                        </div>

                        {/* Two columns */}
                        <div className="flex flex-1 min-h-0 divide-x overflow-hidden">
                            {(() => {
                                const crmEmails = new Set(rangeData.entries.map((e) => e.email?.toLowerCase()).filter(Boolean));
                                const dbEmails = new Set(rangeData.dbEntries.map((e) => e.email?.toLowerCase()).filter(Boolean));
                                const isTestx = (e: { email: string | null; name: string }) =>
                                    e.email?.toLowerCase().includes("testx") || e.name?.toLowerCase().includes("testx");
                                const crmOnly = rangeData.entries.filter(
                                    (e) => !dbEmails.has(e.email?.toLowerCase() ?? "") && !isTestx(e)
                                ).length;
                                const rescheduledCount = rangeData.dbEntries.filter(
                                    (e) => !crmEmails.has(e.email?.toLowerCase() ?? "") && e.nextConsultationDate != null
                                ).length;
                                const blankOnCrmCount = rangeData.dbEntries.filter(
                                    (e) => !crmEmails.has(e.email?.toLowerCase() ?? "") && e.nextConsultationDate == null
                                ).length;
                                return (
                                    <>
                                        {/* CRM column */}
                                        <div className="flex-1 flex flex-col min-h-0">
                                            <div className="px-4 py-2.5 bg-muted/50 border-b shrink-0 flex items-center gap-2">
                                                <span className="text-xs font-semibold text-violet-400 uppercase tracking-wide">
                                                    CRM
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {rangeData.entries.filter((e) => !isTestx(e)).length} records
                                                </span>
                                                {crmOnly > 0 && (
                                                    <span className="ml-auto text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                                                        {crmOnly} not in DB
                                                    </span>
                                                )}
                                            </div>
                                            <div className="overflow-y-auto flex-1">
                                                {rangeData.entries.length === 0 ? (
                                                    <div className="text-sm text-muted-foreground text-center py-8">No CRM bookings</div>
                                                ) : (
                                                    <table className="w-full text-sm">
                                                        <thead className="sticky top-0 bg-background border-b">
                                                            <tr>
                                                                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                                    Name / Email
                                                                </th>
                                                                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                                    Consult Date
                                                                </th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {rangeData.entries.filter((e) => !isTestx(e)).map((e) => {
                                                                const missing = !dbEmails.has(e.email?.toLowerCase() ?? "");
                                                                return (
                                                                    <tr
                                                                        key={e.id}
                                                                        className={`border-t ${missing ? "bg-amber-500/10 hover:bg-amber-500/20" : "hover:bg-muted/30"}`}
                                                                    >
                                                                        <td className="px-4 py-2">
                                                                            <div className="font-medium flex items-center gap-1.5">
                                                                                {e.name || "—"}
                                                                                {missing && (
                                                                                    <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/15 rounded px-1 py-0.5 shrink-0">
                                                                                        CRM only
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-xs text-muted-foreground">{e.email ?? "—"}</div>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-xs text-muted-foreground">
                                                                            {format(parseISO(e.consultAt), "MMM d, h:mm a")}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        </div>

                                        {/* DB column */}
                                        <div className="flex-1 flex flex-col min-h-0">
                                            <div className="px-4 py-2.5 bg-muted/50 border-b shrink-0 flex items-center gap-2">
                                                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">DB</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {rangeData.dbEntries.length} records · incl. incomplete
                                                </span>
                                                {rescheduledCount > 0 && (
                                                    <span className="ml-auto text-xs font-medium text-sky-400 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5">
                                                        {rescheduledCount} Rescheduled
                                                    </span>
                                                )}
                                                {blankOnCrmCount > 0 && (
                                                    <span className="text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                                                        {blankOnCrmCount} Blank in CRM
                                                    </span>
                                                )}
                                            </div>
                                            <div className="overflow-y-auto flex-1">
                                                {rangeData.dbEntries.length === 0 ? (
                                                    <div className="text-sm text-muted-foreground text-center py-8">No DB bookings</div>
                                                ) : (
                                                    <table className="w-full text-sm">
                                                        <thead className="sticky top-0 bg-background border-b">
                                                            <tr>
                                                                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                                    Name / Email
                                                                </th>
                                                                <th className="text-left px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                                    Consult Date
                                                                </th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {rangeData.dbEntries.map((e, i) => {
                                                                const missingFromCrm = !crmEmails.has(e.email?.toLowerCase() ?? "");
                                                                const rescheduled = missingFromCrm && e.nextConsultationDate != null;
                                                                return (
                                                                    <tr
                                                                        key={i}
                                                                        className={`border-t ${
                                                                            rescheduled
                                                                                ? "bg-sky-500/10 hover:bg-sky-500/20"
                                                                                : missingFromCrm
                                                                                    ? "bg-amber-500/10 hover:bg-amber-500/20"
                                                                                    : "hover:bg-muted/30"
                                                                        }`}
                                                                    >
                                                                        <td className="px-4 py-2">
                                                                            <div className="font-medium flex items-center gap-1.5">
                                                                                {e.name || "—"}
                                                                                {rescheduled && (
                                                                                    <span className="text-[10px] font-semibold text-sky-400 bg-sky-500/15 rounded px-1 py-0.5 shrink-0">
                                                                                        Rescheduled → {format(parseISO(e.nextConsultationDate!), "MMM d")}
                                                                                    </span>
                                                                                )}
                                                                                {!rescheduled && missingFromCrm && (
                                                                                    <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/15 rounded px-1 py-0.5 shrink-0">
                                                                                        DB only
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-xs text-muted-foreground">{e.email}</div>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-xs text-muted-foreground">
                                                                            {format(parseISO(e.consultationDate), "MMM d, h:mm a")}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

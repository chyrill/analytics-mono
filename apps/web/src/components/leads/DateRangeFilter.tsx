"use client";

import { Button } from "@/components/ui/button";

interface DateRangeFilterProps {
    dateMode: "specific" | "range";
    dateFrom: string;
    dateTo: string;
    label?: string;
    onModeChange: (mode: "specific" | "range") => void;
    onDateFromChange: (value: string) => void;
    onDateToChange: (value: string) => void;
    onApply: (from: string, to: string) => void;
}

const inputClass =
    "h-8 rounded-md border border-input bg-secondary px-3 py-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:border-ring";

export function DateRangeFilter({
    dateMode,
    dateFrom,
    dateTo,
    label = "Date",
    onModeChange,
    onDateFromChange,
    onDateToChange,
    onApply,
}: DateRangeFilterProps) {
    const activeClass = "bg-secondary text-foreground";
    const inactiveClass = "bg-transparent text-muted-foreground hover:bg-accent";

    return (
        <div className="flex flex-wrap gap-3 items-center">
            {/* Specific date / Range toggle */}
            <div className="flex h-8 rounded-md border border-input overflow-hidden text-xs">
                <button
                    onClick={() => {
                        onModeChange("specific");
                        onDateToChange(dateFrom);
                        onApply(dateFrom, dateFrom);
                    }}
                    className={`px-3 flex items-center transition-colors ${dateMode === "specific" ? activeClass : inactiveClass}`}
                >
                    Specific date
                </button>
                <button
                    onClick={() => onModeChange("range")}
                    className={`px-3 flex items-center transition-colors ${dateMode === "range" ? activeClass : inactiveClass}`}
                >
                    Range
                </button>
            </div>

            {dateMode === "specific" ? (
                <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">{label}</label>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => {
                            onDateFromChange(e.target.value);
                            onDateToChange(e.target.value);
                            onApply(e.target.value, e.target.value);
                        }}
                        className={inputClass}
                    />
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => onDateFromChange(e.target.value)}
                        className={inputClass}
                    />
                    <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => onDateToChange(e.target.value)}
                        className={inputClass}
                    />
                    <Button size="sm" onClick={() => onApply(dateFrom, dateTo)}>
                        Apply
                    </Button>
                </div>
            )}
        </div>
    );
}

"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface Props {
    label: string;
    options: string[];
    selected: string[];
    onChange: (next: string[]) => void;
    formatOption?: (value: string) => string;
}

export function MultiSelectFilter({ label, options, selected, onChange, formatOption }: Props) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        function handler(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        if (open) document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const toggle = (value: string) => {
        onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
    };

    const displayLabel =
        selected.length === 0
            ? label
            : selected.length === 1
                ? `${label}: ${formatOption ? formatOption(selected[0]) : selected[0]}`
                : `${label}: ${selected.length} selected`;

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((o) => !o)}
                className={`inline-flex h-8 items-center gap-1.5 px-3 rounded-md border text-xs font-medium transition-colors ${selected.length > 0
                        ? "bg-secondary text-foreground border-foreground/30"
                        : "bg-secondary text-muted-foreground border-input hover:text-foreground"
                    }`}
            >
                {displayLabel}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] max-h-64 overflow-y-auto rounded-md border bg-popover">
                    {/* Clear option */}
                    {selected.length > 0 && (
                        <button
                            onClick={() => {
                                onChange([]);
                                setOpen(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors border-b"
                        >
                            ✕ Clear selection
                        </button>
                    )}
                    {options.map((opt) => (
                        <button
                            key={opt}
                            onClick={() => toggle(opt)}
                            className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent transition-colors"
                        >
                            <span>{formatOption ? formatOption(opt) : opt}</span>
                            {selected.includes(opt) && <Check className="h-3.5 w-3.5 text-foreground shrink-0" />}
                        </button>
                    ))}
                    {options.length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">No options</div>
                    )}
                </div>
            )}
        </div>
    );
}

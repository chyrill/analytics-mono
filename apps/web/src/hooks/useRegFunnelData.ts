"use client";

// Ported from leads-tracker/apps/web/src/hooks/useRegFunnelData.ts.
// Uses leadsApiFetch (Bearer token) instead of apiFetch (cookie).

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import type { PatientRow } from "@/types/funnel";

function todayStr() {
    return format(new Date(), "yyyy-MM-dd");
}

export interface UseRegFunnelDataReturn {
    patients: PatientRow[];
    loading: boolean;
    error: string | null;

    dateMode: "range" | "specific";
    setDateMode: (mode: "range" | "specific") => void;
    dateFrom: string;
    setDateFrom: (v: string) => void;
    dateTo: string;
    setDateTo: (v: string) => void;
    appliedFrom: string;
    appliedTo: string;

    fetchPatients: () => Promise<void>;
    applyDates: (from: string, to: string) => void;
    rangeLabel: string;
}

export function useRegFunnelData(): UseRegFunnelDataReturn {
    const [patients, setPatients] = useState<PatientRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [dateMode, setDateMode] = useState<"range" | "specific">("specific");
    const [dateFrom, setDateFrom] = useState(todayStr());
    const [dateTo, setDateTo] = useState(todayStr());
    const [appliedFrom, setAppliedFrom] = useState(todayStr());
    const [appliedTo, setAppliedTo] = useState(todayStr());

    const fetchPatients = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ from: appliedFrom, to: appliedTo });
            const res = await leadsApiFetch(`/api/funnel/patients?${params.toString()}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            setPatients(await res.json());
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load funnel data");
        } finally {
            setLoading(false);
        }
    }, [appliedFrom, appliedTo]);

    useEffect(() => {
        fetchPatients();
    }, [fetchPatients]);

    function applyDates(from: string, to: string) {
        setAppliedFrom(from);
        setAppliedTo(to);
    }

    const rangeLabel =
        appliedFrom === appliedTo
            ? format(new Date(appliedFrom), "MMM d, yyyy")
            : `${format(new Date(appliedFrom), "MMM d")} – ${format(new Date(appliedTo), "MMM d, yyyy")}`;

    return {
        patients,
        loading,
        error,
        dateMode,
        setDateMode,
        dateFrom,
        setDateFrom,
        dateTo,
        setDateTo,
        appliedFrom,
        appliedTo,
        fetchPatients,
        applyDates,
        rangeLabel,
    };
}

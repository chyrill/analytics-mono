"use client";

// Ported from leads-tracker/apps/web/src/hooks/useLeadsToPurchaseData.ts.
// Uses leadsApiFetch (Bearer token) instead of apiFetch (cookie).

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import type { LeadToPurchaseRow } from "@/types/leadsToPurchase";

function todayStr() {
    return format(new Date(), "yyyy-MM-dd");
}

export interface UseLeadsToPurchaseDataReturn {
    rows: LeadToPurchaseRow[];
    loading: boolean;
    error: string | null;

    // Filter axis (lead date vs consult date)
    filterAxis: "lead" | "consult";
    setFilterAxis: (axis: "lead" | "consult") => void;

    // Lead date range
    dateMode: "specific" | "range";
    setDateMode: (mode: "specific" | "range") => void;
    dateFrom: string;
    setDateFrom: (v: string) => void;
    dateTo: string;
    setDateTo: (v: string) => void;
    appliedFrom: string;
    appliedTo: string;

    // Consult date range
    consultDateMode: "specific" | "range";
    setConsultDateMode: (mode: "specific" | "range") => void;
    consultFrom: string;
    setConsultFrom: (v: string) => void;
    consultTo: string;
    setConsultTo: (v: string) => void;
    appliedConsultFrom: string;
    appliedConsultTo: string;

    // Actions
    fetchData: () => Promise<void>;
    applyLeadDates: (from: string, to: string) => void;
    applyConsultDates: (from: string, to: string) => void;

    // Derived
    rangeLabel: string;
}

export function useLeadsToPurchaseData(): UseLeadsToPurchaseDataReturn {
    const [rows, setRows] = useState<LeadToPurchaseRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [filterAxis, setFilterAxis] = useState<"lead" | "consult">("lead");
    const [dateMode, setDateMode] = useState<"specific" | "range">("specific");
    const [dateFrom, setDateFrom] = useState(todayStr());
    const [dateTo, setDateTo] = useState(todayStr());
    const [appliedFrom, setAppliedFrom] = useState(todayStr());
    const [appliedTo, setAppliedTo] = useState(todayStr());
    const [consultDateMode, setConsultDateMode] = useState<"specific" | "range">("specific");
    const [consultFrom, setConsultFrom] = useState(todayStr());
    const [consultTo, setConsultTo] = useState(todayStr());
    const [appliedConsultFrom, setAppliedConsultFrom] = useState(todayStr());
    const [appliedConsultTo, setAppliedConsultTo] = useState(todayStr());

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params =
                filterAxis === "lead"
                    ? new URLSearchParams({ from: appliedFrom, to: appliedTo })
                    : new URLSearchParams({ consult_from: appliedConsultFrom, consult_to: appliedConsultTo });
            const res = await leadsApiFetch(`/api/leads-to-purchase/patients?${params}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            setRows(await res.json());
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load data");
        } finally {
            setLoading(false);
        }
    }, [filterAxis, appliedFrom, appliedTo, appliedConsultFrom, appliedConsultTo]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    function applyLeadDates(from: string, to: string) {
        setAppliedFrom(from);
        setAppliedTo(to);
    }

    function applyConsultDates(from: string, to: string) {
        setAppliedConsultFrom(from);
        setAppliedConsultTo(to);
    }

    const rangeLabel =
        filterAxis === "lead"
            ? appliedFrom === appliedTo
                ? format(new Date(appliedFrom), "MMM d, yyyy")
                : `${format(new Date(appliedFrom), "MMM d")} – ${format(new Date(appliedTo), "MMM d, yyyy")}`
            : appliedConsultFrom === appliedConsultTo
                ? `Consulted ${format(new Date(appliedConsultFrom), "MMM d, yyyy")}`
                : `Consulted ${format(new Date(appliedConsultFrom), "MMM d")} – ${format(new Date(appliedConsultTo), "MMM d, yyyy")}`;

    return {
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
        appliedFrom,
        appliedTo,
        consultDateMode,
        setConsultDateMode,
        consultFrom,
        setConsultFrom,
        consultTo,
        setConsultTo,
        appliedConsultFrom,
        appliedConsultTo,
        fetchData,
        applyLeadDates,
        applyConsultDates,
        rangeLabel,
    };
}

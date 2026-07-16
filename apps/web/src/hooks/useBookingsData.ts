"use client";

// Ported from leads-tracker/apps/web/src/hooks/useBookingsData.ts.
// Uses leadsApiFetch (Bearer token) instead of apiFetch (cookie).

import { useState, useEffect, useCallback } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { leadsApiFetch } from "@/lib/leadsApiClient";

export interface BookingEntry {
    id: string;
    module: "Leads" | "Contacts";
    name: string;
    email: string | null;
    phone: string | null;
    consultAt: string;
    consultDate: string;
    memberStatus: string | null;
    source: string;
}

export interface DbBookingEntry {
    email: string;
    name: string | null;
    consultationDate: string;
    nextConsultationDate: string | null;
}

export interface BookingsResponse {
    entries: BookingEntry[];
    byDay: Record<string, number>;
    dbEntries: DbBookingEntry[];
}

function todayStr() {
    return format(new Date(), "yyyy-MM-dd");
}

export interface UseBookingsDataReturn {
    // Calendar month fetch
    month: Date;
    setMonth: (m: Date) => void;
    data: BookingsResponse | null;
    loading: boolean;
    error: string | null;
    fetchBookings: () => Promise<void>;

    // Range summary fetch
    rangeDateMode: "specific" | "range";
    setRangeDateMode: (mode: "specific" | "range") => void;
    rangeFrom: string;
    setRangeFrom: (v: string) => void;
    rangeTo: string;
    setRangeTo: (v: string) => void;
    appliedRangeFrom: string;
    appliedRangeTo: string;
    rangeData: BookingsResponse | null;
    rangeLoading: boolean;
    fetchRange: () => Promise<void>;
    applyRangeDates: (from: string, to: string) => void;
}

export function useBookingsData(): UseBookingsDataReturn {
    const [month, setMonth] = useState(new Date());
    const [data, setData] = useState<BookingsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [rangeDateMode, setRangeDateMode] = useState<"specific" | "range">("range");
    const [rangeFrom, setRangeFrom] = useState(todayStr());
    const [rangeTo, setRangeTo] = useState(todayStr());
    const [appliedRangeFrom, setAppliedRangeFrom] = useState(todayStr());
    const [appliedRangeTo, setAppliedRangeTo] = useState(todayStr());
    const [rangeData, setRangeData] = useState<BookingsResponse | null>(null);
    const [rangeLoading, setRangeLoading] = useState(false);

    const from = format(startOfMonth(month), "yyyy-MM-dd");
    const to = format(endOfMonth(month), "yyyy-MM-dd");

    const fetchBookings = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await leadsApiFetch(`/api/bookings?from=${from}&to=${to}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            setData(await res.json());
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load bookings");
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => {
        fetchBookings();
    }, [fetchBookings]);

    const fetchRange = useCallback(async () => {
        setRangeLoading(true);
        try {
            const res = await leadsApiFetch(`/api/bookings?from=${appliedRangeFrom}&to=${appliedRangeTo}`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            setRangeData(await res.json());
        } catch {
            setRangeData(null);
        } finally {
            setRangeLoading(false);
        }
    }, [appliedRangeFrom, appliedRangeTo]);

    useEffect(() => {
        fetchRange();
    }, [fetchRange]);

    function applyRangeDates(from: string, to: string) {
        setAppliedRangeFrom(from);
        setAppliedRangeTo(to);
    }

    return {
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
        fetchRange,
        applyRangeDates,
    };
}

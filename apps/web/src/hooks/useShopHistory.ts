"use client";

// Ported from leads-tracker/apps/web/src/hooks/useShopHistory.ts.
// Uses leadsApiFetch (Bearer token) instead of apiFetch (cookie).

import { useState, useCallback } from "react";
import { leadsApiFetch } from "@/lib/leadsApiClient";
import type { HistoryRow } from "@/types/shopFunnel";

// Per-email cache so expanding the same row twice doesn't re-fetch
const cache = new Map<string, HistoryRow[]>();

export function useShopHistory() {
    const [data, setData] = useState<Map<string, HistoryRow[]>>(new Map());
    const [loading, setLoading] = useState<Set<string>>(new Set());

    const fetch = useCallback(async (email: string) => {
        const key = email.toLowerCase();
        if (cache.has(key)) {
            setData((prev) => new Map(prev).set(key, cache.get(key)!));
            return;
        }
        setLoading((prev) => new Set(prev).add(key));
        try {
            const res = await leadsApiFetch(`/api/shop-funnel/users/${encodeURIComponent(key)}/history`);
            if (!res.ok) throw new Error(`Error ${res.status}`);
            const rows: HistoryRow[] = await res.json();
            cache.set(key, rows);
            setData((prev) => new Map(prev).set(key, rows));
        } catch {
            cache.set(key, []);
            setData((prev) => new Map(prev).set(key, []));
        } finally {
            setLoading((prev) => {
                const s = new Set(prev);
                s.delete(key);
                return s;
            });
        }
    }, []);

    return { data, loading, fetch };
}

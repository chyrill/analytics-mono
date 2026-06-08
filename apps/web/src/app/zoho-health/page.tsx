"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const PAGE_SIZE = 50;

interface ZohoHealthRow {
  zoho_id: string;
  email: string;
  patient_name: string | null;
  phone: string | null;
  member_status: string | null;
  supply_date: string | null;
  supply_expiration: string | null;
  order_date: string | null;
  total_orders_paid: number | null;
  consent_form_completed: boolean | null;
  patient_age: number | null;
  ad_usecase: string | null;
  days_until_expiry: number | null;
  status_colour: string;
  repeat_count: number | null;
  repeats_remaining: number | null;
  allotted_g: number | null;
  bought_g: number | null;
  avg_remaining_g: number | null;
  allowance_pct: number | null;
  saleor_total_g: number | null;
  allowance_group: string | null;
  total_visits: number | null;
  total_purchases: number | null;
  purchase_rate_pct: number | null;
  avg_visits_per_month: number | null;
  avg_days_between_visits: number | null;
  visit_tier: string | null;
  conversion_tier: string | null;
  last_visit: string | null;
  customer_pattern: string | null;
  total_deals: number;
  won_deals: number;
  lost_deals: number;
  open_deals: number;
  total_deal_value: string | null;
  latest_stage: string | null;
  last_deal_activity: string | null;
}

function fmt(v: number | string | null, decimals = 1): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(String(v));
  return isNaN(n) ? String(v) : n.toFixed(decimals);
}
function fmtDate(v: string | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}
function fmtDays(days: number | null): string {
  if (days == null) return "—";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "Today";
  return `${days}d`;
}

const PATTERN_LABEL: Record<string, string> = {
  loyal_power_buyer: "Loyal power buyer", high_adherent: "High adherent",
  active_partial_buyer: "Active partial buyer", window_shopper: "Window shopper",
  casual_buyer: "Casual buyer", at_risk: "At risk", needs_review: "Needs review",
};
const PATTERN_STYLE: Record<string, React.CSSProperties> = {
  loyal_power_buyer:    { background: "#2d1b4e", color: "#c084fc", border: "1px solid #4c1d95" },
  high_adherent:        { background: "#1a2e1a", color: "#86efac", border: "1px solid #166534" },
  active_partial_buyer: { background: "#1e2940", color: "#93c5fd", border: "1px solid #1d4ed8" },
  window_shopper:       { background: "#2a2000", color: "#fde68a", border: "1px solid #b45309" },
  casual_buyer:         { background: "#1a2020", color: "#67e8f9", border: "1px solid #0e7490" },
  at_risk:              { background: "#2a1515", color: "#fca5a5", border: "1px solid #991b1b" },
  needs_review:         { background: "#1e1e1e", color: "#888",    border: "1px solid #333" },
};
const GROUP_COLOR: Record<string, string> = { purple: "#a855f7", green: "#22c55e", orange: "#f97316", red: "#ef4444" };
const STATUS_STYLE: Record<string, React.CSSProperties> = {
  green:  { background: "#1a2e1a", color: "#86efac", border: "1px solid #166534" },
  blue:   { background: "#1a2040", color: "#93c5fd", border: "1px solid #1d4ed8" },
  orange: { background: "#2a1800", color: "#fdba74", border: "1px solid #9a3412" },
  red:    { background: "#2a1515", color: "#fca5a5", border: "1px solid #991b1b" },
  gray:   { background: "#1e1e1e", color: "#888",    border: "1px solid #333" },
};
const GROUP_CHIPS = [
  { key: "purple", color: "#a855f7", label: "Active ≤25% rem",  tip: "≤ 25% allowance remaining · ≥4 fills · ≥75% used · ≥60% conversion" },
  { key: "green",  color: "#22c55e", label: "Green 25–50% rem", tip: "25–50% allowance remaining · Good adherence" },
  { key: "orange", color: "#f97316", label: "Orange 50–75%",    tip: "50–75% allowance remaining · Moderate adherence" },
  { key: "red",    color: "#ef4444", label: "Red >75% rem",     tip: "> 75% allowance remaining · Low adherence" },
  { key: "__none", color: "#444",    label: "No plan",          tip: "No active treatment plan / supply data" },
];

export default function ZohoHealthPage() {
  const [allRows, setAllRows]     = useState<ZohoHealthRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [filterPattern, setFilterPattern] = useState("");
  const [filterGroup, setFilterGroup]     = useState("");
  const [filterStatus, setFilterStatus]   = useState("");
  const [sortCol, setSortCol]     = useState("allowance_pct");
  const [sortDir, setSortDir]     = useState<1 | -1>(-1);
  const [page, setPage]           = useState(1);

  function load() {
    setLoading(true); setError(null);
    fetch(`${API_BASE}/zoho-health`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ rows: ZohoHealthRow[]; error?: string }>; })
      .then((d) => { if (d.error) throw new Error(d.error); setAllRows(d.rows ?? []); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of allRows) { const k = r.allowance_group ?? "__none"; c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [allRows]);

  const statusOptions = useMemo(() => Array.from(new Set(allRows.map((r) => r.member_status ?? "Unknown"))).sort(), [allRows]);

  const summary = useMemo(() => ({
    total:      allRows.length,
    active:     allRows.filter((r) => r.status_colour === "green").length,
    booked:     allRows.filter((r) => r.status_colour === "blue").length,
    pending:    allRows.filter((r) => r.status_colour === "orange").length,
    discharged: allRows.filter((r) => r.status_colour === "red").length,
    expiring:   allRows.filter((r) => r.days_until_expiry != null && r.days_until_expiry >= 0 && r.days_until_expiry <= 30).length,
    wonDeals:   allRows.reduce((s, r) => s + r.won_deals, 0),
    openDeals:  allRows.reduce((s, r) => s + r.open_deals, 0),
    withPlan:   allRows.filter((r) => r.allowance_group != null).length,
  }), [allRows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allRows
      .filter((r) => {
        if (q && !((r.patient_name ?? "").toLowerCase().includes(q) || r.email.toLowerCase().includes(q))) return false;
        if (filterPattern && r.customer_pattern !== filterPattern) return false;
        if (filterGroup && (r.allowance_group ?? "__none") !== filterGroup) return false;
        if (filterStatus && (r.member_status ?? "Unknown") !== filterStatus) return false;
        return true;
      })
      .sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[sortCol];
        const bv = (b as unknown as Record<string, unknown>)[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1; if (bv == null) return -1;
        return av < bv ? sortDir : av > bv ? -sortDir : 0;
      });
  }, [allRows, search, filterPattern, filterGroup, filterStatus, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortCol(col); setSortDir(-1); }
    setPage(1);
  }

  const thS = useCallback((col: string): React.CSSProperties => ({
    textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.5px",
    color: sortCol === col ? "#aaa" : "#555",
    borderBottom: "1px solid #222", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
  }), [sortCol]);
  const arrow = (col: string) => sortCol === col ? (sortDir === -1 ? " ↓" : " ↑") : "";

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ padding: "24px 32px 16px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: "-0.3px", margin: 0 }}>Zoho CRM Health Index</h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Zoho CRM contacts as source of truth · enriched with supply, shop &amp; order data</p>
          <p style={{ fontSize: 11, color: "#444", marginTop: 3 }}>{summary.total.toLocaleString()} contacts · {summary.withPlan.toLocaleString()} with active supply plan</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/health"           style={navLink}>Health Index →</Link>
          <Link href="/shop-analytics"   style={navLink}>Shop Analytics →</Link>
          <Link href="/funnel-analytics" style={navLink}>Funnel →</Link>
          <Link href="/patients"         style={navLink}>Patients →</Link>
          <Link href="/"                 style={navLink}>Reconciliation →</Link>
          <button onClick={load} disabled={loading} style={ghostBtn}>⟳ Refresh</button>
        </div>
      </header>

      <div style={{ display: "flex", gap: 10, padding: "16px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        {[
          { label: "Total Contacts",    value: summary.total,      color: "#e8e8e8" },
          { label: "Active / Approved", value: summary.active,     color: "#86efac" },
          { label: "Consult Booked",    value: summary.booked,     color: "#93c5fd" },
          { label: "In Progress",       value: summary.pending,    color: "#fdba74" },
          { label: "Discharged",        value: summary.discharged, color: "#fca5a5" },
          { label: "Expiring ≤30d",     value: summary.expiring,   color: "#fde68a" },
          { label: "Won Deals",         value: summary.wonDeals,   color: "#a855f7" },
          { label: "Open Deals",        value: summary.openDeals,  color: "#67e8f9" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: "10px 18px", minWidth: 110 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, padding: "14px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        {GROUP_CHIPS.map((g) => (
          <GroupChip key={g.key} color={g.color} count={groupCounts[g.key] ?? 0}
            label={g.label} tip={g.tip} active={filterGroup === g.key}
            onClick={() => { setFilterGroup(filterGroup === g.key ? "" : g.key); setPage(1); }} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, padding: "14px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search name or email…" style={searchInput} />
        <select value={filterPattern} onChange={(e) => { setFilterPattern(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All patterns</option>
          {Object.entries(PATTERN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} style={{ ...selectStyle, maxWidth: 280 }}>
          <option value="">All CRM statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(filterGroup || filterPattern || filterStatus || search) && (
          <button onClick={() => { setFilterGroup(""); setFilterPattern(""); setFilterStatus(""); setSearch(""); setPage(1); }} style={ghostBtn}>✕ Clear</button>
        )}
        <span style={{ fontSize: 12, color: "#444", marginLeft: "auto" }}>{filtered.length.toLocaleString()} of {allRows.length.toLocaleString()}</span>
      </div>

      {loading && <StateMsg>Loading Zoho CRM data…</StateMsg>}
      {error   && <StateMsg isError>Error: {error}</StateMsg>}

      {!loading && !error && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th onClick={() => handleSort("patient_name")}       style={thS("patient_name")}>Patient{arrow("patient_name")}</th>
                  <th onClick={() => handleSort("member_status")}      style={thS("member_status")}>CRM Status{arrow("member_status")}</th>
                  <th onClick={() => handleSort("customer_pattern")}   style={thS("customer_pattern")}>Pattern{arrow("customer_pattern")}</th>
                  <th onClick={() => handleSort("allowance_group")}    style={thS("allowance_group")}>Group{arrow("allowance_group")}</th>
                  <th onClick={() => handleSort("allowance_pct")}      style={{ ...thS("allowance_pct"), textAlign: "right" }}>Used %{arrow("allowance_pct")}</th>
                  <th onClick={() => handleSort("allotted_g")}         style={{ ...thS("allotted_g"), textAlign: "right" }}>Allotted g{arrow("allotted_g")}</th>
                  <th onClick={() => handleSort("bought_g")}           style={{ ...thS("bought_g"), textAlign: "right" }}>Bought g{arrow("bought_g")}</th>
                  <th onClick={() => handleSort("avg_remaining_g")}    style={{ ...thS("avg_remaining_g"), textAlign: "right" }}>Avg Rem g{arrow("avg_remaining_g")}</th>
                  <th onClick={() => handleSort("days_until_expiry")}  style={{ ...thS("days_until_expiry"), textAlign: "right" }}>Exp{arrow("days_until_expiry")}</th>
                  <th onClick={() => handleSort("purchase_rate_pct")}  style={{ ...thS("purchase_rate_pct"), textAlign: "right" }}>Conv %{arrow("purchase_rate_pct")}</th>
                  <th onClick={() => handleSort("avg_visits_per_month")} style={{ ...thS("avg_visits_per_month"), textAlign: "right" }}>Visits/mo{arrow("avg_visits_per_month")}</th>
                  <th onClick={() => handleSort("total_orders_paid")}  style={{ ...thS("total_orders_paid"), textAlign: "right" }}>Orders{arrow("total_orders_paid")}</th>
                  <th onClick={() => handleSort("won_deals")}          style={{ ...thS("won_deals"), textAlign: "right" }}>Won{arrow("won_deals")}</th>
                  <th onClick={() => handleSort("open_deals")}         style={{ ...thS("open_deals"), textAlign: "right" }}>Open{arrow("open_deals")}</th>
                  <th onClick={() => handleSort("consent_form_completed")} style={{ ...thS("consent_form_completed"), textAlign: "center" }}>Consent{arrow("consent_form_completed")}</th>
                  <th onClick={() => handleSort("last_visit")}         style={thS("last_visit")}>Last Visit{arrow("last_visit")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const gc  = GROUP_COLOR[row.allowance_group ?? ""] ?? "#333";
                  const ps  = PATTERN_STYLE[row.customer_pattern ?? ""] ?? PATTERN_STYLE.needs_review;
                  const ss  = STATUS_STYLE[row.status_colour] ?? STATUS_STYLE.gray;
                  const ex  = row.days_until_expiry;
                  const exS: React.CSSProperties = ex == null ? { color: "#555" } : ex < 0 ? { color: "#ef4444" } : ex < 14 ? { color: "#f97316" } : ex < 30 ? { color: "#fde68a" } : { color: "#86efac" };
                  return (
                    <tr key={row.zoho_id} style={{ borderBottom: "1px solid #111" }}>
                      <td style={{ padding: "10px 12px", minWidth: 180 }}>
                        <div style={{ fontWeight: 500, color: "#e8e8e8" }}>{row.patient_name ?? "—"}</div>
                        <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{row.email}</div>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ ...ss, display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 12, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {row.member_status ?? "Unknown"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {row.customer_pattern
                          ? <span style={{ ...ps, display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 12, whiteSpace: "nowrap" }}>{PATTERN_LABEL[row.customer_pattern] ?? row.customer_pattern}</span>
                          : <span style={{ color: "#333" }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {row.allowance_group
                          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: gc }} />
                              <span style={{ color: gc }}>{row.allowance_group}</span>
                            </span>
                          : <span style={{ color: "#333" }}>—</span>}
                      </td>
                      <td style={numTd}>{fmt(row.allowance_pct)}%</td>
                      <td style={numTd}>{fmt(row.allotted_g)}</td>
                      <td style={numTd}>{fmt(row.bought_g)}</td>
                      <td style={numTd}>{fmt(row.avg_remaining_g)}</td>
                      <td style={{ ...numTd, ...exS }}>{fmtDays(ex)}</td>
                      <td style={numTd}>{fmt(row.purchase_rate_pct)}%</td>
                      <td style={numTd}>{fmt(row.avg_visits_per_month)}</td>
                      <td style={{ ...numTd, color: row.total_orders_paid ? "#e8e8e8" : "#333" }}>{row.total_orders_paid ?? "—"}</td>
                      <td style={{ ...numTd, color: row.won_deals > 0 ? "#86efac" : "#333" }}>{row.won_deals > 0 ? row.won_deals : "—"}</td>
                      <td style={{ ...numTd, color: row.open_deals > 0 ? "#93c5fd" : "#333" }}>{row.open_deals > 0 ? row.open_deals : "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        {row.consent_form_completed == null ? <span style={{ color: "#333" }}>—</span>
                          : row.consent_form_completed ? <span style={{ color: "#86efac" }}>✓</span>
                          : <span style={{ color: "#fca5a5" }}>✗</span>}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#555", fontSize: 12 }}>{fmtDate(row.last_visit)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, padding: "16px 32px", alignItems: "center" }}>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))}          disabled={safePage === 1}          style={ghostBtn}>← Prev</button>
              <span style={{ color: "#555", fontSize: 13 }}>Page {safePage} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={ghostBtn}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GroupChip({ color, count, label, tip, active, onClick }: { color: string; count: number; label: string; tip: string; active: boolean; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: "flex", alignItems: "center", gap: 8, background: active ? "#1e1e2e" : hov ? "#222" : "#1a1a1a",
        border: `1px solid ${active ? color : hov ? "#444" : "#222"}`, boxShadow: active ? `0 0 0 1px ${color}` : "none",
        borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", userSelect: "none", transition: "all 0.15s", position: "relative" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: "#fff" }}>{count.toLocaleString()}</span>
      <span style={{ color: active ? "#aaa" : "#666" }}>{label}</span>
      {hov && (
        <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, background: "#1e1e1e", border: "1px solid #333", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, lineHeight: 1.6, color: "#ccc", whiteSpace: "pre-line", minWidth: 200, maxWidth: 260,
          zIndex: 200, pointerEvents: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>{tip}</div>
      )}
    </div>
  );
}

function StateMsg({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return <div style={{ textAlign: "center", padding: "80px 0", color: isError ? "#ef4444" : "#555", fontSize: 14 }}>{children}</div>;
}

const navLink:     React.CSSProperties = { fontSize: 12, color: "#555", textDecoration: "none", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap" };
const ghostBtn:    React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", fontSize: 12, padding: "7px 14px", cursor: "pointer" };
const searchInput: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#e8e8e8", fontSize: 13, padding: "7px 12px", width: 240, outline: "none" };
const selectStyle: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#e8e8e8", fontSize: 13, padding: "7px 10px", outline: "none", cursor: "pointer" };
const numTd:       React.CSSProperties = { padding: "10px 12px", textAlign: "right", color: "#aaa", fontVariantNumeric: "tabular-nums" };

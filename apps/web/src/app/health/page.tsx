"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const PAGE_SIZE = 50;

// ── Types ──────────────────────────────────────────────────────────────────────
interface HealthRow {
  patient_name: string | null;
  email: string;
  customer_pattern: string | null;
  allowance_group: string | null;
  allowance_pct: number | null;
  allotted_g: number | null;
  bought_g: number | null;
  avg_remaining_g: number | null;
  repeat_count: number | null;
  repeats_remaining: number | null;
  total_visits: number | null;
  purchase_rate_pct: number | null;
  avg_visits_per_month: number | null;
  avg_days_between_visits: number | null;
  visit_tier: string | null;
  conversion_tier: string | null;
  last_visit: string | null;
  signed_up: string | null;
}

interface DetailData {
  visitsByMonth: { month: string; visits: number; purchases: number }[];
  gramsByMonth: { month: string; used_g: number; allotted_g: number | null }[];
  spendByMonth: { month: string; total_spent: number; order_count: number }[];
  summary: { total_spent: string; avg_monthly_spend: string; total_visits: number; avg_grams_per_interval: string };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(v: number | string | null, decimals = 1): string {
  if (v == null || v === "") return "—";
  const n = parseFloat(String(v));
  return isNaN(n) ? String(v) : n.toFixed(decimals);
}

const PATTERN_LABEL: Record<string, string> = {
  loyal_power_buyer: "Loyal power buyer",
  high_adherent: "High adherent",
  active_partial_buyer: "Active partial buyer",
  window_shopper: "Window shopper",
  casual_buyer: "Casual buyer",
  at_risk: "At risk",
  needs_review: "Needs review",
};

const PATTERN_STYLE: Record<string, React.CSSProperties> = {
  loyal_power_buyer: { background: "#2d1b4e", color: "#c084fc", border: "1px solid #4c1d95" },
  high_adherent: { background: "#1a2e1a", color: "#86efac", border: "1px solid #166534" },
  active_partial_buyer: { background: "#1e2940", color: "#93c5fd", border: "1px solid #1d4ed8" },
  window_shopper: { background: "#2a2000", color: "#fde68a", border: "1px solid #b45309" },
  casual_buyer: { background: "#1a2020", color: "#67e8f9", border: "1px solid #0e7490" },
  at_risk: { background: "#2a1515", color: "#fca5a5", border: "1px solid #991b1b" },
  needs_review: { background: "#1e1e1e", color: "#888", border: "1px solid #333" },
};

const GROUP_COLOR: Record<string, string> = {
  purple: "#a855f7",
  green: "#22c55e",
  orange: "#f97316",
  red: "#ef4444",
};

const GROUP_CHIPS = [
  { key: "purple", color: "#a855f7", label: "Active ≤25% rem", tip: "≤ 25% allowance remaining · ≥4 fills · ≥75% used · ≥60% conversion\nHigh adherence, actively purchasing." },
  { key: "green", color: "#22c55e", label: "Green 25–50% rem", tip: "25–50% allowance remaining\nGood adherence — using most of allotment each interval." },
  { key: "orange", color: "#f97316", label: "Orange 50–75%", tip: "50–75% allowance remaining\nModerate adherence — leaving a significant portion unused." },
  { key: "red", color: "#ef4444", label: "Red >75% rem", tip: "> 75% allowance remaining\nLow adherence — rarely purchasing relative to treatment plan." },
  // { key: "__none", color: "#444", label: "No plan", tip: "No active treatment plan on file.\nSaleor-only customers or patients without a current prescription." },
];

// ── Chart drawing ──────────────────────────────────────────────────────────────
declare const Chart: {
  new(ctx: CanvasRenderingContext2D, config: Record<string, unknown>): { destroy(): void };
};

const CHART_OPTS = {
  plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1a1a1a", borderColor: "#333", borderWidth: 1, titleColor: "#aaa", bodyColor: "#fff", padding: 10 } },
  scales: {
    x: { grid: { color: "#1a1a1a" }, ticks: { color: "#555", font: { size: 11 } } },
    y: { grid: { color: "#1a1a1a" }, ticks: { color: "#555", font: { size: 11 } } },
  },
  animation: { duration: 300 },
  responsive: true,
  maintainAspectRatio: false,
};

// ── Main component ─────────────────────────────────────────────────────────────
export default function HealthIndexPage() {
  const [allRows, setAllRows] = useState<HealthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterPattern, setFilterPattern] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [hideNoplan, setHideNoplan] = useState(false);
  const [sortCol, setSortCol] = useState("allowance_pct");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<HealthRow | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [period, setPeriod] = useState<"all" | "4m" | "custom">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  function load(overridePeriod?: "all" | "4m" | "custom", overrideFrom?: string, overrideTo?: string) {
    const activePeriod = overridePeriod ?? period;
    const activeFrom = overrideFrom !== undefined ? overrideFrom : dateFrom;
    const activeTo = overrideTo !== undefined ? overrideTo : dateTo;
    let from = "", to = "";
    if (activePeriod === "4m") {
      const d = new Date();
      d.setMonth(d.getMonth() - 4);
      from = d.toISOString().slice(0, 10);
      to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    } else if (activePeriod === "custom") {
      from = activeFrom;
      to = activeTo;
    }
    const qs = from ? `?from=${from}${to ? `&to=${to}` : ""}` : "";
    setLoading(true); setError(null);
    fetch(`${API_BASE}/health-data${qs}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ rows: HealthRow[]; count: number }>; })
      .then((d) => setAllRows(d.rows ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setPanel(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Load detail when panel opens
  useEffect(() => {
    if (!panel) { setDetail(null); return; }
    setDetail(null); setDetailLoading(true);
    fetch(`${API_BASE}/health-detail?email=${encodeURIComponent(panel.email)}`)
      .then((r) => r.json() as Promise<DetailData>)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setDetailLoading(false));
  }, [panel?.email]);

  // Derived stat counts
  const groupCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of allRows) {
      const key = r.allowance_group ?? "__none";
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [allRows]);

  // Filtered + sorted
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allRows
      .filter((r) => {
        if (q && !((r.patient_name ?? "").toLowerCase().includes(q) || r.email.toLowerCase().includes(q))) return false;
        if (filterPattern && r.customer_pattern !== filterPattern) return false;
        if (filterGroup) {
          const rg = r.allowance_group ?? "__none";
          if (rg !== filterGroup) return false;
        }
        if (hideNoplan && r.allowance_group == null) return false;
        return true;
      })
      .sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[sortCol];
        const bv = (b as unknown as Record<string, unknown>)[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1; if (bv == null) return -1;
        return av < bv ? sortDir : av > bv ? -sortDir : 0;
      });
  }, [allRows, search, filterPattern, filterGroup, hideNoplan, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
      {/* ── Header ── */}
      <header style={{ padding: "24px 32px 16px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: "-0.3px", margin: 0 }}>Customer Health Index</h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Patients with an active treatment plan <em style={{ fontStyle: "normal", color: "#444" }}>and</em> at least one shop visit — allowance adherence × engagement</p>
          <p style={{ fontSize: 11, color: "#444", marginTop: 3 }}>Scope: shop-engaged cohort only · full patient base of 25,698 in <Link href="/" style={{ color: "#555", textDecoration: "underline" }}>Reconciliation</Link></p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => load()} disabled={loading} style={ghostBtn}>⟳ Refresh</button>
          {/* <a href={`${API_BASE}/health-data/export?group=noplan`} style={ghostBtn as React.AnchorHTMLAttributes<HTMLAnchorElement>["style"]}>↓ No Plan CSV</a> */}
          <a href={`${API_BASE}/health-data/export`} style={ghostBtn as React.AnchorHTMLAttributes<HTMLAnchorElement>["style"]}>↓ All CSV</a>
        </div>
      </header>

      {/* ── Group chips ── */}
      <div style={{ display: "flex", gap: 12, padding: "16px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        {GROUP_CHIPS.map((g) => (
          <GroupChip
            key={g.key} color={g.color} count={groupCounts[g.key] ?? 0}
            label={g.label} tip={g.tip}
            active={filterGroup === g.key}
            onClick={() => { setFilterGroup(filterGroup === g.key ? "" : g.key); setPage(1); }}
          />
        ))}
        <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, background: "#1a1a1a", border: "1px solid #222", borderRadius: 6, padding: "8px 14px", fontSize: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, color: "#fff", fontSize: 16 }}>{allRows.length.toLocaleString()}</span>
            <span style={{ color: "#666" }}>Patients</span>
          </div>
          {/* <div style={{ fontSize: 11, color: "#444" }}>of 25,698 total · <Link href="/" style={{ color: "#555", textDecoration: "underline" }}>25,615 doc-app</Link> · 2,533 saleor · 83 saleor-only</div> */}
        </div>
      </div>

      {/* ── Period selector ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#555" }}>Period</span>
        {(["all", "Last 4 months", "Custom"] as const).map((label, i) => {
          const key = (["all", "4m", "custom"] as const)[i];
          return (
            <button key={key}
              onClick={() => { setPeriod(key); if (key !== "custom") load(key); }}
              style={{ ...ghostBtn, border: period === key ? "1px solid #555" : "1px solid #2a2a2a", color: period === key ? "#fff" : "#555", background: period === key ? "#2a2a2a" : "#1a1a1a" }}>
              {label === "all" ? "All-time" : label}
            </button>
          );
        })}
        {period === "custom" && (
          <>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              style={{ ...searchInput, width: 140, padding: "6px 10px" }} />
            <span style={{ color: "#444", fontSize: 12 }}>→</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              style={{ ...searchInput, width: 140, padding: "6px 10px" }} />
            <button onClick={() => load("custom", dateFrom, dateTo)}
              disabled={!dateFrom && !dateTo}
              style={{ ...ghostBtn, border: "1px solid #555", color: "#fff" }}>
              Apply
            </button>
          </>
        )}
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        <input type="text" placeholder="Search name or email…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={searchInput} />
        <label style={{ fontSize: 12, color: "#555" }}>Pattern</label>
        <select value={filterPattern} onChange={(e) => { setFilterPattern(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All patterns</option>
          {Object.entries(PATTERN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ fontSize: 12, color: "#555" }}>Allowance</label>
        <select value={filterGroup} onChange={(e) => { setFilterGroup(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All groups</option>
          <option value="purple">Purple — active, ≤25% remaining</option>
          <option value="green">Green 25–50% remaining</option>
          <option value="orange">Orange 50–75% remaining</option>
          <option value="red">Red &gt;75% remaining</option>
          {/* <option value="__none">No plan — unclassified</option> */}
        </select>
        <button
          onClick={() => { setHideNoplan((v) => !v); setFilterGroup(""); setPage(1); }}
          style={{ ...ghostBtn, border: hideNoplan ? "1px solid #555" : "1px solid #2a2a2a", color: hideNoplan ? "#fff" : "#555", background: hideNoplan ? "#2a2a2a" : "#1a1a1a", display: "flex", alignItems: "center", gap: 6 }}
          title="Toggle visibility of the 571 patients with no active treatment plan">
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#444", display: "inline-block" }} />
          {hideNoplan ? "Showing plan patients only" : "Hide no-plan outliers"}
        </button>
        <span style={{ fontSize: 12, color: "#555", marginLeft: "auto" }}>
          {filtered.length !== allRows.length
            ? `${filtered.length.toLocaleString()} of ${allRows.length.toLocaleString()}`
            : `${allRows.length.toLocaleString()} patients`}
        </span>
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: "auto", padding: "16px 32px 40px" }}>
        {loading && <StateMsg>Loading…</StateMsg>}
        {error && <StateMsg isError>Error: {error}</StateMsg>}
        {!loading && !error && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 1100 }}>
            <thead>
              <tr>
                {([
                  ["patient_name", "Patient"],
                  ["email", "Email"],
                  ["customer_pattern", "Pattern"],
                  ["allowance_group", "Group"],
                  ["allowance_pct", "Allowance %"],
                  ["allotted_g", "Allotted (g)"],
                  ["bought_g", "Bought (g)"],
                  ["avg_remaining_g", "Avg rem (g)"],
                  ["repeat_count", "Repeats"],
                  ["repeats_remaining", "Rem rep"],
                  ["total_visits", "Visits"],
                  ["purchase_rate_pct", "Conv %"],
                  ["avg_visits_per_month", "Vis/mo"],
                  ["avg_days_between_visits", "Avg days"],
                  ["visit_tier", "Visit tier"],
                  ["conversion_tier", "Conv tier"],
                  ["last_visit", "Last visit"],
                  ["signed_up", "Signed up"],
                ] as [string, string][]).map(([col, label]) => (
                  <th key={col} style={thS(col)} onClick={() => handleSort(col)}>{label}{arrow(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.email} onClick={() => setPanel(r)} style={{ borderBottom: "1px solid #1a1a1a", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#161616")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                  <td style={{ padding: "10px 12px", fontWeight: 500, color: "#ddd", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={r.patient_name ?? ""}>{r.patient_name || <span style={{ color: "#444" }}>—</span>}</td>
                  <td style={{ padding: "10px 12px", color: "#666", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={r.email}>{r.email}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, ...(PATTERN_STYLE[r.customer_pattern ?? ""] ?? PATTERN_STYLE.needs_review) }}>
                      {PATTERN_LABEL[r.customer_pattern ?? ""] ?? r.customer_pattern ?? "—"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: GROUP_COLOR[r.allowance_group ?? ""] ?? "#444", display: "inline-block" }} />
                      {r.allowance_group ?? "—"}
                    </span>
                  </td>
                  <td style={{ ...numTd, color: r.allowance_pct != null ? "#fff" : "#444", fontWeight: r.allowance_pct != null ? 500 : 400 }}>{fmt(r.allowance_pct)}%</td>
                  <td style={numTd}>{fmt(r.allotted_g)}g</td>
                  <td style={numTd}>{fmt(r.bought_g)}g</td>
                  <td style={numTd}>{fmt(r.avg_remaining_g)}g</td>
                  <td style={numTd}>{r.repeat_count ?? "—"}</td>
                  <td style={numTd}>{r.repeats_remaining ?? "—"}</td>
                  <td style={numTd}>{r.total_visits ?? "—"}</td>
                  <td style={numTd}>{fmt(r.purchase_rate_pct)}%</td>
                  <td style={numTd}>{fmt(r.avg_visits_per_month)}</td>
                  <td style={numTd}>{fmt(r.avg_days_between_visits)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: r.visit_tier === "frequent" ? "#4ade80" : r.visit_tier === "occasional" ? "#facc15" : r.visit_tier === "rare" ? "#f87171" : "#666" }}>
                    {r.visit_tier ?? "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: r.conversion_tier === "high_converter" ? "#34d399" : r.conversion_tier === "moderate_converter" ? "#fbbf24" : r.conversion_tier === "low_converter" ? "#f87171" : "#666" }}>
                    {r.conversion_tier?.replace(/_/g, " ") ?? "—"}
                  </td>
                  <td style={{ ...numTd, color: "#555" }}>{r.last_visit ? String(r.last_visit).slice(0, 10) : "—"}</td>
                  <td style={{ ...numTd, color: "#555" }}>{r.signed_up ? String(r.signed_up).slice(0, 10) : "—"}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={19} style={{ padding: "60px 12px", textAlign: "center", color: "#555" }}>No records match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {!loading && !error && totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "0 32px 40px", fontSize: 13, color: "#555" }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} style={ghostBtn}>← Prev</button>
          <span>Page {safePage} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={ghostBtn}>Next →</button>
        </div>
      )}

      {/* ── Detail Panel ── */}
      {panel && (
        <>
          <div onClick={() => setPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100 }} />
          <div style={{ position: "fixed", top: 0, right: 0, width: 600, maxWidth: "100vw", height: "100vh", background: "#141414", borderLeft: "1px solid #222", zIndex: 101, overflowY: "auto" }}>
            {/* Header */}
            <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid #1e1e1e", position: "sticky", top: 0, background: "#141414", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>{panel.patient_name ?? panel.email}</h2>
                <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{panel.email}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, ...(PATTERN_STYLE[panel.customer_pattern ?? ""] ?? PATTERN_STYLE.needs_review) }}>
                    {PATTERN_LABEL[panel.customer_pattern ?? ""] ?? "—"}
                  </span>
                  {panel.allowance_group && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 4, padding: "3px 8px" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: GROUP_COLOR[panel.allowance_group] ?? "#444", display: "inline-block" }} />
                      {panel.allowance_group}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setPanel(null)} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", padding: "4px 8px", borderRadius: 4, lineHeight: 1 }}>✕</button>
            </div>
            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "#1a1a1a", borderBottom: "1px solid #1a1a1a" }}>
              {[
                ["Allowance", `${fmt(panel.allowance_pct)}%`],
                ["Allotted", `${fmt(panel.allotted_g)}g`],
                ["Repeats", String(panel.repeat_count ?? "—")],
                ["Visits", String(panel.total_visits ?? "—")],
                ["Conv %", `${fmt(panel.purchase_rate_pct)}%`],
                ["Vis/mo", String(fmt(panel.avg_visits_per_month))],
                ["Last visit", panel.last_visit ? String(panel.last_visit).slice(0, 10) : "—"],
              ].map(([label, val]) => (
                <div key={label} style={{ background: "#141414", padding: "14px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginTop: 4 }}>{val}</div>
                </div>
              ))}
            </div>
            {/* Charts (loaded when detail arrives) */}
            {detailLoading && <div style={{ padding: "40px", textAlign: "center", color: "#555", fontSize: 13 }}>Loading charts…</div>}
            {detail && <DetailCharts detail={detail} />}
          </div>
        </>
      )}
    </div>
  );
}

// ── Detail charts ──────────────────────────────────────────────────────────────
function DetailCharts({ detail }: { detail: DetailData }) {
  const visitsRef = useRef<HTMLCanvasElement>(null);
  const gramsRef = useRef<HTMLCanvasElement>(null);
  const spendRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof Chart === "undefined") return;
    const charts: { destroy(): void }[] = [];

    if (visitsRef.current) {
      const ctx = visitsRef.current.getContext("2d");
      if (ctx) charts.push(new Chart(ctx, {
        type: "bar",
        data: {
          labels: detail.visitsByMonth.map((r) => r.month),
          datasets: [
            { label: "Visits", data: detail.visitsByMonth.map((r) => r.visits), backgroundColor: "#2d2d4a", borderRadius: 3 },
            { label: "Purchases", data: detail.visitsByMonth.map((r) => r.purchases), backgroundColor: "#818cf8", borderRadius: 3 },
          ],
        },
        options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: true, labels: { color: "#555", font: { size: 11 } } } } },
      }));
    }

    if (gramsRef.current && detail.gramsByMonth.length > 0) {
      const ctx = gramsRef.current.getContext("2d");
      if (ctx) charts.push(new Chart(ctx, {
        type: "bar",
        data: {
          labels: detail.gramsByMonth.map((r) => r.month),
          datasets: [
            { label: "Used (g)", data: detail.gramsByMonth.map((r) => r.used_g), backgroundColor: "#2e2040", borderRadius: 3 },
          ],
        },
        options: { ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, ticks: { ...CHART_OPTS.scales.y.ticks, callback: (v: unknown) => `${v}g` } } } },
      }));
    }

    if (spendRef.current && detail.spendByMonth.length > 0) {
      const ctx = spendRef.current.getContext("2d");
      if (ctx) charts.push(new Chart(ctx, {
        type: "bar",
        data: {
          labels: detail.spendByMonth.map((r) => r.month),
          datasets: [{ label: "Spend ($)", data: detail.spendByMonth.map((r) => r.total_spent), backgroundColor: "#1a3d2e", borderRadius: 3 }],
        },
        options: { ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, ticks: { ...CHART_OPTS.scales.y.ticks, callback: (v: unknown) => `$${v}` } } } },
      }));
    }

    return () => charts.forEach((c) => c.destroy());
  }, [detail]);

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        {[
          ["Total spent", `$${parseFloat(detail.summary.total_spent).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`],
          ["Avg monthly", `$${parseFloat(detail.summary.avg_monthly_spend).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`],
          ["Total visits", String(detail.summary.total_visits)],
          ["Avg grams/fill", `${detail.summary.avg_grams_per_interval}g`],
        ].map(([label, val]) => (
          <div key={label} style={{ background: "#1a1a1a", borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 6 }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Chart: visits */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "#555", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Monthly Visits vs Purchases</div>
        <div style={{ position: "relative", height: 160 }}><canvas ref={visitsRef} /></div>
      </div>

      {/* Chart: grams */}
      {detail.gramsByMonth.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#555", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Saleor Grams by Month</div>
          <div style={{ position: "relative", height: 160 }}><canvas ref={gramsRef} /></div>
        </div>
      )}

      {/* Chart: spend */}
      {detail.spendByMonth.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#555", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Monthly Spend ($)</div>
          <div style={{ position: "relative", height: 160 }}><canvas ref={spendRef} /></div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function GroupChip({ color, count, label, tip, active, onClick }: {
  color: string; count: number; label: string; tip: string; active: boolean; onClick: () => void;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8, background: active ? "#1e1e2e" : hov ? "#222" : "#1a1a1a",
        border: `1px solid ${active ? color : hov ? "#444" : "#222"}`, boxShadow: active ? `0 0 0 1px ${color}` : "none",
        borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", userSelect: "none", transition: "all 0.15s", position: "relative"
      }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: "#fff" }}>{count.toLocaleString()}</span>
      <span style={{ color: active ? "#aaa" : "#666" }}>{label}</span>
      {hov && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0, background: "#1e1e1e", border: "1px solid #333", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, lineHeight: 1.6, color: "#ccc", whiteSpace: "pre-line", minWidth: 200, maxWidth: 260,
          zIndex: 200, pointerEvents: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
        }}>{tip}</div>
      )}
    </div>
  );
}

function StateMsg({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return <div style={{ textAlign: "center", padding: "80px 0", color: isError ? "#ef4444" : "#555", fontSize: 14 }}>{children}</div>;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const navLink: React.CSSProperties = { fontSize: 12, color: "#555", textDecoration: "none", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap" };
const ghostBtn: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", fontSize: 12, padding: "7px 14px", cursor: "pointer" };
const searchInput: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#e8e8e8", fontSize: 13, padding: "7px 12px", width: 240, outline: "none" };
const selectStyle: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#e8e8e8", fontSize: 13, padding: "7px 10px", outline: "none", cursor: "pointer" };
const numTd: React.CSSProperties = { padding: "10px 12px", textAlign: "right", color: "#aaa", fontVariantNumeric: "tabular-nums" };

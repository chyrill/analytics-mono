"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const PAGE_SIZE = 50;

// ── Types ──────────────────────────────────────────────────────────────────────
interface PatientRow {
  id: string;
  email: string;
  name: string | null;
  has_docapp: boolean;
  has_saleor: boolean;
  has_zoho: boolean;
  zoho_contact_id: string | null;
  saleor_customer_id: string | null;
  doc_app_patient_id: string | null;
  reconciliation_status: string;
  created_at: string;
}

type FunnelFilter = "all" | "registered_only" | "registered_purchased" | "saleor_only";

// ── Funnel stage helpers ───────────────────────────────────────────────────────
function funnelStage(r: PatientRow): FunnelFilter {
  if (r.has_docapp && r.has_saleor) return "registered_purchased";
  if (r.has_docapp && !r.has_saleor) return "registered_only";
  if (!r.has_docapp && r.has_saleor) return "saleor_only";
  return "all";
}

const STAGE_CONFIG: Record<string, { color: string; bg: string; border: string; label: string; desc: string }> = {
  registered_purchased: { color: "#4ade80", bg: "#0d1f0f", border: "#1a3d1f", label: "Registered + purchased",  desc: "Has doc-app account & at least one Saleor order" },
  registered_only:      { color: "#93c5fd", bg: "#0f1a2e", border: "#1d3a5e", label: "Registered, no purchase", desc: "In doc-app but never placed a shop order" },
  saleor_only:          { color: "#fbbf24", bg: "#1f1800", border: "#3d2e00", label: "Saleor only",              desc: "Purchased but no doc-app account" },
};

// ── Main ───────────────────────────────────────────────────────────────────────
export default function PatientRegistryPage() {
  const [allRows, setAllRows]   = useState<PatientRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState("");
  const [funnel, setFunnel]     = useState<FunnelFilter>("all");
  const [sortCol, setSortCol]   = useState("created_at");
  const [sortDir, setSortDir]   = useState<1 | -1>(-1);
  const [page, setPage]         = useState(1);

  function load() {
    setLoading(true); setError(null);
    fetch(`${API_BASE}/all-patients`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ rows: PatientRow[]; total: number }>; })
      .then((d) => setAllRows(d.rows ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  // Funnel counts
  const counts = useMemo(() => {
    const c = { all: allRows.length, registered_only: 0, registered_purchased: 0, saleor_only: 0 };
    for (const r of allRows) {
      const s = funnelStage(r);
      if (s !== "all") c[s]++;
    }
    return c;
  }, [allRows]);

  // Filtered + sorted
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allRows
      .filter((r) => {
        if (q && !r.email.toLowerCase().includes(q) && !(r.name ?? "").toLowerCase().includes(q)) return false;
        if (funnel !== "all" && funnelStage(r) !== funnel) return false;
        return true;
      })
      .sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[sortCol];
        const bv = (b as unknown as Record<string, unknown>)[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1; if (bv == null) return -1;
        return av < bv ? sortDir : av > bv ? -sortDir : 0;
      });
  }, [allRows, search, funnel, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function sort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortCol(col); setSortDir(-1); }
    setPage(1);
  }
  const arrow = (col: string) => sortCol === col ? (sortDir === -1 ? " ↓" : " ↑") : "";
  const thStyle = (col: string): React.CSSProperties => ({
    textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap",
    color: sortCol === col ? "#aaa" : "#555", borderBottom: "1px solid #222",
    cursor: "pointer", userSelect: "none",
  });

  const docappPct  = allRows.length ? Math.round(counts.registered_purchased / allRows.length * 100) : 0;
  const noPurchase = counts.registered_only;
  const noPurchasePct = allRows.length ? Math.round(noPurchase / allRows.length * 100) : 0;

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* ── Header ── */}
      <header style={{ padding: "24px 32px 16px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: "-0.3px", margin: 0 }}>Patient Registry</h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Every person who has ever touched Harvest — funnel registration through shop purchase</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={load} disabled={loading} style={ghostBtn}>⟳ Refresh</button>
        </div>
      </header>

      {/* ── Funnel stat bar ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1, background: "#1a1a1a", borderBottom: "1px solid #1a1a1a" }}>
        {[
          {
            key: "all" as FunnelFilter,
            label: "Total registered",
            val: allRows.length,
            sub: "all sources combined",
            color: "#fff", bg: "#0f0f0f",
          },
          {
            key: "registered_purchased" as FunnelFilter,
            label: "Registered + purchased",
            val: counts.registered_purchased,
            sub: `${docappPct}% of total · has doc-app + Saleor`,
            color: "#4ade80", bg: "#0f0f0f",
          },
          {
            key: "registered_only" as FunnelFilter,
            label: "Registered, never purchased",
            val: noPurchase,
            sub: `${noPurchasePct}% of total · doc-app only`,
            color: "#93c5fd", bg: "#0f0f0f",
          },
          {
            key: "saleor_only" as FunnelFilter,
            label: "Saleor only",
            val: counts.saleor_only,
            sub: "purchased · no doc-app account",
            color: "#fbbf24", bg: "#0f0f0f",
          },
        ].map(({ key, label, val, sub, color, bg }) => (
          <div
            key={key}
            onClick={() => { setFunnel(key); setPage(1); }}
            style={{ background: funnel === key ? "#1a1a1a" : bg, padding: "18px 24px", cursor: "pointer",
              borderBottom: funnel === key ? `2px solid ${color}` : "2px solid transparent",
              transition: "border-color 0.15s" }}
          >
            <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: "-0.5px", marginTop: 4 }}>
              {loading ? "…" : val.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Conversion funnel visual ── */}
      {!loading && allRows.length > 0 && (
        <div style={{ padding: "16px 32px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 0, fontSize: 12 }}>
          <FunnelBar label="Registered" val={counts.registered_only + counts.registered_purchased} total={allRows.length} color="#93c5fd" />
          <FunnelArrow label={`${docappPct}% converted`} />
          <FunnelBar label="Purchased" val={counts.registered_purchased} total={allRows.length} color="#4ade80" />
          <div style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
            <span style={{ color: "#fbbf24" }}>{counts.saleor_only}</span> saleor-only (no doc-app)
          </div>
        </div>
      )}

      {/* ── Controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        <input type="text" placeholder="Search name or email…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={searchInput} />
        <label style={{ fontSize: 12, color: "#555" }}>Funnel stage</label>
        <select value={funnel} onChange={(e) => { setFunnel(e.target.value as FunnelFilter); setPage(1); }} style={selectStyle}>
          <option value="all">All patients</option>
          <option value="registered_only">Registered — never purchased</option>
          <option value="registered_purchased">Registered + purchased</option>
          <option value="saleor_only">Saleor only</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#555" }}>
          {filtered.length !== allRows.length
            ? `${filtered.length.toLocaleString()} of ${allRows.length.toLocaleString()}`
            : `${allRows.length.toLocaleString()} patients`}
          {` · page ${safePage}/${totalPages}`}
        </span>
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: "auto", padding: "16px 32px 40px" }}>
        {loading && <StateMsg>Loading {" "}<span style={{ color: "#555" }}>pulling all 25k+ patients…</span></StateMsg>}
        {error && <StateMsg isError>Error: {error}</StateMsg>}
        {!loading && !error && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr>
                {([
                  ["name",           "Name"],
                  ["email",          "Email"],
                  ["stage",          "Stage"],
                  ["has_docapp",     "Doc-app"],
                  ["has_saleor",     "Saleor"],
                  ["has_zoho",       "Zoho"],
                  ["created_at",     "Registered"],
                ] as [string, string][]).map(([col, label]) => (
                  <th key={col} style={thStyle(col)} onClick={() => sort(col)}>{label}{arrow(col)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const stage = funnelStage(r);
                const sc = STAGE_CONFIG[stage];
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #1a1a1a" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#141414")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td style={{ padding: "9px 12px", fontWeight: 500, color: "#ddd", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={r.name ?? ""}>{r.name || <span style={{ color: "#333" }}>—</span>}</td>
                    <td style={{ padding: "9px 12px", color: "#666", fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={r.email}>{r.email}</td>
                    <td style={{ padding: "9px 12px" }}>
                      {sc ? (
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                          background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                          {sc.label}
                        </span>
                      ) : (
                        <span style={{ color: "#333", fontSize: 11 }}>unknown</span>
                      )}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}>
                      {r.has_docapp
                        ? <span style={{ color: "#4ade80", fontSize: 16 }}>✓</span>
                        : <span style={{ color: "#2a2a2a", fontSize: 16 }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}>
                      {r.has_saleor
                        ? <span style={{ color: "#818cf8", fontSize: 16 }}>✓</span>
                        : <span style={{ color: "#2a2a2a", fontSize: 16 }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "center" }}>
                      {r.has_zoho
                        ? <span style={{ color: "#a78bfa", fontSize: 16 }}>✓</span>
                        : <span style={{ color: "#2a2a2a", fontSize: 16 }}>—</span>}
                    </td>
                    <td style={{ padding: "9px 12px", color: "#555", fontSize: 12, whiteSpace: "nowrap" }}>
                      {r.created_at ? new Date(r.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "60px 12px", textAlign: "center", color: "#555" }}>No patients match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {!loading && !error && totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "0 32px 48px", fontSize: 13, color: "#555" }}>
          <button onClick={() => setPage(1)} disabled={safePage === 1} style={ghostBtn}>«</button>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} style={ghostBtn}>← Prev</button>
          <span>Page {safePage} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={ghostBtn}>Next →</button>
          <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} style={ghostBtn}>»</button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function FunnelBar({ label, val, total, color }: { label: string; val: number; total: number; color: string }) {
  const pct = total ? Math.round(val / total * 100) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: "#555" }}>{label}</div>
      <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, width: 120 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
      <div style={{ fontSize: 12 }}>
        <span style={{ fontWeight: 600, color }}>{val.toLocaleString()}</span>
        <span style={{ color: "#444" }}> ({pct}%)</span>
      </div>
    </div>
  );
}

function FunnelArrow({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0 16px" }}>
      <div style={{ fontSize: 10, color: "#444" }}>{label}</div>
      <div style={{ fontSize: 18, color: "#333" }}>→</div>
    </div>
  );
}

function StateMsg({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return <div style={{ textAlign: "center", padding: "80px 0", color: isError ? "#ef4444" : "#555", fontSize: 14 }}>{children}</div>;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const navLink:     React.CSSProperties = { fontSize: 12, color: "#555", textDecoration: "none", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap" };
const ghostBtn:    React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", fontSize: 12, padding: "7px 14px", cursor: "pointer" };
const searchInput: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#e8e8e8", fontSize: 13, padding: "7px 12px", width: 240, outline: "none" };
const selectStyle: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#e8e8e8", fontSize: 13, padding: "7px 10px", outline: "none", cursor: "pointer" };

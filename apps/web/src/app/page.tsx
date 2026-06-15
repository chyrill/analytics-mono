"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const PAGE_SIZE = 50;

// ── Types ──────────────────────────────────────────────────────────────────────
interface Customer {
  id: string;
  email: string;
  name: string | null;
  zohoContactId: string | null;
  saleorCustomerId: string | null;
  docAppPatientId: string | null;
  reconciliationStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SyncJobStatus {
  id: string;
  source: string;
  mode: string;
  status: string;
  recordsFetched: number | null;
  recordsUpserted: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface CustomersResponse {
  rows: Customer[];
  total: number;
  limit: number;
  offset: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function deriveSource(c: Customer): string {
  const sources = [
    c.zohoContactId && "zoho",
    c.saleorCustomerId && "saleor",
    c.docAppPatientId && "docapp",
  ].filter(Boolean) as string[];
  return sources.join("+") || "unknown";
}

function truncateId(id: string | null, len = 14): string {
  if (!id) return "—";
  return id.length > len ? id.slice(0, len) + "…" : id;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-AU"); }
  catch { return "—"; }
}

// ── Data loading ───────────────────────────────────────────────────────────────
async function fetchCustomers(): Promise<CustomersResponse> {
  const r = await fetch(`${API_BASE}/customers?limit=5000`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  // Support both old plain-array response and new { rows, total } shape
  if (Array.isArray(data)) {
    return { rows: data as Customer[], total: (data as Customer[]).length, limit: 5000, offset: 0 };
  }
  return data as CustomersResponse;
}

// ── Source chip config ─────────────────────────────────────────────────────────
const SOURCE_CHIPS = [
  { key: "saleor+docapp", color: "#22c55e", label: "Saleor + DocApp", tip: "Email matched in both systems — fully reconciled patient." },
  { key: "zoho+saleor+docapp", color: "#a855f7", label: "All three", tip: "Present in Zoho, Saleor, and DocApp." },
  { key: "saleor", color: "#60a5fa", label: "Saleor only", tip: "Customer exists in the Saleor shop but no DocApp record." },
  { key: "docapp", color: "#facc15", label: "DocApp only", tip: "Patient in DocApp without a matching Saleor account." },
  { key: "zoho", color: "#f472b6", label: "Zoho only", tip: "Contact in Zoho CRM only — not yet in other systems." },
  { key: "zoho+saleor", color: "#c084fc", label: "Zoho + Saleor", tip: "In Zoho and Saleor but no DocApp patient record." },
  { key: "zoho+docapp", color: "#34d399", label: "Zoho + DocApp", tip: "In Zoho and DocApp but no Saleor account." },
] as const;

const SOURCE_COLORS: Record<string, string> = {
  "saleor+docapp": "#22c55e",
  "zoho+saleor+docapp": "#a855f7",
  saleor: "#60a5fa",
  docapp: "#facc15",
  zoho: "#f472b6",
  "zoho+saleor": "#c084fc",
  "zoho+docapp": "#34d399",
  unknown: "#444",
};

// ── Component ──────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [allRows, setAllRows] = useState<Customer[]>([]);
  const [dbTotal, setDbTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [syncJobs, setSyncJobs] = useState<Record<string, SyncJobStatus | null>>({});
  const [isFirstSync, setIsFirstSync] = useState(false);
  const pollTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Controls
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [sortCol, setSortCol] = useState("createdAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(1);

  // Detail panel
  const [panel, setPanel] = useState<Customer | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchCustomers()
      .then((d) => { setAllRows(d.rows ?? []); setDbTotal(d.total ?? 0); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // Check if this is the first Zoho sync (no checkpoint yet)
    fetch(`${API_BASE}/sync/checkpoints?source=zoho`)
      .then((r) => r.json() as Promise<{ source: string; entity: string }[]>)
      .then((rows) => { setIsFirstSync(rows.length === 0); })
      .catch(() => { });
    return () => { Object.values(pollTimers.current).forEach(clearTimeout); };
  }, []);

  // Close panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setPanel(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Derived counts ───────────────────────────────────────────────────────────
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of allRows) {
      const s = deriveSource(r);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [allRows]);

  const matchedCount = useMemo(
    () => allRows.filter((r) => r.reconciliationStatus === "matched").length,
    [allRows],
  );
  const gapCount = useMemo(
    () => allRows.filter((r) => r.reconciliationStatus === "gap").length,
    [allRows],
  );

  // ── Filtered + sorted rows ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allRows
      .filter((r) => {
        if (q && !(r.email.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q))) return false;
        if (filterStatus && r.reconciliationStatus !== filterStatus) return false;
        if (filterSource && deriveSource(r) !== filterSource) return false;
        return true;
      })
      .sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[sortCol];
        const bv = (b as unknown as Record<string, unknown>)[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? sortDir : av > bv ? -sortDir : 0;
      });
  }, [allRows, search, filterStatus, filterSource, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortCol(col); setSortDir(-1); }
    setPage(1);
  }

  function pollJob(source: string, jobId: string) {
    const tick = () => {
      fetch(`${API_BASE}/sync/jobs/${jobId}`)
        .then((r) => {
          if (!r.ok) { setSyncing((prev) => ({ ...prev, [source]: false })); return; }
          return r.json() as Promise<SyncJobStatus>;
        })
        .then((job) => {
          if (!job) return;
          if (job.status === "completed" || job.status === "failed") {
            setSyncJobs((prev) => ({ ...prev, [source]: job }));
            setSyncing((prev) => ({ ...prev, [source]: false }));
            if (job.status === "completed") { load(); setIsFirstSync(false); }
          } else {
            pollTimers.current[source] = setTimeout(tick, 3000);
          }
        })
        .catch(() => setSyncing((prev) => ({ ...prev, [source]: false })));
    };
    pollTimers.current[source] = setTimeout(tick, 3000);
  }

  function handleSyncSource(source: "zoho" | "saleor" | "db" | "docapp") {
    setSyncing((prev) => ({ ...prev, [source]: true }));
    setSyncJobs((prev) => ({ ...prev, [source]: null }));
    clearTimeout(pollTimers.current[source]);

    fetch(`${API_BASE}/sync/${source}`, { method: "POST" })
      .then((r) => {
        if (r.status === 409) return r.json().then((d: { job_id: string }) => { pollJob(source, d.job_id); return null; });
        if (!r.ok) { setSyncing((prev) => ({ ...prev, [source]: false })); return null; }
        return r.json() as Promise<{ job_id: string }>;
      })
      .then((data) => { if (data) pollJob(source, data.job_id); })
      .catch(() => setSyncing((prev) => ({ ...prev, [source]: false })));
  }

  function thStyle(col: string): React.CSSProperties {
    return {
      textAlign: "left",
      padding: "10px 12px",
      fontSize: 11,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      color: sortCol === col ? "#aaa" : "#555",
      borderBottom: "1px solid #222",
      whiteSpace: "nowrap",
      cursor: "pointer",
      userSelect: "none",
    };
  }

  const sortArrow = (col: string) =>
    sortCol === col ? (sortDir === -1 ? " ↓" : " ↑") : "";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#0f0f0f", color: "#e8e8e8" }}>

      {/* ── Header ── */}
      <header style={{ padding: "24px 32px 16px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: "-0.3px", margin: 0 }}>
            Customer Reconciliation Index
          </h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            Cross-system identity matching — Saleor · DocApp · Zoho
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {isFirstSync && (
            <span style={{ fontSize: 11, color: "#f59e0b", background: "#451a03", border: "1px solid #78350f", borderRadius: 5, padding: "4px 10px" }}>
              First sync — may take a few minutes
            </span>
          )}
          {(["zoho", "saleor", "docapp", "db"] as const).map((src) => {
            const job = syncJobs[src];
            const busy = syncing[src];
            return (
              <span key={src} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {job && (
                  <span style={{ fontSize: 11, color: job.status === "completed" ? "#4ade80" : "#f87171" }}>
                    {job.status === "completed" ? `✓ ${job.recordsUpserted ?? 0} rows` : `✗ ${job.errorMessage?.slice(0, 40) ?? "failed"}`}
                  </span>
                )}
                <button
                  onClick={() => handleSyncSource(src)}
                  disabled={busy || loading}
                  style={busy
                    ? { ...ghostBtn, cursor: "not-allowed", opacity: 0.5 }
                    : ghostBtn
                  }
                >
                  {busy ? "…" : `Sync ${{ zoho: "Zoho", saleor: "Saleor", docapp: "DocApp", db: "DB" }[src]}`}
                </button>
              </span>
            );
          })}
          <button onClick={load} disabled={loading} style={ghostBtn}>⟳ Refresh</button>
        </div>
      </header>

      {/* ── Stat chips ── */}
      <div style={{ display: "flex", gap: 12, padding: "16px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        {/* Total / matched / gap */}
        <StatChip color="#888" count={dbTotal} label="total" active={false} onClick={() => { setFilterStatus(""); setFilterSource(""); setPage(1); }} tip="All customer records in the analytics DB." />
        <StatChip color="#22c55e" count={matchedCount} label="matched" active={filterStatus === "matched" && !filterSource} onClick={() => { setFilterStatus(filterStatus === "matched" ? "" : "matched"); setFilterSource(""); setPage(1); }} tip="Email found in 2+ systems — fully reconciled." />
        <StatChip color="#ef4444" count={gapCount} label="gaps" active={filterStatus === "gap" && !filterSource} onClick={() => { setFilterStatus(filterStatus === "gap" ? "" : "gap"); setFilterSource(""); setPage(1); }} tip="Email found in only one system — reconciliation gap." />
        <div style={{ width: 1, background: "#222", margin: "0 4px" }} />
        {/* Source breakdown */}
        {SOURCE_CHIPS.filter((c) => (sourceCounts[c.key] ?? 0) > 0).map((c) => (
          <StatChip
            key={c.key}
            color={c.color}
            count={sourceCounts[c.key] ?? 0}
            label={c.label}
            active={filterSource === c.key}
            onClick={() => { setFilterSource(filterSource === c.key ? "" : c.key); setFilterStatus(""); setPage(1); }}
            tip={c.tip}
          />
        ))}
      </div>

      {/* ── Controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 32px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={searchInput}
        />

        <label style={{ fontSize: 12, color: "#555" }}>Status</label>
        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All statuses</option>
          <option value="matched">Matched</option>
          <option value="gap">Gap</option>
        </select>

        <label style={{ fontSize: 12, color: "#555" }}>Source</label>
        <select value={filterSource} onChange={(e) => { setFilterSource(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="">All sources</option>
          {SOURCE_CHIPS.filter((c) => (sourceCounts[c.key] ?? 0) > 0).map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        <span style={{ fontSize: 12, color: "#555", marginLeft: "auto" }}>
          {filtered.length !== allRows.length
            ? `${filtered.length.toLocaleString()} of ${allRows.length.toLocaleString()}`
            : `${allRows.length.toLocaleString()} customers`}
        </span>
      </div>

      {/* ── Table area ── */}
      <div style={{ overflowX: "auto", padding: "16px 32px 40px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#555", fontSize: 14 }}>
            <div style={spinner} />
            <br />Loading…
          </div>
        )}
        {error && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#ef4444", fontSize: 14 }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr>
                {(
                  [
                    ["email", "Email"],
                    ["name", "Name"],
                    ["_source", "Source"],
                    ["reconciliationStatus", "Status"],
                    ["saleorCustomerId", "Saleor ID"],
                    ["docAppPatientId", "DocApp ID"],
                    ["createdAt", "Created"],
                  ] as [string, string][]
                ).map(([col, label]) => (
                  <th key={col} style={thStyle(col)} onClick={() => handleSort(col)}>
                    {label}{sortArrow(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const src = deriveSource(r);
                const srcColor = SOURCE_COLORS[src] ?? "#444";
                const isMatched = r.reconciliationStatus === "matched";
                return (
                  <tr
                    key={r.id}
                    onClick={() => setPanel(r)}
                    style={{ borderBottom: "1px solid #1a1a1a", cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#161616")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ padding: "10px 12px", color: "#aaa", fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.email}
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 500, color: "#ddd", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.name ?? <span style={{ color: "#444" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: srcColor, display: "inline-block", flexShrink: 0 }} />
                        {src}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        background: isMatched ? "#1a2e1a" : "#2a1515",
                        color: isMatched ? "#86efac" : "#fca5a5",
                        border: `1px solid ${isMatched ? "#166534" : "#991b1b"}`,
                      }}>
                        {r.reconciliationStatus ?? "—"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#666", fontSize: 11, fontFamily: "monospace" }}>
                      {truncateId(r.saleorCustomerId, 16)}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#666", fontSize: 11, fontFamily: "monospace" }}>
                      {truncateId(r.docAppPatientId, 8)}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#555", fontSize: 12, whiteSpace: "nowrap" }}>
                      {fmtDate(r.createdAt)}
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "60px 12px", textAlign: "center", color: "#555" }}>
                    No records match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {!loading && !error && totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "0 32px 40px", fontSize: 13, color: "#555" }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} style={ghostBtn}>
            ← Prev
          </button>
          <span>Page {safePage} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={ghostBtn}>
            Next →
          </button>
        </div>
      )}

      {/* ── Detail Panel ── */}
      {panel && (
        <>
          <div
            onClick={() => setPanel(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100 }}
          />
          <div
            ref={panelRef}
            style={{
              position: "fixed", top: 0, right: 0,
              width: 500, maxWidth: "100vw", height: "100vh",
              background: "#141414", borderLeft: "1px solid #222",
              zIndex: 101, overflowY: "auto",
            }}
          >
            {/* Panel header */}
            <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid #1e1e1e", position: "sticky", top: 0, background: "#141414", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>
                  {panel.name ?? panel.email}
                </h2>
                <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{panel.email}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {/* source dot */}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 4, padding: "3px 8px" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: SOURCE_COLORS[deriveSource(panel)] ?? "#444", display: "inline-block" }} />
                    {deriveSource(panel)}
                  </span>
                  {/* status */}
                  <span style={{
                    display: "inline-block", padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500,
                    background: panel.reconciliationStatus === "matched" ? "#1a2e1a" : "#2a1515",
                    color: panel.reconciliationStatus === "matched" ? "#86efac" : "#fca5a5",
                    border: `1px solid ${panel.reconciliationStatus === "matched" ? "#166534" : "#991b1b"}`,
                  }}>
                    {panel.reconciliationStatus ?? "unknown"}
                  </span>
                </div>
              </div>
              <button onClick={() => setPanel(null)} style={{ background: "none", border: "none", color: "#555", fontSize: 18, cursor: "pointer", padding: "4px 8px", borderRadius: 4, lineHeight: 1 }}>
                ✕
              </button>
            </div>

            {/* Panel stat grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#1a1a1a", borderBottom: "1px solid #1a1a1a" }}>
              {[
                ["Saleor ID", panel.saleorCustomerId ?? "—"],
                ["DocApp ID", panel.docAppPatientId ?? "—"],
                ["Zoho ID", panel.zohoContactId ?? "—"],
                ["Status", panel.reconciliationStatus ?? "—"],
              ].map(([label, val]) => (
                <div key={label} style={{ background: "#141414", padding: "16px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.4px" }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginTop: 6, fontFamily: "monospace", wordBreak: "break-all" }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Panel detail rows */}
            <div style={{ padding: "20px 24px" }}>
              <h3 style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#555", marginBottom: 14 }}>Record Details</h3>
              {[
                ["Email", panel.email],
                ["Full name", panel.name ?? "—"],
                ["Created", fmtDate(panel.createdAt)],
                ["Updated", fmtDate(panel.updatedAt)],
              ].map(([label, val]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1a1a1a", fontSize: 13 }}>
                  <span style={{ color: "#555" }}>{label}</span>
                  <span style={{ color: "#ddd", maxWidth: "60%", textAlign: "right", wordBreak: "break-all" }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatChip({
  color, count, label, active, onClick, tip,
}: {
  color: string; count: number; label: string;
  active: boolean; onClick: () => void; tip: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        background: active ? "#1e1e2e" : hovered ? "#222" : "#1a1a1a",
        border: `1px solid ${active ? color : hovered ? "#444" : "#222"}`,
        boxShadow: active ? `0 0 0 1px ${color}` : "none",
        borderRadius: 6, padding: "6px 12px", fontSize: 12,
        cursor: "pointer", userSelect: "none", transition: "all 0.15s",
        position: "relative",
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: "#fff" }}>{count.toLocaleString()}</span>
      <span style={{ color: active ? "#aaa" : "#666" }}>{label}</span>
      {/* Tooltip */}
      {hovered && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0,
          background: "#1e1e1e", border: "1px solid #333", borderRadius: 8,
          padding: "10px 14px", fontSize: 12, lineHeight: 1.6, color: "#ccc",
          whiteSpace: "pre-line", minWidth: 200, maxWidth: 260, zIndex: 200,
          pointerEvents: "none", boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          {tip}
        </div>
      )}
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────────────────────
const ghostBtn: React.CSSProperties = {
  background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6,
  color: "#aaa", fontSize: 12, padding: "7px 14px", cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  background: "#162033", border: "1px solid #274166", borderRadius: 6,
  color: "#dbeafe", fontSize: 12, fontWeight: 600, padding: "7px 14px", cursor: "pointer",
};

const searchInput: React.CSSProperties = {
  background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6,
  color: "#e8e8e8", fontSize: 13, padding: "7px 12px", width: 240, outline: "none",
};

const selectStyle: React.CSSProperties = {
  background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6,
  color: "#e8e8e8", fontSize: 13, padding: "7px 10px", outline: "none", cursor: "pointer",
};

const spinner: React.CSSProperties = {
  display: "inline-block", width: 20, height: 20,
  border: "2px solid #333", borderTopColor: "#666",
  borderRadius: "50%", animation: "spin 0.7s linear infinite",
};

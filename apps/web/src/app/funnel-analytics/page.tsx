"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Pipeline {
  total_patients: number;
  booked_consult: number;
  showed_up: number;
  no_show: number;
  pre_consult: number;
  has_tp: number;
  app_approved: number;
  app_rejected: number;
  app_pending: number;
  admitted: number;
}
interface Row { tag?: string; outcome?: string; status?: string; symptom?: string; age_group?: string; gender?: string; state?: string; cnt: number; showed_up?: number; no_show?: number; }
interface BookingSourceRow { source: string; total_booked: number; showed_up: number; no_show: number; }
interface AdminBookerRow { name: string; bookings: number; showed_up: number; no_show: number; }
// ── Questionnaire types ─────────────────────────────────────────────────────
interface QRegToCompletion { avg_hours: number; median_hours: number; patients: number; }
interface QTimingBuckets  { total: number; within_30min: number; h1_to_2h: number; h2_to_24h: number; over_24h: number; }
interface QStepRow        { step: number; label: string; sessions?: number; users?: number; }
interface QStageRow       { stage: string; cnt: number; }
interface QData {
  regToCompletion:   QRegToCompletion;
  timingBuckets:     QTimingBuckets;
  stepDropoff:       QStepRow[];
  stepReach:         QStepRow[];
  lastCompletedForm: QStageRow[];
}
// ── Drop-off waterfall types ───────────────────────────────────────────────
interface WaterfallStage { stage: string; label: string; count: number; pct_of_registered: number; pct_of_prev: number; }
interface WaterfallData { stages: WaterfallStage[]; consent_no_booking: number; fetchedAt: string; }
// ── AI insights types ────────────────────────────────────────────────────────
interface AIRec {
  priority: number;
  title: string;
  impact: "high" | "medium" | "low";
  effort: "high" | "medium" | "low";
  description: string;
  metric: string;
}
interface AIInsights {
  summary: string;
  recommendations: AIRec[];
  generatedAt: string;
}
interface FunnelData {
  pipeline: Pipeline;
  consultOutcomes: Row[];
  tpOutcomes: Row[];
  appStatus: Row[];
  topSymptoms: Row[];
  noShowSymptoms: Row[];
  ageGroups: Row[];
  genders: Row[];
  states: Row[];
  bookingSourceStats: BookingSourceRow[];
  adminBookers: AdminBookerRow[];
  fetchedAt: string;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const PALETTE = ["#6366f1","#22d3ee","#4ade80","#fbbf24","#f87171","#a78bfa","#fb923c","#34d399","#60a5fa","#e879f9"];
const GREEN  = "#4ade80";
const RED    = "#f87171";
const AMBER  = "#fbbf24";
const BLUE   = "#60a5fa";
const PURPLE = "#a78bfa";

// ── Helpers ────────────────────────────────────────────────────────────────────
function pct(n: number, d: number) { return d ? Math.round(n / d * 100) : 0; }
function fmt(n: number) { return n?.toLocaleString() ?? "—"; }

function HBar({ label, val, max, color, sub }: { label: string; val: number; max: number; color: string; sub?: string }) {
  const w = max ? Math.round(val / max * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "#bbb" }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{fmt(val)}{sub ? ` · ${sub}` : ""}</span>
      </div>
      <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3 }}>
        <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function StatCard({ label, val, sub, color }: { label: string; val: number; sub?: string; color?: string }) {
  return (
    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "16px 20px" }}>
      <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? "#fff", letterSpacing: "-0.5px", marginTop: 4 }}>{fmt(val)}</div>
      {sub && <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", color: "#444", marginBottom: 16, paddingBottom: 8, borderBottom: "1px solid #1a1a1a" }}>{title}</h2>
      {children}
    </section>
  );
}

// ── TP outcome grouping ────────────────────────────────────────────────────────
function tpGroup(outcome: string): { label: string; color: string } {
  const o = outcome?.toLowerCase() ?? "";
  if (o.includes("reject"))          return { label: "Reject",         color: RED };
  if (o.includes("unrestricted"))    return { label: "Approve Unres.",  color: GREEN };
  if (o.includes("restricted"))      return { label: "Approve Restr.",  color: "#22d3ee" };
  if (o.includes("gp"))              return { label: "Approve w/ GP",   color: AMBER };
  if (o.includes("discharge"))       return { label: "Approve w/ Dis.", color: "#fb923c" };
  if (o.includes("trial") || o.includes("cbd")) return { label: "Approve Trial", color: PURPLE };
  return { label: outcome, color: "#555" };
}

// ── Main ───────────────────────────────────────────────────────────────────────
type Period = "all" | "this_week" | "last_week" | "last_30d" | "last_90d" | "custom";
const PERIOD_LABELS: Record<Period, string> = {
  all:       "All time",
  this_week: "This week",
  last_week: "Last week",
  last_30d:  "Last 30 days",
  last_90d:  "Last 90 days",
  custom:    "Custom range",
};

export default function FunnelAnalyticsPage() {
  const [data, setData]     = useState<FunnelData | null>(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [qData, setQData]   = useState<QData | null>(null);
  const [qLoad, setQLoad]   = useState(true);
  const [qErr, setQErr]     = useState<string | null>(null);
  const [aiData, setAiData]        = useState<AIInsights | null>(null);
  const [aiLoad, setAiLoad]        = useState(false);
  const [aiErr, setAiErr]          = useState<string | null>(null);
  const [period, setPeriod]        = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  const [wData, setWData]          = useState<WaterfallData | null>(null);
  const [wLoad, setWLoad]          = useState(true);

  function buildQS(p: Period, from: string, to: string): string {
    if (p === "custom" && from) {
      return to ? `?from=${from}&to=${to}` : `?from=${from}`;
    }
    return p !== "all" ? `?period=${p}` : "";
  }

  function load(p: Period = period, from: string = customFrom, to: string = customTo) {
    const qs = buildQS(p, from, to);
    setLoad(true); setError(null);
    fetch(`${API_BASE}/funnel-analytics${qs}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<FunnelData>; })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoad(false));

    setQLoad(true); setQErr(null);
    fetch(`${API_BASE}/questionnaire-analytics${qs}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<QData>; })
      .then(setQData)
      .catch((e: Error) => setQErr(e.message))
      .finally(() => setQLoad(false));

    setWLoad(true);
    fetch(`${API_BASE}/funnel-drop-waterfall${qs}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<WaterfallData>; })
      .then(setWData)
      .catch(() => setWData(null))
      .finally(() => setWLoad(false));
  }

  useEffect(() => { load(period, customFrom, customTo); }, [period]);

  // Normalised symptoms — merge near-duplicate labels
  const mergedSymptoms = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const r of data.topSymptoms) {
      const key = (r.symptom ?? "").trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + r.cnt);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [data]);

  const mergedNoShow = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, number>();
    for (const r of data.noShowSymptoms) {
      const key = (r.symptom ?? "").trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + r.cnt);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [data]);

  // Step-to-step conversion rates derived from stepReach counts
  const stepConversionRates = useMemo(() => {
    if (!qData?.stepReach?.length) return [];
    return qData.stepReach.map((row, i) => ({
      ...row,
      rate: i === 0 ? 100 : (qData.stepReach[i - 1].users ?? 0) > 0
        ? Math.round(((row.users ?? 0) / (qData.stepReach[i - 1].users ?? 1)) * 100)
        : 0,
    }));
  }, [qData]);

  const p = data?.pipeline;
  const maxSymptom  = mergedSymptoms[0]?.[1]  ?? 1;
  const maxNoShow   = mergedNoShow[0]?.[1]    ?? 1;
  const maxAge      = Math.max(...(data?.ageGroups.map((r) => r.cnt) ?? [1]));
  const maxState    = data?.states[0]?.cnt ?? 1;

  const tpTotal   = data?.tpOutcomes.reduce((s, r) => s + r.cnt, 0) ?? 1;
  const tpApprove = data?.tpOutcomes.filter((r) => !r.outcome?.toLowerCase().includes("reject")).reduce((s, r) => s + r.cnt, 0) ?? 0;
  const tpReject  = data?.tpOutcomes.find((r) => r.outcome?.toLowerCase().includes("reject"))?.cnt ?? 0;

  function generateInsights() {
    if (!data || !qData) return;
    setAiLoad(true); setAiErr(null); setAiData(null);
    fetch(`${API_BASE}/ai-conversion-insights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipeline:          data.pipeline,
        bookingSourceStats: data.bookingSourceStats,
        regToCompletion:   qData.regToCompletion,
        timingBuckets:     qData.timingBuckets,
        stepDropoff:       qData.stepDropoff,
        stepReach:         qData.stepReach,
        lastCompletedForm: qData.lastCompletedForm,
      }),
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<AIInsights>; })
      .then(setAiData)
      .catch((e: Error) => setAiErr(e.message))
      .finally(() => setAiLoad(false));
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* ── Header ── */}
      <header style={{ padding: "24px 32px 16px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#fff", margin: 0, letterSpacing: "-0.3px" }}>Funnel Analytics</h1>
          <p style={{ fontSize: 13, color: "#555", marginTop: 4 }}>Registration → consultation → treatment plan · profiling conversion opportunities{period !== "all" ? <span style={{ color: BLUE, marginLeft: 8, fontSize: 12 }}>· {PERIOD_LABELS[period]}</span> : null}</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/patients"               style={navLink}>Patient Registry →</Link>
          <Link href="/health"                 style={navLink}>Health Index →</Link>
          <Link href="/shop-analytics" style={navLink}>Shop Analytics →</Link>
          <Link href="/"               style={navLink}>Reconciliation →</Link>
          <div style={{ display: "flex", gap: 2, background: "#0d0d0d", borderRadius: 7, padding: 3, border: "1px solid #222" }}>
            {(["all", "this_week", "last_week", "last_30d", "last_90d", "custom"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} disabled={loading} style={{ background: period === p ? "#1a2e4a" : "transparent", color: period === p ? BLUE : "#666", border: "none", borderRadius: 5, padding: "4px 11px", fontSize: 11.5, fontWeight: period === p ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s" }}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, color: "#bbb", fontSize: 11.5, padding: "4px 8px", cursor: "pointer" }}
              />
              <span style={{ color: "#444", fontSize: 11 }}>to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: 5, color: "#bbb", fontSize: 11.5, padding: "4px 8px", cursor: "pointer" }}
              />
              <button
                onClick={() => load("custom", customFrom, customTo)}
                disabled={!customFrom || loading}
                style={{ ...ghostBtn, opacity: !customFrom ? 0.4 : 1 }}
              >Apply</button>
            </div>
          )}
          <button onClick={() => load(period, customFrom, customTo)} disabled={loading} style={ghostBtn}>⟳ Refresh</button>
        </div>
      </header>

      {loading && <Msg>Loading funnel data from doc-app…</Msg>}
      {error   && <Msg isError>Error: {error}</Msg>}

      {data && p && (
        <div style={{ padding: "28px 32px" }}>

          {/* ── Section 0: Drop-Off Waterfall ── */}
          {wData && (
            <Section title="Funnel Drop-Off Waterfall">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, background: "#1a1a1a", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
                {wData.stages.map((s, i) => (
                  <div key={s.stage} style={{ background: "#0f0f0f", padding: "16px 18px" }}>
                    <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: i === 0 ? "#fff" : s.pct_of_prev >= 70 ? GREEN : s.pct_of_prev >= 40 ? AMBER : RED, letterSpacing: "-0.3px" }}>{fmt(s.count)}</div>
                    <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>
                      {i === 0 ? "baseline" : <><span style={{ color: s.pct_of_prev >= 70 ? GREEN : s.pct_of_prev >= 40 ? AMBER : RED, fontWeight: 600 }}>{s.pct_of_prev}%</span> of prev stage</>}
                    </div>
                    <div style={{ height: 3, background: "#1a1a1a", borderRadius: 2, marginTop: 8 }}>
                      <div style={{ height: "100%", width: `${s.pct_of_registered}%`, background: i === 0 ? "#444" : s.pct_of_prev >= 70 ? GREEN : s.pct_of_prev >= 40 ? AMBER : RED, borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>
              {wData.consent_no_booking > 0 && (
                <div style={{ background: "#1a0f00", border: "1px solid #3d2800", borderRadius: 8, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#664400", textTransform: "uppercase", letterSpacing: "0.5px" }}>Dark zone — consent signed, no booking</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: AMBER, marginTop: 2 }}>{fmt(wData.consent_no_booking)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#664400", lineHeight: 1.6 }}>
                    Patients who completed the consent form but never booked a slot. These are high-intent patients who stopped between Step 13 and Step 14 — a direct intervention target.
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* ── Section 1: Funnel Pipeline ── */}
          <Section title="Registration Funnel">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 1, background: "#1a1a1a", borderRadius: 8, overflow: "hidden", marginBottom: 28 }}>
              {[
                { label: "Registered",        val: p.total_patients, color: "#fff",   sub: period === "all" ? "all time" : PERIOD_LABELS[period] },
                { label: "Booked consult",     val: p.booked_consult, color: BLUE,    sub: `${pct(p.booked_consult, p.total_patients)}% of registered` },
                { label: "Showed up",          val: p.showed_up,      color: GREEN,   sub: `${pct(p.showed_up, p.booked_consult)}% of booked` },
                { label: "No-show",            val: p.no_show,        color: RED,     sub: `${pct(p.no_show, p.booked_consult)}% of booked` },
                { label: "Upcoming / pending", val: p.pre_consult,    color: AMBER,   sub: "pre-consult" },
                { label: "Got treatment plan", val: p.has_tp,         color: PURPLE,  sub: `${pct(p.has_tp, p.showed_up)}% of attended` },
                { label: "Admitted",           val: p.admitted,       color: "#34d399", sub: `${pct(p.admitted, p.has_tp)}% of TP patients` },
              ].map(({ label, val, color, sub }) => (
                <div key={label} style={{ background: "#0f0f0f", padding: "16px 20px" }}>
                  <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{fmt(val)}</div>
                  <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Conversion funnel visual */}
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
              <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Conversion rate through stages</div>
              <HBar label="Registered"          val={p.total_patients} max={p.total_patients} color="#666" />
              <HBar label="Booked a consult"    val={p.booked_consult} max={p.total_patients} color={BLUE}   sub={`${pct(p.booked_consult,  p.total_patients)}%`} />
              <HBar label="Attended (showed up)"val={p.showed_up}      max={p.total_patients} color={GREEN}  sub={`${pct(p.showed_up,       p.total_patients)}%`} />
              <HBar label="Got treatment plan"  val={p.has_tp}         max={p.total_patients} color={PURPLE} sub={`${pct(p.has_tp,          p.total_patients)}%`} />
              <HBar label="Admitted"            val={p.admitted}       max={p.total_patients} color="#34d399"sub={`${pct(p.admitted,        p.total_patients)}%`} />
            </div>
          </Section>

          {/* ── Section 2: Application Status + Consultation outcomes side by side ── */}
          <Section title="Application Status &amp; Consultation Outcomes">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* App status */}
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Patient application status</div>
                {[
                  { label: "Approved",    val: p.app_approved, color: GREEN },
                  { label: "Pending",     val: p.app_pending,  color: AMBER },
                  { label: "Rejected",    val: p.app_rejected, color: RED   },
                  { label: "No status",   val: p.total_patients - p.app_approved - p.app_rejected - p.app_pending, color: "#333" },
                ].map(({ label, val, color }) => (
                  <HBar key={label} label={label} val={val} max={p.total_patients} color={color} sub={`${pct(val, p.total_patients)}%`} />
                ))}
              </div>

              {/* Consult outcomes */}
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Consultation queue breakdown</div>
                {data.consultOutcomes.map((r, i) => {
                  const colors: Record<string, string> = { "showed-up": GREEN, "no-show": RED, "pre-consult": AMBER, "post-consult": BLUE };
                  const total = data.consultOutcomes.reduce((s, x) => s + x.cnt, 0);
                  return <HBar key={r.tag} label={r.tag ?? ""} val={r.cnt} max={total} color={colors[r.tag ?? ""] ?? PALETTE[i % PALETTE.length]} sub={`${pct(r.cnt, total)}%`} />;
                })}
              </div>
            </div>
          </Section>

          {/* ── Section 3: Booking Source Comparison ── */}
          <Section title="Booking Source: Self-Booked vs Sales-Assisted">
            {(() => {
              const selfRow  = data.bookingSourceStats.find((r) => r.source === "patient");
              const adminRow = data.bookingSourceStats.find((r) => r.source === "admin");
              const selfTotal  = selfRow?.total_booked  ?? 0;
              const adminTotal = adminRow?.total_booked ?? 0;
              const grandTotal = selfTotal + adminTotal;
              return (
                <>
                  {/* Summary stat tiles */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 1, background: "#1a1a1a", borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
                    {[
                      { label: "Self-booked",         val: selfTotal,              color: BLUE,    sub: `${pct(selfTotal, grandTotal)}% of bookings` },
                      { label: "Sales-assisted",       val: adminTotal,             color: AMBER,   sub: `${pct(adminTotal, grandTotal)}% of bookings` },
                      { label: "Self — showed up",     val: selfRow?.showed_up ?? 0,  color: GREEN,   sub: `${pct(selfRow?.showed_up ?? 0, selfTotal)}% show-up rate` },
                      { label: "Sales — showed up",    val: adminRow?.showed_up ?? 0, color: GREEN,   sub: `${pct(adminRow?.showed_up ?? 0, adminTotal)}% show-up rate` },
                      { label: "Self — no-show",       val: selfRow?.no_show ?? 0,  color: RED,     sub: `${pct(selfRow?.no_show ?? 0, selfTotal)}% no-show rate` },
                      { label: "Sales — no-show",      val: adminRow?.no_show ?? 0, color: RED,     sub: `${pct(adminRow?.no_show ?? 0, adminTotal)}% no-show rate` },
                    ].map(({ label, val, color, sub }) => (
                      <div key={label} style={{ background: "#0f0f0f", padding: "14px 18px" }}>
                        <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                        <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{fmt(val)}</div>
                        <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Side-by-side comparison bars */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                    {/* Self-booked */}
                    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                      <div style={{ fontSize: 13, color: BLUE, fontWeight: 600, marginBottom: 4 }}>Self-Booked (Patient)</div>
                      <div style={{ fontSize: 11, color: "#444", marginBottom: 16 }}>Patient initiated their own booking</div>
                      <HBar label="Total booked"  val={selfTotal}             max={grandTotal}  color={BLUE}  sub={`${pct(selfTotal, grandTotal)}% of all`} />
                      <HBar label="Showed up"     val={selfRow?.showed_up ?? 0}  max={selfTotal} color={GREEN} sub={`${pct(selfRow?.showed_up ?? 0, selfTotal)}%`} />
                      <HBar label="No-show"       val={selfRow?.no_show ?? 0}  max={selfTotal}   color={RED}   sub={`${pct(selfRow?.no_show ?? 0, selfTotal)}%`} />
                    </div>
                    {/* Sales-assisted */}
                    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                      <div style={{ fontSize: 13, color: AMBER, fontWeight: 600, marginBottom: 4 }}>Sales-Assisted (Admin-booked)</div>
                      <div style={{ fontSize: 11, color: "#444", marginBottom: 16 }}>Booked by a sales / support team member</div>
                      <HBar label="Total booked"  val={adminTotal}              max={grandTotal}   color={AMBER} sub={`${pct(adminTotal, grandTotal)}% of all`} />
                      <HBar label="Showed up"     val={adminRow?.showed_up ?? 0}  max={adminTotal} color={GREEN} sub={`${pct(adminRow?.showed_up ?? 0, adminTotal)}%`} />
                      <HBar label="No-show"       val={adminRow?.no_show ?? 0}  max={adminTotal}   color={RED}   sub={`${pct(adminRow?.no_show ?? 0, adminTotal)}%`} />
                    </div>
                  </div>

                  {/* Admin bookers leaderboard */}
                  {data.adminBookers.length > 0 && (() => {
                    const totB = data.adminBookers.reduce((a, r) => a + r.bookings,  0);
                    const totS = data.adminBookers.reduce((a, r) => a + r.showed_up, 0);
                    const totN = data.adminBookers.reduce((a, r) => a + r.no_show,   0);
                    const totP = totB - totS - totN;
                    return (
                    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px", marginBottom: 16 }}>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 14 }}>Sales team — bookings booked on behalf of patients</div>

                      {/* Aggregate versus panel */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#1a1a1a", borderRadius: 6, overflow: "hidden", marginBottom: 20 }}>
                        {[
                          { label: "Total booked", val: totB, color: "#fff" },
                          { label: "Showed up",    val: totS, color: GREEN,  sub: `${pct(totS, totB)}% show rate`  },
                          { label: "No-show",      val: totN, color: RED,    sub: `${pct(totN, totB)}% no-show rate` },
                          { label: "Pending",      val: totP, color: AMBER,  sub: `${pct(totP, totB)}% unresolved`  },
                        ].map(({ label, val, color, sub }) => (
                          <div key={label} style={{ background: "#0f0f0f", padding: "14px 18px" }}>
                            <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{fmt(val)}</div>
                            {sub && <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{sub}</div>}
                          </div>
                        ))}
                      </div>

                      {/* Aggregate stacked bar */}
                      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "#1a1a1a", marginBottom: 20 }}>
                        <div style={{ width: `${pct(totS, totB)}%`, background: GREEN, transition: "width 0.4s" }} />
                        <div style={{ width: `${pct(totN, totB)}%`, background: RED,   transition: "width 0.4s" }} />
                        <div style={{ flex: 1, background: "#2a2a2a" }} />
                      </div>

                      {data.adminBookers.map((r, i) => {
                        const showPct   = r.bookings ? Math.round(r.showed_up / r.bookings * 100) : 0;
                        const noshowPct = r.bookings ? Math.round(r.no_show   / r.bookings * 100) : 0;
                        const pending   = r.bookings - r.showed_up - r.no_show;
                        return (
                          <div key={r.name} style={{ marginBottom: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                              <span style={{ fontSize: 13, color: "#ccc" }}>{r.name}</span>
                              <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
                                <span style={{ color: GREEN  }}>↑ {r.showed_up} showed ({showPct}%)</span>
                                <span style={{ color: RED    }}>✕ {r.no_show} no-show ({noshowPct}%)</span>
                                {pending > 0 && <span style={{ color: AMBER }}>⧖ {pending} pending</span>}
                                <span style={{ color: PALETTE[i % PALETTE.length], fontWeight: 600 }}>{r.bookings} total</span>
                              </div>
                            </div>
                            {/* Stacked bar: showed / no-show / pending */}
                            <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1a1a1a" }}>
                              <div style={{ width: `${showPct}%`,   background: GREEN, transition: "width 0.4s" }} />
                              <div style={{ width: `${noshowPct}%`, background: RED,   transition: "width 0.4s" }} />
                              <div style={{ width: `${Math.min(100 - showPct - noshowPct, 100)}%`, background: "#2a2a2a" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    );
                  })()}

                  {/* Insight callout */}
                  <div style={{ background: "#0f1520", border: "1px solid #1d3a5e", borderRadius: 8, padding: "16px 20px" }}>
                    <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginBottom: 6 }}>Booking source insight</div>
                    <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
                      Sales-assisted bookings have a <strong style={{ color: GREEN }}>{pct(adminRow?.showed_up ?? 0, adminTotal)}% show-up rate</strong> vs&nbsp;
                      <strong style={{ color: BLUE }}>{pct(selfRow?.showed_up ?? 0, selfTotal)}% for self-booked</strong> patients —&nbsp;
                      {pct(adminRow?.showed_up ?? 0, adminTotal) > pct(selfRow?.showed_up ?? 0, selfTotal)
                        ? `a ${pct(adminRow?.showed_up ?? 0, adminTotal) - pct(selfRow?.showed_up ?? 0, selfTotal)} percentage-point lift from sales team involvement.`
                        : "suggesting self-booked patients may already have higher intent."}
                      &nbsp;Of the <strong style={{ color: "#fff" }}>{fmt(grandTotal)}</strong> total bookings tracked, <strong style={{ color: AMBER }}>{fmt(adminTotal)}</strong> ({pct(adminTotal, grandTotal)}%) were facilitated by the sales team.
                    </div>
                  </div>
                </>
              );
            })()}
          </Section>

          {/* ── Section 4: Treatment Plan Outcomes ── */}
          <Section title="Treatment Plan Outcomes">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 1, background: "#1a1a1a", borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
              {[
                { label: "Total TPs issued", val: tpTotal,   color: "#fff"  },
                { label: "Approved (any)",   val: tpApprove, color: GREEN,  sub: `${pct(tpApprove, tpTotal)}% approval rate` },
                { label: "Rejected",         val: tpReject,  color: RED,    sub: `${pct(tpReject,  tpTotal)}% rejection rate` },
              ].map(({ label, val, color, sub }) => (
                <div key={label} style={{ background: "#0f0f0f", padding: "16px 20px" }}>
                  <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color, marginTop: 4 }}>{fmt(val)}</div>
                  {sub && <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{sub}</div>}
                </div>
              ))}
            </div>
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
              {data.tpOutcomes.map((r, i) => {
                const { color } = tpGroup(r.outcome ?? "");
                return <HBar key={r.outcome} label={r.outcome ?? ""} val={r.cnt} max={tpTotal} color={color ?? PALETTE[i % PALETTE.length]} sub={`${pct(r.cnt, tpTotal)}%`} />;
              })}
            </div>
          </Section>

          {/* ── Section 5: Symptoms ── */}
          <Section title="Presenting Symptoms">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>All patients — top conditions</div>
                <div style={{ fontSize: 11, color: "#333", marginBottom: 14 }}>From questionnaire at registration</div>
                {mergedSymptoms.map(([sym, cnt]) => (
                  <HBar key={sym} label={sym} val={cnt} max={maxSymptom} color={BLUE} />
                ))}
                {mergedSymptoms.length === 0 && <div style={{ color: "#444", fontSize: 12 }}>No symptom data</div>}
              </div>
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>No-show patients — top conditions</div>
                <div style={{ fontSize: 11, color: "#333", marginBottom: 14 }}>Patients who booked but didn't attend</div>
                {mergedNoShow.map(([sym, cnt]) => (
                  <HBar key={sym} label={sym} val={cnt} max={maxNoShow} color={RED} />
                ))}
                {mergedNoShow.length === 0 && (
                  <div style={{ color: "#444", fontSize: 12 }}>
                    No symptom–no-show link found. This may mean questionnaire patientIDs differ from consultation patientIDs.
                  </div>
                )}
              </div>
            </div>

            {/* Insight callout */}
            <div style={{ marginTop: 16, background: "#0f1520", border: "1px solid #1d3a5e", borderRadius: 8, padding: "16px 20px" }}>
              <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 600, marginBottom: 6 }}>Conversion insight</div>
              <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
                Anxiety, Insomnia, and Chronic Pain dominate registrations. Patients citing <em>anxiety + insomnia</em> combined are the highest-volume cohort — 
                targeted pre-consult reminders and mental health intake content could directly reduce the <strong style={{ color: RED }}>{fmt(p.no_show)}</strong> no-show rate 
                ({pct(p.no_show, p.booked_consult)}% of bookings lost).
              </div>
            </div>
          </Section>

          {/* ── Section 6: Demographics ── */}
          <Section title="Patient Demographics">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {/* Age groups */}
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Age groups</div>
                {data.ageGroups.map((r, i) => {
                  const s = r.showed_up ?? 0, n = r.no_show ?? 0, pend = r.cnt - s - n;
                  const sPct = r.cnt ? Math.round(s / r.cnt * 100) : 0;
                  const nPct = r.cnt ? Math.round(n / r.cnt * 100) : 0;
                  const pPct = 100 - sPct - nPct;
                  return (
                    <div key={r.age_group} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: "#bbb" }}>{r.age_group}</span>
                        <span style={{ color: PALETTE[i % PALETTE.length], fontWeight: 600 }}>{fmt(r.cnt)} · {pct(r.cnt, p.total_patients)}%</span>
                      </div>
                      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1a1a1a" }}>
                        <div style={{ width: `${sPct}%`, background: GREEN, transition: "width 0.4s" }} />
                        <div style={{ width: `${nPct}%`, background: RED,   transition: "width 0.4s" }} />
                        <div style={{ flex: 1, background: "#2a2a2a" }} />
                      </div>
                      <div style={{ display: "flex", gap: 10, fontSize: 10, marginTop: 3 }}>
                        <span style={{ color: GREEN }}>{s} showed ({sPct}%)</span>
                        <span style={{ color: RED   }}>{n} no-show ({nPct}%)</span>
                        <span style={{ color: AMBER }}>{pend} pending ({pPct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Gender */}
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Gender at birth</div>
                {(() => {
                  const gTotal = data.genders.reduce((s, x) => s + x.cnt, 0);
                  return data.genders.map((r, i) => {
                    const s = r.showed_up ?? 0, n = r.no_show ?? 0, pend = r.cnt - s - n;
                    const sPct = r.cnt ? Math.round(s / r.cnt * 100) : 0;
                    const nPct = r.cnt ? Math.round(n / r.cnt * 100) : 0;
                    const pPct = 100 - sPct - nPct;
                    return (
                      <div key={r.gender} style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: "#bbb" }}>{r.gender}</span>
                          <span style={{ color: PALETTE[i % PALETTE.length], fontWeight: 600 }}>{fmt(r.cnt)} · {pct(r.cnt, gTotal)}%</span>
                        </div>
                        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1a1a1a" }}>
                          <div style={{ width: `${sPct}%`, background: GREEN, transition: "width 0.4s" }} />
                          <div style={{ width: `${nPct}%`, background: RED,   transition: "width 0.4s" }} />
                          <div style={{ flex: 1, background: "#2a2a2a" }} />
                        </div>
                        <div style={{ display: "flex", gap: 10, fontSize: 10, marginTop: 3 }}>
                          <span style={{ color: GREEN }}>{s} showed ({sPct}%)</span>
                          <span style={{ color: RED   }}>{n} no-show ({nPct}%)</span>
                          <span style={{ color: AMBER }}>{pend} pending ({pPct}%)</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* States */}
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>State / territory</div>
                {data.states.map((r) => {
                  const s = r.showed_up ?? 0, n = r.no_show ?? 0, pend = r.cnt - s - n;
                  const sPct = r.cnt ? Math.round(s / r.cnt * 100) : 0;
                  const nPct = r.cnt ? Math.round(n / r.cnt * 100) : 0;
                  const pPct = 100 - sPct - nPct;
                  return (
                    <div key={r.state} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: "#bbb" }}>{r.state}</span>
                        <span style={{ color: "#6366f1", fontWeight: 600 }}>{fmt(r.cnt)} · {pct(r.cnt, p.total_patients)}%</span>
                      </div>
                      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "#1a1a1a" }}>
                        <div style={{ width: `${sPct}%`, background: GREEN, transition: "width 0.4s" }} />
                        <div style={{ width: `${nPct}%`, background: RED,   transition: "width 0.4s" }} />
                        <div style={{ flex: 1, background: "#2a2a2a" }} />
                      </div>
                      <div style={{ display: "flex", gap: 10, fontSize: 10, marginTop: 3 }}>
                        <span style={{ color: GREEN }}>{s} showed ({sPct}%)</span>
                        <span style={{ color: RED   }}>{n} no-show ({nPct}%)</span>
                        <span style={{ color: AMBER }}>{pend} pending ({pPct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Section>

          {/* ── Section 7: Conversion opportunities ── */}
          <Section title="Conversion Opportunities">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              <OpCard
                color={RED}
                title={`${fmt(p.no_show)} no-shows`}
                body={`${pct(p.no_show, p.booked_consult)}% of all bookings are no-shows. Re-engagement SMS/email sequences before appointments could recover a significant share of these — each conversion is a potential TP.`}
              />
              <OpCard
                color={AMBER}
                title={`${fmt(p.pre_consult)} pending consults`}
                body={`Patients with a booked upcoming consultation. Ensuring confirmations, waitlist management and pre-consult questionnaires are sent is critical to converting this cohort.`}
              />
              <OpCard
                color={BLUE}
                title={`${fmt(p.total_patients - p.booked_consult)} never booked`}
                body={`${pct(p.total_patients - p.booked_consult, p.total_patients)}% of registered patients never booked a consultation. Abandoned-funnel emails targeting the top symptoms (Anxiety, Insomnia) could re-activate them.`}
              />
              <OpCard
                color={GREEN}
                title={`${pct(tpApprove, tpTotal)}% TP approval rate`}
                body={`Of ${fmt(tpTotal)} treatment plans written, ${fmt(tpApprove)} were approved. The ${pct(tpReject, tpTotal)}% rejection rate (${fmt(tpReject)} patients) may benefit from better pre-screening to improve doctor time efficiency.`}
              />
              <OpCard
                color={PURPLE}
                title={`${fmt(p.app_pending)} pending applications`}
                body={`These patients are in-flight. Fast-tracking clinical review for pending applications — especially for the anxiety/insomnia cohort — directly impacts activation velocity.`}
              />
            </div>
          </Section>

          <div style={{ fontSize: 11, color: "#333", textAlign: "right" }}>
            Live from doc-app RDS · fetched {new Date(data.fetchedAt).toLocaleTimeString()}
          </div>

          {/* ── Questionnaire sections ── */}
          {qLoad && <div style={{ textAlign: "center", padding: "40px 0", color: "#555", fontSize: 13 }}>Loading questionnaire data…</div>}
          {qErr  && <div style={{ textAlign: "center", padding: "20px 0", color: "#ef4444", fontSize: 13 }}>Questionnaire error: {qErr}</div>}
          {qData && (() => {
            const t = qData.timingBuckets;
            const fmtDur = (h: number | string) => { const n = parseFloat(String(h)); return n < 1 ? `${Math.round(n * 60)} min` : n < 24 ? `${n.toFixed(1)} hrs` : `${(n / 24).toFixed(1)} days`; };
            const qPct = (n: number, d: number) => d ? Math.round(n / d * 100) : 0;

            const QUESTIONNAIRE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8];
            const BOOKING_STEPS       = [9, 10];
            const qDropoff   = qData.stepDropoff.filter((r) => QUESTIONNAIRE_STEPS.includes(r.step));
            const bDropoff   = qData.stepDropoff.filter((r) => BOOKING_STEPS.includes(r.step));
            const qReach     = qData.stepReach.filter((r) => QUESTIONNAIRE_STEPS.includes(r.step));
            const maxDropoff = Math.max(...qDropoff.map((r) => r.sessions ?? 0), 1);
            const firstStepUsers = qReach[0]?.users ?? 1;

            const STAGE_ORDER: Record<string, { label: string; color: string; order: number }> = {
              none:          { label: "Not started",   color: "#333",   order: 0 },
              registration:  { label: "Registration",  color: "#555",   order: 1 },
              questionnaire: { label: "Questionnaire", color: BLUE,     order: 2 },
              consent:       { label: "Consent",       color: AMBER,    order: 3 },
              booking:       { label: "Booking",       color: GREEN,    order: 4 },
              discharge:     { label: "Discharge",     color: PURPLE,   order: 5 },
            };
            const stageRows = qData.lastCompletedForm
              .map((r) => ({ ...r, ...(STAGE_ORDER[r.stage] ?? { label: r.stage, color: "#444", order: 99 }) }))
              .sort((a, b) => a.order - b.order);
            const totalStage = stageRows.reduce((s, r) => s + r.cnt, 0);

            return (
              <>
                {/* ── Section 8: Registration → Completion Timing ── */}
                <Section title="Questionnaire — Registration → Completion Time">
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 1, background: "#1a1a1a", borderRadius: 8, overflow: "hidden", marginBottom: 24 }}>
                    {[
                      { label: "Patients analysed",  val: qData.regToCompletion.patients.toLocaleString(), color: "#fff",  sub: "reg + questionnaire" },
                      { label: "Median time",         val: fmtDur(qData.regToCompletion.median_hours),       color: GREEN,  sub: "50% complete this fast" },
                      { label: "Average time",        val: fmtDur(qData.regToCompletion.avg_hours),          color: AMBER,  sub: "skewed by returners" },
                      { label: "Same session (≤30m)",  val: t.within_30min.toLocaleString(),                  color: GREEN,  sub: `${qPct(t.within_30min, t.total)}% of total` },
                      { label: "Same day (30m–24h)",  val: (t.h1_to_2h + t.h2_to_24h).toLocaleString(),      color: BLUE,   sub: `${qPct(t.h1_to_2h + t.h2_to_24h, t.total)}%` },
                      { label: "Came back (>24h)",    val: t.over_24h.toLocaleString(),                       color: AMBER,  sub: `${qPct(t.over_24h, t.total)}%` },
                    ].map(({ label, val, color, sub }) => (
                      <div key={label} style={{ background: "#0f0f0f", padding: "16px 20px" }}>
                        <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                        <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{val}</div>
                        <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                    <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Time from registration to questionnaire completion</div>
                    {([
                      { label: "Within 30 minutes",  val: t.within_30min,          color: GREEN },
                      { label: "30 min – 2 hours",   val: t.h1_to_2h,              color: "#22d3ee" },
                      { label: "2 hours – 24 hours", val: t.h2_to_24h,             color: BLUE },
                      { label: "Over 24 hours",       val: t.over_24h,              color: AMBER },
                    ] as { label: string; val: number; color: string }[]).map(({ label, val, color }) => (
                      <HBar key={label} label={label} val={val} max={t.total} color={color} sub={`${qPct(val, t.total)}%`} />
                    ))}
                    <div style={{ marginTop: 16, padding: "12px 16px", background: "#0f1520", borderRadius: 6, fontSize: 12, color: "#555", lineHeight: 1.6 }}>
                      <strong style={{ color: GREEN }}>{qPct(t.within_30min, t.total)}%</strong> complete the questionnaire in the same session.
                      The <strong style={{ color: AMBER }}>median is {fmtDur(qData.regToCompletion.median_hours)}</strong> but the mean ({fmtDur(qData.regToCompletion.avg_hours)}) is pulled up by the <strong style={{ color: AMBER }}>{qPct(t.over_24h, t.total)}%</strong> who return after 24+ hours.
                    </div>
                  </div>
                </Section>

                {/* ── Section 9: Step Drop-off ── */}
                <Section title="Questionnaire — Step Drop-off">
                  {period !== "all" && (
                    <div style={{ fontSize: 11, color: BLUE, marginBottom: 12 }}>
                      Period: {period === "custom" ? `${customFrom}${customTo ? ` → ${customTo}` : ""}` : PERIOD_LABELS[period]}
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>Where patients stopped (steps 1–8)</div>
                      <div style={{ fontSize: 11, color: "#333", marginBottom: 16 }}>Sessions whose last action was this step</div>
                      {qDropoff.map((r, i) => {
                        const isHighDrop = (r.sessions ?? 0) > 2000;
                        return (
                          <HBar key={r.step} label={`Step ${r.step} · ${r.label}`}
                            val={r.sessions ?? 0} max={maxDropoff}
                            color={isHighDrop ? RED : PALETTE[i % PALETTE.length]}
                            sub={`${(r.sessions ?? 0).toLocaleString()} stopped`} />
                        );
                      })}
                    </div>
                    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>Users who reached each step</div>
                      <div style={{ fontSize: 11, color: "#333", marginBottom: 16 }}>Unique users who performed any action at this step</div>
                      {qReach.map((r, i) => (
                        <HBar key={r.step} label={`Step ${r.step} · ${r.label}`}
                          val={r.users ?? 0} max={firstStepUsers}
                          color={PALETTE[i % PALETTE.length]}
                          sub={`${qPct(r.users ?? 0, firstStepUsers)}% of starters`} />
                      ))}
                    </div>
                  </div>
                  {/* Step-to-step conversion rates */}
                  {stepConversionRates.length > 0 && (
                    <div style={{ marginTop: 16, background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Step-to-step conversion rate (% of users who reached the next step)</div>
                      <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
                        {stepConversionRates.map((r, i) => (
                          <div key={r.step} style={{ flex: "0 0 auto", minWidth: 100, padding: "12px 14px", borderRight: i < stepConversionRates.length - 1 ? "1px solid #1a1a1a" : "none" }}>
                            <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Step {r.step}</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: i === 0 ? "#888" : r.rate >= 70 ? GREEN : r.rate >= 40 ? AMBER : RED }}>{i === 0 ? "—" : `${r.rate}%`}</div>
                            <div style={{ fontSize: 10, color: "#333", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>{r.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {bDropoff.length > 0 && (
                    <div style={{ marginTop: 16, background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Booking steps (9–10) · after completing the questionnaire</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                        {bDropoff.map((r) => (
                          <div key={r.step} style={{ background: "#0f0f0f", borderRadius: 6, padding: "14px 18px" }}>
                            <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>Step {r.step} · {r.label}</div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: r.step === 10 ? GREEN : AMBER, marginTop: 4 }}>{(r.sessions ?? 0).toLocaleString()}</div>
                            <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>stopped / completed here</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 16, background: "#0f1520", border: "1px solid #1d3a5e", borderRadius: 8, padding: "16px 20px" }}>
                    <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginBottom: 6 }}>Drop-off insight</div>
                    <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
                      {(() => {
                        const s1 = qDropoff.find((r) => r.step === 1);
                        const s6 = qDropoff.find((r) => r.step === 6);
                        const s8 = qDropoff.find((r) => r.step === 8);
                        return <>
                          Largest drop-off: <strong style={{ color: RED }}>Step 1 (Phone Verification)</strong> — <strong style={{ color: RED }}>{(s1?.sessions ?? 0).toLocaleString()}</strong> sessions end here (SMS OTP friction).
                          {s6 && <> <strong style={{ color: RED }}>{(s6.sessions ?? 0).toLocaleString()}</strong> stop at <strong style={{ color: RED }}>Step 6 (Your Health Profile)</strong>.</>}
                          {s8 && <> <strong style={{ color: AMBER }}>{(s8.sessions ?? 0).toLocaleString()}</strong> reach <strong style={{ color: AMBER }}>Step 8</strong> but don&apos;t pick a slot.</>}
                        </>;
                      })()}
                    </div>
                  </div>
                </Section>

                {/* ── Section 10: Patient Journey Stage ── */}
                <Section title="Patient Journey Stage (current state)">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 8, padding: "20px 24px" }}>
                      <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>Where each patient last got to (lastCompletedForm)</div>
                      {stageRows.map((r) => (
                        <HBar key={r.stage} label={r.label} val={r.cnt} max={totalStage} color={r.color} sub={`${qPct(r.cnt, totalStage)}% · ${r.cnt.toLocaleString()}`} />
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#1a1a1a", borderRadius: 8, overflow: "hidden", alignContent: "start" }}>
                      {stageRows.map((r) => (
                        <div key={r.stage} style={{ background: "#0f0f0f", padding: "14px 18px" }}>
                          <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.5px" }}>{r.label}</div>
                          <div style={{ fontSize: 22, fontWeight: 700, color: r.color, marginTop: 4 }}>{r.cnt.toLocaleString()}</div>
                          <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{qPct(r.cnt, totalStage)}% of all</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginTop: 16, background: "#0f1520", border: "1px solid #1d3a5e", borderRadius: 8, padding: "16px 20px" }}>
                    <div style={{ fontSize: 12, color: BLUE, fontWeight: 600, marginBottom: 6 }}>Journey insight</div>
                    <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>
                      {(() => {
                        const reg  = stageRows.find((r) => r.stage === "registration");
                        const none = stageRows.find((r) => r.stage === "none");
                        const book = stageRows.find((r) => r.stage === "booking");
                        const stuck = (reg?.cnt ?? 0) + (none?.cnt ?? 0);
                        return <>
                          <strong style={{ color: RED }}>{stuck.toLocaleString()}</strong> patients ({qPct(stuck, totalStage)}%) are stuck at or before registration — prime candidates for re-engagement.
                          {" "}<strong style={{ color: GREEN }}>{(book?.cnt ?? 0).toLocaleString()}</strong> ({qPct(book?.cnt ?? 0, totalStage)}%) made it all the way to booking.
                        </>;
                      })()}
                    </div>
                  </div>
                </Section>
              </>
            );
          })()}

          {/* ── Section 11: AI Conversion Insights ── */}
          {(data || qData) && (
            <Section title="AI Conversion Insights — What to do next">
              {/* Generate button */}
              {!aiData && !aiLoad && (
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <div style={{ fontSize: 13, color: "#555", marginBottom: 16 }}>
                    Uses GPT-4o-mini to analyse the full funnel and questionnaire data above, then returns prioritised, actionable recommendations.
                  </div>
                  <button
                    onClick={generateInsights}
                    disabled={!data || !qData}
                    style={{ background: "#6366f1", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600, padding: "12px 28px", cursor: "pointer", letterSpacing: "0.2px" }}
                  >
                    ✦ Generate AI Insights
                  </button>
                </div>
              )}

              {/* Loading */}
              {aiLoad && (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#6366f1", fontSize: 13 }}>
                  <div style={{ marginBottom: 8, fontSize: 22 }}>✦</div>
                  Analysing {(data?.pipeline.total_patients ?? 0).toLocaleString()} patients across the full funnel…
                </div>
              )}

              {/* Error */}
              {aiErr && <div style={{ padding: "16px 20px", background: "#1f0f0f", border: "1px solid #3d1f1f", borderRadius: 8, color: "#f87171", fontSize: 13 }}>Error: {aiErr}</div>}

              {/* Results */}
              {aiData && (
                <div>
                  {/* Summary */}
                  <div style={{ background: "#0d1520", border: "1px solid #1d3a5e", borderRadius: 8, padding: "20px 24px", marginBottom: 24 }}>
                    <div style={{ fontSize: 11, color: BLUE, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 10 }}>Executive Summary</div>
                    <div style={{ fontSize: 14, color: "#aaa", lineHeight: 1.7 }}>{aiData.summary}</div>
                  </div>

                  {/* Recommendation cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12, marginBottom: 20 }}>
                    {aiData.recommendations?.map((rec) => {
                      const impactColor = rec.impact === "high" ? GREEN : rec.impact === "medium" ? AMBER : "#555";
                      const effortColor = rec.effort === "high" ? RED : rec.effort === "medium" ? AMBER : GREEN;
                      const borderColor = rec.priority <= 2 ? "#6366f1" : rec.priority <= 4 ? BLUE : "#1e1e1e";
                      return (
                        <div key={rec.priority} style={{ background: "#111", border: `1px solid ${borderColor}`, borderTop: `3px solid ${borderColor}`, borderRadius: 8, padding: "18px 20px", position: "relative" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                            <div style={{ background: "#1a1a2e", border: "1px solid #2d2d5e", borderRadius: 6, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#818cf8", flexShrink: 0 }}>
                              {rec.priority}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#e8e8e8", lineHeight: 1.4 }}>{rec.title}</div>
                          </div>
                          <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 14 }}>{rec.description}</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: `${impactColor}18`, color: impactColor, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              ↑ {rec.impact} impact
                            </span>
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: `${effortColor}18`, color: effortColor, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                              {rec.effort} effort
                            </span>
                            <span style={{ marginLeft: "auto", fontSize: 10, color: "#444", fontStyle: "italic" }}>{rec.metric}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Regenerate + timestamp */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <button
                      onClick={generateInsights}
                      disabled={aiLoad}
                      style={{ background: "transparent", border: "1px solid #2a2a2a", borderRadius: 6, color: "#555", fontSize: 12, padding: "6px 14px", cursor: "pointer" }}
                    >
                      ↺ Regenerate
                    </button>
                    <div style={{ fontSize: 11, color: "#333" }}>
                      Generated {new Date(aiData.generatedAt).toLocaleTimeString()} · GPT-4o-mini
                    </div>
                  </div>
                </div>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function OpCard({ color, title, body }: { color: string; title: string; body: string }) {
  return (
    <div style={{ background: "#111", border: `1px solid ${color}22`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: "16px 20px" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function Msg({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return (
    <div style={{ textAlign: "center", padding: "100px 0", color: isError ? "#ef4444" : "#555", fontSize: 14 }}>
      {children}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const navLink:  React.CSSProperties = { fontSize: 12, color: "#555", textDecoration: "none", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap" };
const ghostBtn: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", fontSize: 12, padding: "7px 14px", cursor: "pointer" };

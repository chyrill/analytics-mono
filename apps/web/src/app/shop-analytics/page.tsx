"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Kpis {
  revenue_this_month: string;
  revenue_prev_month: string;
  revenue_change_pct: number | null;
  conversion_this: number;
  conversion_prev: number;
  conversion_change_pp: number | null;
  active_buyers_30d: number;
  new_buyers_this_month: number;
  lapsed_60d: number;
  never_purchased: number;
  avg_order_value: string;
  avg_order_value_prev: string;
  orders_this_month: number;
}

interface MonthRevRow { month: string; revenue: string; orders: number; avg_order_value: string; grams_dispatched: string; }
interface MonthConvRow { month: string; visits: number; purchases: number; conversion_rate: string; }
interface SaleorGramsRow { month: string; grams: number; }
interface LapsedRow { email: string; plan_g: number; last_order: string | null; days_since_order: number | null; }
interface Insight { type: "positive" | "neutral" | "warning" | "alert"; text: string; }

interface ShopData {
  kpis: Kpis;
  revenueByMonth: MonthRevRow[];
  conversionByMonth: MonthConvRow[];
  saleorGramsByMonth: SaleorGramsRow[];
  lapsedPatients: LapsedRow[];
  insights: Insight[];
}

// ── Chart.js declaration ──────────────────────────────────────────────────────
declare const Chart: {
  new (ctx: CanvasRenderingContext2D, config: Record<string, unknown>): { destroy(): void };
};

const CHART_OPTS = {
  plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1a1a1a", borderColor: "#333", borderWidth: 1, titleColor: "#aaa", bodyColor: "#fff", padding: 10 } },
  scales: {
    x: { grid: { color: "#1a1a1a" }, ticks: { color: "#555", font: { size: 11 } } },
    y: { grid: { color: "#1a1a1a" }, ticks: { color: "#555", font: { size: 11 } } },
  },
  animation: { duration: 400 },
  responsive: true,
  maintainAspectRatio: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function Delta({ val, suffix = "%", inverse = false }: { val: number | null; suffix?: string; inverse?: boolean }) {
  if (val == null) return <div style={{ fontSize: 12, color: "#666" }}>—</div>;
  const up = val > 0;
  const color = up ? (inverse ? "#f87171" : "#4ade80") : val < 0 ? (inverse ? "#4ade80" : "#f87171") : "#666";
  return <div style={{ fontSize: 12, color, fontWeight: 500 }}>{val > 0 ? "+" : ""}{val}{suffix} vs last month</div>;
}

const INSIGHT_STYLE: Record<string, React.CSSProperties> = {
  positive: { background: "#0d1f0f", borderColor: "#1a3d1f", color: "#86efac" },
  neutral:  { background: "#141414", borderColor: "#222",    color: "#aaa" },
  warning:  { background: "#1f1800", borderColor: "#3d2e00", color: "#fde68a" },
  alert:    { background: "#1f0d0d", borderColor: "#3d1a1a", color: "#fca5a5" },
};
const INSIGHT_ICON: Record<string, string> = { positive: "✓", neutral: "→", warning: "⚠", alert: "✕" };

// ── Charts component ───────────────────────────────────────────────────────────
function ShopCharts({ data }: { data: ShopData }) {
  const revRef  = useRef<HTMLCanvasElement>(null);
  const convRef = useRef<HTMLCanvasElement>(null);
  const grmRef  = useRef<HTMLCanvasElement>(null);
  const ordRef  = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (typeof Chart === "undefined") return;
    const charts: { destroy(): void }[] = [];
    const last = (arr: unknown[], i = arr.length - 1) => i;

    if (revRef.current) {
      const ctx = revRef.current.getContext("2d");
      if (ctx) charts.push(new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.revenueByMonth.map((r) => r.month),
          datasets: [{ data: data.revenueByMonth.map((r) => parseFloat(r.revenue)), backgroundColor: data.revenueByMonth.map((_, i) => i === last(data.revenueByMonth) ? "#818cf8" : "#2d2d4a"), borderRadius: 4 }],
        },
        options: { ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, ticks: { ...CHART_OPTS.scales.y.ticks, callback: (v: unknown) => "$" + (Number(v) >= 1000 ? (Number(v) / 1000).toFixed(0) + "k" : v) } } } },
      }));
    }

    if (convRef.current) {
      const ctx = convRef.current.getContext("2d");
      if (ctx) charts.push(new Chart(ctx, {
        type: "line",
        data: {
          labels: data.conversionByMonth.map((r) => r.month),
          datasets: [{ data: data.conversionByMonth.map((r) => parseFloat(r.conversion_rate)), borderColor: "#34d399", backgroundColor: "rgba(52,211,153,0.08)", fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#34d399" }],
        },
        options: { ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, ticks: { ...CHART_OPTS.scales.y.ticks, callback: (v: unknown) => `${v}%` } } } },
      }));
    }

    if (grmRef.current) {
      const ctx = grmRef.current.getContext("2d");
      if (ctx) charts.push(new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.saleorGramsByMonth.map((r) => r.month),
          datasets: [{ data: data.saleorGramsByMonth.map((r) => r.grams), backgroundColor: data.saleorGramsByMonth.map((_, i) => i === last(data.saleorGramsByMonth) ? "#a78bfa" : "#2e2040"), borderRadius: 4 }],
        },
        options: { ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, ticks: { ...CHART_OPTS.scales.y.ticks, callback: (v: unknown) => `${v}g` } } } },
      }));
    }

    if (ordRef.current) {
      const ctx = ordRef.current.getContext("2d");
      if (ctx) charts.push(new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.revenueByMonth.map((r) => r.month),
          datasets: [{ data: data.revenueByMonth.map((r) => r.orders), backgroundColor: data.revenueByMonth.map((_, i) => i === last(data.revenueByMonth) ? "#38bdf8" : "#1a2d3d"), borderRadius: 4 }],
        },
        options: CHART_OPTS,
      }));
    }

    return () => charts.forEach((c) => c.destroy());
  }, [data]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, flexWrap: "wrap" }}>
      {([
        ["Monthly Revenue (AUD)", revRef],
        ["Conversion Rate (%)",   convRef],
        ["Grams Dispensed — Saleor (g)", grmRef],
        ["Orders Dispatched",     ordRef],
      ] as [string, React.RefObject<HTMLCanvasElement>][]).map(([title, ref]) => (
        <div key={title} style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 8, padding: 20 }}>
          <div style={{ fontSize: 12, color: "#555", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 16 }}>{title}</div>
          <div style={{ position: "relative", height: 200 }}><canvas ref={ref} /></div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ShopAnalyticsPage() {
  const [data, setData]       = useState<ShopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  function load() {
    setLoading(true); setError(null);
    fetch(`${API_BASE}/shop-analytics`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ShopData>; })
      .then((d) => { if ((d as { error?: string }).error) throw new Error((d as unknown as { error: string }).error); setData(d); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const k = data?.kpis;

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* ── Header ── */}
      <header style={{ padding: "24px 32px 16px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#fff", letterSpacing: "-0.3px", margin: 0 }}>Shop Analytics</h1>
          <p style={{ fontSize: 13, color: "#666", marginTop: 4 }}>Revenue, conversion, fulfilment &amp; patient retention — last 6 months</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={load} disabled={loading} style={ghostBtn}>⟳ Refresh</button>
        </div>
      </header>

      {loading && <div style={{ textAlign: "center", padding: "80px 0", color: "#555", fontSize: 14 }}>Loading…</div>}
      {error   && <div style={{ textAlign: "center", padding: "80px 0", color: "#ef4444", fontSize: 14 }}>{error}</div>}

      {k && data && (
        <>
          {/* ── KPI grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1, background: "#1a1a1a", borderBottom: "1px solid #1a1a1a" }}>
            {[
              { label: "Revenue this month",    val: `$${Number(k.revenue_this_month).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`, delta: <Delta val={k.revenue_change_pct} /> },
              { label: "Conversion rate",       val: `${k.conversion_this}%`, delta: <Delta val={k.conversion_change_pp} suffix="pp" /> },
              { label: "Active buyers (30d)",   val: String(k.active_buyers_30d), delta: <div style={{ fontSize: 12, color: "#666" }}>unique patients</div> },
              { label: "New buyers this month", val: String(k.new_buyers_this_month), delta: <div style={{ fontSize: 12, color: "#666" }}>first order ever</div> },
              { label: "Lapsed (60d+)",         val: String(k.lapsed_60d), delta: <div style={{ fontSize: 12, color: "#666" }}>w/ treatment plan</div> },
              { label: "Never purchased",       val: String(k.never_purchased), delta: <div style={{ fontSize: 12, color: "#666" }}>have plan, no orders</div> },
              { label: "Avg order value",       val: `$${Number(k.avg_order_value).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`, delta: null },
              { label: "Orders this month",     val: String(k.orders_this_month), delta: <div style={{ fontSize: 12, color: "#666" }}>dispatched</div> },
            ].map(({ label, val, delta }) => (
              <div key={label} style={{ background: "#0f0f0f", padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "#fff", marginTop: 6, letterSpacing: "-0.5px" }}>{val}</div>
                {delta}
              </div>
            ))}
          </div>

          {/* ── Trend charts ── */}
          <div style={{ padding: "28px 32px", borderBottom: "1px solid #1a1a1a" }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", color: "#555", marginBottom: 20 }}>
              Trends — last 6 months
            </div>
            <ShopCharts data={data} />
          </div>

          {/* ── Lapsed patients ── */}
          <div style={{ padding: "28px 32px", borderBottom: "1px solid #1a1a1a" }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", color: "#555", marginBottom: 16 }}>
              Lapsed Patients — treatment plan on file, no order in 60+ days
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Email", "Plan size", "Last order", "Days since order"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "#555", borderBottom: "1px solid #222" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.lapsedPatients.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 12, color: "#555" }}>No lapsed patients found.</td></tr>
                  )}
                  {data.lapsedPatients.slice(0, 100).map((r) => {
                    const days = r.days_since_order;
                    const daysColor = days == null ? "#f87171" : days > 90 ? "#f87171" : days > 60 ? "#fbbf24" : "#4ade80";
                    const daysText = days == null ? "Never ordered" : `${days} days ago`;
                    const lastOrder = r.last_order
                      ? new Date(r.last_order).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" })
                      : "—";
                    return (
                      <tr key={r.email} style={{ borderBottom: "1px solid #1a1a1a" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#141414")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                        <td style={{ padding: "9px 12px", color: "#666", fontSize: 12 }}>{r.email}</td>
                        <td style={{ padding: "9px 12px", color: "#aaa" }}>{r.plan_g}g</td>
                        <td style={{ padding: "9px 12px", color: "#aaa" }}>{lastOrder}</td>
                        <td style={{ padding: "9px 12px", color: daysColor, fontWeight: days != null && days > 90 ? 600 : 400 }}>{daysText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Insights ── */}
          <div style={{ padding: "28px 32px 48px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", color: "#555", marginBottom: 16 }}>
              Shop Health Interpretation
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#1a1a2e", border: "1px solid #2d2d5e", borderRadius: 20, padding: "4px 12px", fontSize: 11, color: "#818cf8", fontWeight: 500, marginBottom: 20 }}>
              ◆ Rule-based analysis
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.insights.map((ins, i) => (
                <div key={i} style={{ display: "flex", gap: 14, padding: "14px 18px", borderRadius: 8, border: "1px solid", fontSize: 13, lineHeight: 1.6, ...INSIGHT_STYLE[ins.type] }}>
                  <span style={{ flexShrink: 0, fontSize: 16 }}>{INSIGHT_ICON[ins.type] ?? "→"}</span>
                  <span>{ins.text}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const navLink: React.CSSProperties = { fontSize: 12, color: "#555", textDecoration: "none", border: "1px solid #2a2a2a", borderRadius: 6, padding: "6px 12px", whiteSpace: "nowrap" };
const ghostBtn: React.CSSProperties = { background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 6, color: "#aaa", fontSize: 12, padding: "7px 14px", cursor: "pointer" };

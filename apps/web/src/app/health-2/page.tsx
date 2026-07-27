"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// ── Types (mirrors apps/api/src/handlers/health2.ts's Health2Row) ──────────────
type LifecycleStage =
    | "approved_not_ordered"
    | "first_order_completed"
    | "awaiting_second_repeat"
    | "second_repeat_completed"
    | "established"
    | "lapsed"
    | "churned";

type HealthColor = "purple" | "green" | "orange" | "red";
type UtilisationTier = "high" | "moderate" | "low" | "minimal" | null;

interface Health2Row {
    email: string;
    patient_name: string | null;
    lifecycle_stage: LifecycleStage;
    lifecycle_label: string;
    health_color: HealthColor;
    watch_flag: boolean;
    utilisation_tier: UtilisationTier;
    adherence_pct: number | null;
    completed_cycles: number;
    fulfilled_order_count: number;
    median_gap_days: number | null;
    last_order_at: string | null;
    expected_next_order_at: string | null;
    days_overdue: number | null;
    reason_codes: string[];
    sample_confidence: "thin" | "adequate";
}

interface Health2Response {
    rows: Health2Row[];
    count: number;
    reasonCodesNotAvailable: string[];
}

// ── Order-history accordion (reuses the same /patient-orders-detail endpoint
// the legacy /health page's drilldown panel uses) ──────────────────────────────
interface PatientOrderDetail {
    email: string;
    orders: {
        order_id: string;
        order_number: number | null;
        ordered_at: string;
        total_grams: number | null;
        lines: { product_name: string | null; strain: string | null; grams: number | null }[];
    }[];
    total_spend: number;
}

// ── Styling helpers ──────────────────────────────────────────────────────────────
const COLOR_HEX: Record<HealthColor, string> = {
    purple: "#a855f7",
    green: "#22c55e",
    orange: "#f59e0b",
    red: "#ef4444",
};

// Utilisation shown as a magnitude scale, not a second traffic light — a
// low-utilisation patient isn't "bad", so it gets a filled-dot scale instead
// of a color that implies judgment.
const UTIL_DOTS: Record<NonNullable<UtilisationTier>, string> = {
    high: "●●●●",
    moderate: "●●●○",
    low: "●●○○",
    minimal: "●○○○",
};

const REASON_LABELS: Record<string, string> = {
    OVERDUE_8_TO_14_DAYS: "8–14d overdue",
    OVERDUE_15_TO_28_DAYS: "15–28+d overdue",
    TWO_CYCLES_MISSED: "2+ cycles missed",
    DECLINING_ORDER_FREQUENCY: "Gaps lengthening",
    DECLINING_PURCHASE_QUANTITY: "Qty down 50%+",
    LOW_UTILISATION_VS_BASELINE: "Low util. vs baseline",
    RECENT_REACTIVATION: "Recently reactivated",
    SECOND_REPEAT_NOT_COMPLETED: "Stalled repeat",
    REPEATS_EXHAUSTED: "Repeats exhausted",
    TREATMENT_PLAN_EXPIRED: "Plan expired",
    UNKNOWN_REASON: "Unknown",
};

type SortKey =
    | "patient_name"
    | "health_color"
    | "lifecycle_label"
    | "utilisation_tier"
    | "adherence_pct"
    | "completed_cycles"
    | "fulfilled_order_count"
    | "median_gap_days"
    | "last_order_at"
    | "days_overdue";

const COLOR_RANK: Record<HealthColor, number> = { red: 0, orange: 1, green: 2, purple: 3 };

function fmtDate(v: string | null): string {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function cmp(a: unknown, b: unknown): number {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b));
}

export default function Health2Page() {
    const [rows, setRows] = useState<Health2Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [colorFilter, setColorFilter] = useState<HealthColor | "all">("all");
    const [stageFilter, setStageFilter] = useState<LifecycleStage | "all">("all");
    const [notAvailable, setNotAvailable] = useState<string[]>([]);
    const [sortKey, setSortKey] = useState<SortKey>("days_overdue");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
    const [orderDetails, setOrderDetails] = useState<
        Record<string, { loading: boolean; error: string | null; data: PatientOrderDetail | null }>
    >({});

    function toggleExpand(email: string) {
        setExpandedEmail((current) => {
            const next = current === email ? null : email;
            if (next && !orderDetails[next]) {
                setOrderDetails((prev) => ({ ...prev, [next]: { loading: true, error: null, data: null } }));
                fetch(`${API_BASE}/patient-orders-detail?email=${encodeURIComponent(next)}`)
                    .then((r) => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.json() as Promise<PatientOrderDetail>;
                    })
                    .then((data) => setOrderDetails((prev) => ({ ...prev, [next]: { loading: false, error: null, data } })))
                    .catch((e: Error) => setOrderDetails((prev) => ({ ...prev, [next]: { loading: false, error: e.message, data: null } })));
            }
            return next;
        });
    }

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetch(`${API_BASE}/health-2`)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json() as Promise<Health2Response>;
            })
            .then((d) => {
                setRows(d.rows ?? []);
                setNotAvailable(d.reasonCodesNotAvailable ?? []);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    const counts = useMemo(() => {
        const c: Record<HealthColor, number> = { red: 0, orange: 0, green: 0, purple: 0 };
        for (const r of rows) c[r.health_color]++;
        return c;
    }, [rows]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = rows.filter((r) => {
            if (colorFilter !== "all" && r.health_color !== colorFilter) return false;
            if (stageFilter !== "all" && r.lifecycle_stage !== stageFilter) return false;
            if (q && !(r.email.toLowerCase().includes(q) || (r.patient_name ?? "").toLowerCase().includes(q))) return false;
            return true;
        });

        return [...list].sort((a, b) => {
            const result = sortKey === "health_color" ? COLOR_RANK[a.health_color] - COLOR_RANK[b.health_color] : cmp(a[sortKey], b[sortKey]);
            return sortDir === "asc" ? result : -result;
        });
    }, [rows, search, colorFilter, stageFilter, sortKey, sortDir]);

    function toggleSort(key: SortKey) {
        if (sortKey === key) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "adherence_pct" || key === "fulfilled_order_count" || key === "completed_cycles" ? "desc" : "asc");
        }
    }

    function thStyle(key: SortKey): CSSProperties {
        return {
            textAlign: "left",
            padding: "8px 10px",
            fontSize: 11,
            fontWeight: 600,
            color: sortKey === key ? "#e8e8e8" : "#888",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            cursor: "pointer",
            whiteSpace: "nowrap",
            userSelect: "none",
        };
    }

    function sortArrow(key: SortKey) {
        if (sortKey !== key) return "";
        return sortDir === "asc" ? " ▲" : " ▼";
    }

    return (
        <div style={{ padding: 24, width: "90vw", maxWidth: "90vw", margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Health Index v2 — Ordering Cadence</h1>
                <span style={{ fontSize: 12, color: "#888" }}>{rows.length} patients</span>
            </div>
            <p style={{ fontSize: 13, color: "#999", marginTop: 4, marginBottom: 16 }}>
                Ranked by how overdue a patient is against their <em>own</em> ordering cadence, not a blanket 28-day
                rule. Utilisation is shown separately as a magnitude — low utilisation is not automatically bad.
            </p>

            <MethodologyDoc />

            {/* Summary chips */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {(["red", "orange", "green", "purple"] as HealthColor[]).map((c) => (
                    <button
                        key={c}
                        onClick={() => setColorFilter(colorFilter === c ? "all" : c)}
                        style={{
                            border: `1px solid ${COLOR_HEX[c]}`,
                            background: colorFilter === c ? COLOR_HEX[c] : "transparent",
                            color: colorFilter === c ? "#111" : COLOR_HEX[c],
                            borderRadius: 999,
                            padding: "4px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            textTransform: "capitalize",
                        }}
                    >
                        {c} · {counts[c]}
                    </button>
                ))}
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <input
                    placeholder="Search name or email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                        flex: "1 1 240px",
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid #333",
                        background: "#1a1a1a",
                        color: "#e8e8e8",
                        fontSize: 13,
                    }}
                />
                <select
                    value={stageFilter}
                    onChange={(e) => setStageFilter(e.target.value as LifecycleStage | "all")}
                    style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #333", background: "#1a1a1a", color: "#e8e8e8", fontSize: 13 }}
                >
                    <option value="all">All lifecycle stages</option>
                    <option value="approved_not_ordered">Approved — not ordered</option>
                    <option value="first_order_completed">First order completed</option>
                    <option value="awaiting_second_repeat">Awaiting second repeat</option>
                    <option value="second_repeat_completed">Second repeat completed</option>
                    <option value="established">Established (3+ cycles)</option>
                    <option value="lapsed">Lapsed (plan expired)</option>
                    <option value="churned">Churned (plan expired 90d+)</option>
                </select>
                <span style={{ fontSize: 12, color: "#888", alignSelf: "center", marginLeft: "auto" }}>{filtered.length} shown</span>
            </div>

            {loading && <div style={{ color: "#999" }}>Loading…</div>}
            {error && <div style={{ color: "#ef4444" }}>Error: {error}</div>}

            {!loading && !error && (
                <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #262626" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: "#181818", borderBottom: "1px solid #262626" }}>
                                <th style={thStyle("patient_name")} onClick={() => toggleSort("patient_name")}>
                                    Patient{sortArrow("patient_name")}
                                </th>
                                <th style={thStyle("health_color")} onClick={() => toggleSort("health_color")}>
                                    Health{sortArrow("health_color")}
                                </th>
                                <th style={thStyle("lifecycle_label")} onClick={() => toggleSort("lifecycle_label")}>
                                    Lifecycle Stage{sortArrow("lifecycle_label")}
                                </th>
                                <th style={thStyle("utilisation_tier")} onClick={() => toggleSort("utilisation_tier")}>
                                    Utilisation{sortArrow("utilisation_tier")}
                                </th>
                                <th style={thStyle("adherence_pct")} onClick={() => toggleSort("adherence_pct")}>
                                    Adherence %{sortArrow("adherence_pct")}
                                </th>
                                <th style={thStyle("completed_cycles")} onClick={() => toggleSort("completed_cycles")}>
                                    Cycles{sortArrow("completed_cycles")}
                                </th>
                                <th style={thStyle("fulfilled_order_count")} onClick={() => toggleSort("fulfilled_order_count")}>
                                    Orders{sortArrow("fulfilled_order_count")}
                                </th>
                                <th style={thStyle("median_gap_days")} onClick={() => toggleSort("median_gap_days")}>
                                    Median Gap (d){sortArrow("median_gap_days")}
                                </th>
                                <th style={thStyle("last_order_at")} onClick={() => toggleSort("last_order_at")}>
                                    Last Order{sortArrow("last_order_at")}
                                </th>
                                <th style={thStyle("days_overdue")} onClick={() => toggleSort("days_overdue")}>
                                    Days Overdue{sortArrow("days_overdue")}
                                </th>
                                <th style={{ ...thStyle("days_overdue"), cursor: "default" }}>Reasons</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((r) => {
                                const isExpanded = expandedEmail === r.email;
                                return (
                                <Fragment key={r.email}>
                                <tr
                                    onClick={() => toggleExpand(r.email)}
                                    style={{
                                        borderBottom: isExpanded ? "none" : "1px solid #1f1f1f",
                                        borderLeft: `3px solid ${COLOR_HEX[r.health_color]}`,
                                        cursor: "pointer",
                                        background: isExpanded ? "#161616" : undefined,
                                    }}
                                >
                                    <td style={{ padding: "8px 10px", maxWidth: 220 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ fontSize: 10, color: "#666", width: 10, display: "inline-block" }}>
                                                {isExpanded ? "▾" : "▸"}
                                            </span>
                                            <div style={{ overflow: "hidden" }}>
                                                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {r.patient_name || "—"}
                                                </div>
                                                <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {r.email}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: COLOR_HEX[r.health_color], textTransform: "uppercase" }}>
                                            {r.health_color}
                                        </span>
                                        {r.watch_flag && <span style={{ marginLeft: 4, fontSize: 10, color: "#aaa" }}>· watch</span>}
                                    </td>
                                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                                        <span style={{ padding: "2px 8px", borderRadius: 999, background: "#262626", fontSize: 11 }}>{r.lifecycle_label}</span>
                                        {r.sample_confidence === "thin" && (
                                            <span style={{ marginLeft: 6, fontSize: 10, color: "#f59e0b" }} title="Fewer than 4 orders / 1 completed cycle — personal cadence not yet reliable">
                                                thin
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }} title={r.adherence_pct != null ? `${r.adherence_pct}% of allowance used` : "No adherence data"}>
                                        {r.utilisation_tier ? (
                                            <>
                                                <span style={{ letterSpacing: 2, color: "#8b8b8b" }}>{UTIL_DOTS[r.utilisation_tier]}</span>{" "}
                                                <span style={{ fontSize: 10, color: "#888" }}>{r.utilisation_tier}</span>
                                            </>
                                        ) : (
                                            <span style={{ color: "#555" }}>—</span>
                                        )}
                                    </td>
                                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.adherence_pct != null ? `${r.adherence_pct}%` : "—"}</td>
                                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.completed_cycles}</td>
                                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.fulfilled_order_count}</td>
                                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{r.median_gap_days ?? "—"}</td>
                                    <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#aaa" }}>{fmtDate(r.last_order_at)}</td>
                                    <td style={{ padding: "8px 10px", textAlign: "right", color: r.days_overdue != null && r.days_overdue > 0 ? "#f59e0b" : "#888" }}>
                                        {r.days_overdue != null && r.days_overdue > 0 ? r.days_overdue : "—"}
                                    </td>
                                    <td style={{ padding: "8px 10px" }}>
                                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                            {r.reason_codes.map((code) => (
                                                <span
                                                    key={code}
                                                    style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#2a1a1a", color: "#e0a0a0", whiteSpace: "nowrap" }}
                                                    title={code}
                                                >
                                                    {REASON_LABELS[code] ?? code}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                                {isExpanded && (
                                    <tr style={{ borderBottom: "1px solid #1f1f1f", borderLeft: `3px solid ${COLOR_HEX[r.health_color]}`, background: "#161616" }}>
                                        <td colSpan={11} style={{ padding: "0 10px 14px 10px" }}>
                                            <OrdersAccordion state={orderDetails[r.email]} />
                                        </td>
                                    </tr>
                                )}
                                </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                    {filtered.length === 0 && <div style={{ color: "#888", padding: 24, textAlign: "center" }}>No patients match these filters.</div>}
                </div>
            )}

            {notAvailable.length > 0 && (
                <p style={{ marginTop: 24, fontSize: 11, color: "#666" }}>
                    Not yet computable from synced data (no source table): {notAvailable.join(", ")}.
                </p>
            )}
        </div>
    );
}

// ── In-page methodology doc: how patients are bucketed + what each flag
// means. Mirrors apps/api/src/handlers/health2.ts's classifyRow() — keep in
// sync if that logic changes. ────────────────────────────────────────────────
const STAGE_DOCS: { stage: LifecycleStage; title: string; body: string }[] = [
    {
        stage: "approved_not_ordered",
        title: "Approved, not ordered",
        body:
            "Patient has an approved treatment plan but hasn't placed a first order yet. Judged on days since approval: " +
            "≤7d Green (New), 8–14d Green + watch, 15–28d Orange (activation risk), 28d+ Red (never activated).",
    },
    {
        stage: "first_order_completed",
        title: "First order completed",
        body: "Placed their first order; fewer than 1 treatment-plan window has elapsed. Always Provisional Green — too early to judge cadence or utilisation.",
    },
    {
        stage: "awaiting_second_repeat",
        title: "Awaiting 2nd repeat",
        body:
            "1 plan window elapsed. One of the most important early churn points — judged on days overdue vs. when their 2nd repeat becomes eligible: " +
            "not overdue → Green, 1–7d → Green watch, 8–28d → Orange, 29d+ → Red.",
    },
    {
        stage: "second_repeat_completed",
        title: "2nd repeat completed",
        body: "2 plan windows elapsed. Same overdue-day thresholds as \"Awaiting 2nd repeat\" — still building tenure before the full CHI applies.",
    },
    {
        stage: "established",
        title: "Established (3+ cycles)",
        body:
            "3+ plan windows elapsed — the full health index applies. Judged on days overdue against the patient's OWN median gap between orders " +
            "(floor 28 days), never on lifetime historical gap counts: not overdue + high adherence (≥75%) → Purple, not overdue → Green, " +
            "1–7d over → Green watch, 8–14d → Orange, 15–28d → Orange, 28d+ → Red, 56d+ → Red (two cycles missed). " +
            "Exception: a patient who just returned from a 56d+ lapse with 2 or fewer orders since is held at Orange " +
            "(\"reactivated, recovery not yet confirmed\") instead of jumping straight to Green/Purple — see RECENT_REACTIVATION below.",
    },
    {
        stage: "lapsed",
        title: "Lapsed",
        body: "Overlay applied on top of any stage above: their Zoho-recorded treatment plan (supply_expiration) has expired less than 90 days ago and they haven't ordered again since. Forced Red.",
    },
    {
        stage: "churned",
        title: "Churned",
        body: "Same as Lapsed but the plan has been expired 90+ days with no renewal or new order. Forced Red.",
    },
];

const FLAG_DOCS: { code: string; body: string }[] = [
    { code: "OVERDUE_8_TO_14_DAYS", body: "Currently 8–14 days past this patient's expected next-order date." },
    { code: "OVERDUE_15_TO_28_DAYS", body: "Currently 15–28+ days past their expected next-order date." },
    { code: "TWO_CYCLES_MISSED", body: "56+ days overdue — roughly two full expected repeat cycles missed with no order since." },
    {
        code: "DECLINING_ORDER_FREQUENCY",
        body: "The gap leading into their current re-engagement streak is 30%+ longer than their overall median gap — gaps are lengthening.",
    },
    { code: "DECLINING_PURCHASE_QUANTITY", body: "Most recent order is 50%+ smaller than the average of their previous 3 orders." },
    {
        code: "LOW_UTILISATION_VS_BASELINE",
        body: "Utilisation sits at 25–50% of their approved allowance AND order frequency/quantity is declining — flags under-use that's also trending down, not just naturally low usage.",
    },
    {
        code: "RECENT_REACTIVATION",
        body: "Patient just returned from a 56+ day lapse with 2 or fewer orders since — cadence isn't proven yet, so held at Orange instead of Green/Purple.",
    },
    { code: "SECOND_REPEAT_NOT_COMPLETED", body: "Still on their 1st or 2nd plan window and running late getting to the next repeat." },
    {
        code: "REPEATS_EXHAUSTED",
        body: "supply_tracking_history shows 0 repeats remaining on their current window AND Zoho shows no currently-valid (unexpired) plan to cover it.",
    },
    {
        code: "TREATMENT_PLAN_EXPIRED",
        body: "Zoho's recorded plan expiry date (supply_expiration) has passed and they haven't placed a newer order since.",
    },
    { code: "UNKNOWN_REASON", body: "Colour is Orange/Red but none of the other reason codes explain why — a gap in the rule set, worth investigating directly." },
];

function MethodologyDoc() {
    const [open, setOpen] = useState(false);
    const sectionTitle: CSSProperties = { fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.4px", margin: "16px 0 8px" };
    const rowTitle: CSSProperties = { fontWeight: 600, fontSize: 12.5, color: "#ddd" };
    const rowBody: CSSProperties = { fontSize: 12, color: "#999", marginTop: 2, lineHeight: 1.5 };

    return (
        <div style={{ border: "1px solid #262626", borderRadius: 8, marginBottom: 16, background: "#131313" }}>
            <button
                onClick={() => setOpen((o) => !o)}
                style={{
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    color: "#ccc",
                    padding: "10px 14px",
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <span style={{ fontSize: 10, color: "#666" }}>{open ? "▾" : "▸"}</span>
                How patients are bucketed &amp; what the flags mean
            </button>
            {open && (
                <div style={{ padding: "0 14px 16px" }}>
                    <p style={{ fontSize: 12, color: "#999", lineHeight: 1.5, margin: 0 }}>
                        Population: patients with an approved treatment plan (<code>db_treatment_plans.outcome ILIKE &apos;approve%&apos;</code>),
                        restricted to real CRM-synced patients. Each patient moves through lifecycle stages based on how many of their own
                        treatment-plan windows have elapsed (<code>completed_cycles</code>), then within a stage the colour is driven mainly by
                        <strong> days overdue against their own median order gap</strong> (min. 28 days), with utilisation and the flags below
                        layered on top — utilisation alone never worsens colour unless it's also declining.
                    </p>

                    <div style={sectionTitle}>Lifecycle stages</div>
                    <div style={{ display: "grid", gap: 10 }}>
                        {STAGE_DOCS.map((s) => (
                            <div key={s.stage}>
                                <div style={rowTitle}>{s.title}</div>
                                <div style={rowBody}>{s.body}</div>
                            </div>
                        ))}
                    </div>

                    <div style={sectionTitle}>Flags (reason codes)</div>
                    <div style={{ display: "grid", gap: 8 }}>
                        {FLAG_DOCS.map((f) => (
                            <div key={f.code}>
                                <div style={rowTitle}>{REASON_LABELS[f.code] ?? f.code} <span style={{ color: "#666", fontWeight: 400, fontSize: 11 }}>({f.code})</span></div>
                                <div style={rowBody}>{f.body}</div>
                            </div>
                        ))}
                    </div>

                    <div style={sectionTitle}>Other indicators</div>
                    <div style={{ display: "grid", gap: 10 }}>
                        <div>
                            <div style={rowTitle}>Utilisation dots (●●○○)</div>
                            <div style={rowBody}>
                                Magnitude scale, not a traffic light — % of their approved allowance actually bought this year. high ≥75%,
                                moderate ≥50%, low ≥25%, minimal &lt;25%. Low utilisation on its own is not penalised.
                            </div>
                        </div>
                        <div>
                            <div style={rowTitle}>&quot;thin&quot; tag</div>
                            <div style={rowBody}>Fewer than 4 total orders or 0 completed cycles — their personal median gap isn't statistically reliable yet.</div>
                        </div>
                        <div>
                            <div style={rowTitle}>Watch flag</div>
                            <div style={rowBody}>A soft heads-up shown when a patient is currently fine but close to crossing into an at-risk threshold.</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Inline order-history accordion shown under a clicked patient row. Fetches
// from the same /patient-orders-detail endpoint the legacy /health page's
// drilldown panel uses — just the saleor_orders slice of it.
function OrdersAccordion({ state }: { state: { loading: boolean; error: string | null; data: PatientOrderDetail | null } | undefined }) {
    const th: CSSProperties = {
        textAlign: "left",
        fontSize: 10,
        color: "#666",
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        padding: "6px 8px",
        borderBottom: "1px solid #262626",
    };
    const td: CSSProperties = { fontSize: 12, color: "#ccc", padding: "6px 8px", borderBottom: "1px solid #1f1f1f" };

    if (!state || state.loading) {
        return <div style={{ padding: "10px 0", color: "#888", fontSize: 12 }}>Loading orders…</div>;
    }
    if (state.error) {
        return <div style={{ padding: "10px 0", color: "#ef4444", fontSize: 12 }}>Error loading orders: {state.error}</div>;
    }
    const orders = state.data?.orders ?? [];
    if (orders.length === 0) {
        return <div style={{ padding: "10px 0", color: "#666", fontSize: 12 }}>No orders on record.</div>;
    }

    return (
        <div style={{ paddingTop: 4 }}>
            <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.4px", margin: "8px 0 6px" }}>
                Saleor orders ({orders.length})
                {state.data && <span style={{ marginLeft: 8, color: "#555" }}>· total spend ${state.data.total_spend.toFixed(2)}</span>}
            </div>
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #262626", borderRadius: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr>
                            <th style={th}>Order date</th>
                            <th style={th}>Grams</th>
                            <th style={th}>Products</th>
                            <th style={th}>Strains</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((o) => {
                            const productLines = o.lines.filter((l) => l.grams != null);
                            const productNames = Array.from(new Set(productLines.map((l) => l.product_name).filter((n): n is string => !!n)));
                            const strainNames = Array.from(new Set(productLines.map((l) => l.strain).filter((s): s is string => !!s)));
                            return (
                            <tr key={o.order_id}>
                                <td style={td}>
                                    {new Date(o.ordered_at).toLocaleDateString("en-AU")}
                                    {o.order_number != null && <span style={{ color: "#555" }}> #{o.order_number}</span>}
                                </td>
                                <td style={td}>{o.total_grams != null ? `${o.total_grams}g` : "—"}</td>
                                <td style={td}>{productNames.length > 0 ? productNames.join(", ") : "—"}</td>
                                <td style={td}>{strainNames.length > 0 ? strainNames.join(", ") : "—"}</td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

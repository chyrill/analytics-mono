import { format, parseISO } from "date-fns";
import { ExternalLink } from "lucide-react";
import type { HistoryRow } from "@/types/shopFunnel";

function Glyph({ value }: { value: boolean }) {
    return value ? (
        <span className="text-green-400 font-bold text-xs select-none">✓</span>
    ) : (
        <span className="text-muted-foreground/30 text-xs select-none">—</span>
    );
}

interface Props {
    email: string;
    rows: HistoryRow[];
    loading: boolean;
}

export function ShopHistoryPanel({ rows, loading }: Props) {
    if (loading) {
        return <div className="px-4 py-3 text-xs text-muted-foreground">Loading visits…</div>;
    }
    if (rows.length === 0) {
        return <div className="px-4 py-3 text-xs text-muted-foreground">No shop visits recorded.</div>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
                <thead>
                    <tr className="border-b border-border/40 bg-muted/40">
                        <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Date</th>
                        <th className="px-2 py-1.5 text-center font-semibold text-muted-foreground whitespace-nowrap">
                            Allowance
                        </th>
                        <th className="px-2 py-1.5 text-center font-semibold text-muted-foreground" title="Viewed a product page">
                            Viewed
                        </th>
                        <th className="px-2 py-1.5 text-center font-semibold text-muted-foreground" title="Added a variant to cart">
                            Carted
                        </th>
                        <th className="px-2 py-1.5 text-center font-semibold text-muted-foreground" title="Converted checkout to order">
                            Ordered
                        </th>
                        <th
                            className="px-2 py-1.5 text-center font-semibold text-muted-foreground"
                            title="Purchase confirmed in orders_to_dispatch"
                        >
                            Purchased
                        </th>
                        <th className="px-2 py-1.5 text-center font-semibold text-muted-foreground">Replay</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                            <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                                {r.date ? format(parseISO(r.date), "MMM d, yyyy") : "—"}
                                {r.loginTime && (
                                    <span className="ml-1.5 text-muted-foreground/60">
                                        {format(parseISO(r.loginTime), "HH:mm")}
                                    </span>
                                )}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                                {r.allowance !== null ? (
                                    <span
                                        className={`font-medium ${r.allowance <= 0
                                                ? "text-zinc-400"
                                                : r.allowance < 15
                                                    ? "text-red-400"
                                                    : r.allowance < 60
                                                        ? "text-amber-400"
                                                        : "text-green-400"
                                            }`}
                                    >
                                        {r.allowance}d
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground/30">—</span>
                                )}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                                <Glyph value={r.viewed_products} />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                                <Glyph value={r.added_to_cart} />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                                <Glyph value={r.placed_order} />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                                <Glyph value={r.purchase_complete} />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                                {r.replayUrl ? (
                                    <a
                                        href={r.replayUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
                                        title="PostHog session replay"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                ) : (
                                    <span className="text-muted-foreground/30">—</span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

import type { Lead, LeadSource } from "@/types/lead";
import { Badge } from "@/components/ui/badge";

const SOURCE_LABELS: Record<LeadSource, string> = {
    meta: "Meta",
    google_ads: "Google",
    organic: "Organic",
    unknown: "Unknown",
};

const SOURCE_VARIANTS: Record<
    LeadSource,
    "info" | "purple" | "success" | "secondary" | "outline"
> = {
    meta: "info",
    google_ads: "success",
    organic: "secondary",
    unknown: "outline",
};

const STAGE_LABELS: Record<Lead["stage"], string> = {
    lead: "Lead",
    booked: "Booked",
    consulted: "Consulted",
    purchased: "Purchased",
};

const STAGE_VARIANTS: Record<
    Lead["stage"],
    "outline" | "warning" | "info" | "success"
> = {
    lead: "outline",
    booked: "warning",
    consulted: "info",
    purchased: "success",
};

export function SourceBadge({ source }: { source: LeadSource }) {
    return <Badge variant={SOURCE_VARIANTS[source]}>{SOURCE_LABELS[source]}</Badge>;
}

export function StageBadge({ stage }: { stage: Lead["stage"] }) {
    return <Badge variant={STAGE_VARIANTS[stage]}>{STAGE_LABELS[stage]}</Badge>;
}

// Ported from leads-tracker/packages/shared/src/types/funnel.ts.
// leads-tracker and analytics-mono are separate repos/workspaces, so these
// types are duplicated here rather than imported cross-repo. Keep in sync
// manually if leads-tracker's shared types change.

import type { LeadSource } from "./lead";

// Shape of a single patient row returned by GET /api/funnel/patients
export interface PatientRow {
    fullName: string;
    email: string;
    createdAt: string;
    source: LeadSource;
    registered: boolean;
    phone_verified: boolean;
    questionnaire_done: boolean;
    // Per-step questionnaire sub-steps (from questionnaire_events table)
    q_about_you: boolean;
    q_health_safety: boolean;
    q_treatment_history: boolean;
    q_health_profile: boolean;
    q_conditions: boolean;
    eligible: boolean;
    pending_review: boolean;
    rejected: boolean;
    booked: boolean;
    furthestStep: string;
    state: string | null;
}

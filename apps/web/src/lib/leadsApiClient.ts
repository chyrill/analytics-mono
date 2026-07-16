import { getToken } from "./auth";

const LEADS_API_BASE =
    process.env.NEXT_PUBLIC_LEADS_API_BASE ?? "http://localhost:3001";

/**
 * Fetch wrapper for leads-tracker's API. Sends the analytics-mono Bearer
 * token instead of a cookie — leads-tracker's API is expected to verify this
 * token via the shared JWT_SECRET (see docs/analytics-lead-tracker.md).
 */
export async function leadsApiFetch(
    path: string,
    init?: RequestInit
): Promise<Response> {
    const token = getToken();
    const res = await fetch(`${LEADS_API_BASE}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });

    if (res.status === 401 && typeof window !== "undefined") {
        // Defer to analytics-mono's own session handling rather than a
        // leads-tracker-specific redirect.
        window.location.href = "/login";
    }

    return res;
}

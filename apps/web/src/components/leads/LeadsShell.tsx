"use client";

/**
 * Wrapper for the ported Lead Tracker section, rendered inside
 * analytics-mono's shared header/nav shell (see src/components/Nav.tsx).
 * The sub-page tab bar was removed — navigation between /leads/* pages now
 * happens via the primary Nav only.
 * Layout/typography intentionally mirrors /health: full-bleed (no max-width
 * container), flat 1px dividers, 32px horizontal padding.
 */
export function LeadsShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="leads-scope bg-background text-foreground min-h-full">
            <div className="px-8 py-6">{children}</div>
        </div>
    );
}

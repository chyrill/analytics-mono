import animate from "tailwindcss-animate";
import type { Config } from "tailwindcss";

/**
 * Scoped Tailwind setup for the ported Lead Tracker section only
 * (src/app/leads, src/components/leads, src/components/ui).
 *
 * The rest of analytics-mono/apps/web uses inline styles / plain CSS —
 * preflight is disabled so Tailwind's base reset never touches those
 * existing pages.
 */
const config: Config = {
    darkMode: ["class"],
    content: [
        "./src/app/leads/**/*.{ts,tsx}",
        "./src/components/leads/**/*.{ts,tsx}",
        "./src/components/ui/**/*.{ts,tsx}",
    ],
    corePlugins: {
        preflight: false,
    },
    theme: {
        extend: {
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            colors: {
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
            },
        },
    },
    plugins: [animate],
};

export default config;

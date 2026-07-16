/**
 * Seed script — run once after migration to populate reference data
 * and create the initial superadmin user.
 *
 * Usage: npx tsx --env-file=../../.env src/seed.ts
 */
import bcrypt from "bcryptjs";
import { db } from "./index";
import { pages, roles, rolePages, users } from "./index";

async function seed() {
    console.log("Seeding pages...");
    await db
        .insert(pages)
        .values([
            { path: "/", label: "Reconciliation Dashboard", sortOrder: 1 },
            { path: "/funnel-analytics", label: "Funnel Analytics", sortOrder: 2 },
            { path: "/health", label: "Customer Health Index", sortOrder: 3 },
            { path: "/zoho-health", label: "Zoho Health", sortOrder: 4 },
            { path: "/shop-analytics", label: "Shop Analytics", sortOrder: 5 },
            { path: "/patients", label: "Patient Registry", sortOrder: 6 },
            { path: "/leads", label: "Lead Tracker", sortOrder: 7 },
            { path: "/leads/stats", label: "Stats", sortOrder: 8 },
            { path: "/leads/reg-funnel", label: "Reg. Funnel", sortOrder: 9 },
            { path: "/leads/shop-funnel", label: "Shop Funnel", sortOrder: 10 },
            { path: "/leads/leads-to-purchase", label: "Patient Journey", sortOrder: 11 },
            { path: "/leads/campaign-funnel", label: "Campaigns", sortOrder: 12 },
            { path: "/leads/bookings", label: "Bookings", sortOrder: 13 },
        ])
        .onConflictDoNothing();
    console.log("Pages seeded.");

    console.log("Seeding superadmin user...");
    const passwordHash = await bcrypt.hash("P@ssword123", 12);
    await db
        .insert(users)
        .values({
            email: "analytics-superadmin@banksia-health.au",
            passwordHash,
            roleId: null,
            isActive: true,
            isSuperAdmin: true,
            mustChangePassword: false,
        })
        .onConflictDoNothing();
    console.log("Superadmin user seeded.");

    console.log("Seed complete.");
    process.exit(0);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});

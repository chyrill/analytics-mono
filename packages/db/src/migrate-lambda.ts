import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "path";
import bcrypt from "bcryptjs";
import { pages, roles, rolePages, users } from "./index";

/**
 * Lambda handler that runs Drizzle migrations then seeds reference data
 * against the analytics RDS instance.
 *
 * Invoked by the CI/CD pipeline after every production deploy.
 * Must be inside the VPC to reach the RDS instance.
 *
 * The migrations/ folder is bundled alongside this file in the Lambda zip.
 * Seed operations use onConflictDoNothing — safe to run on every deploy.
 */
export const handler = async (): Promise<{ statusCode: number; body: string }> => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL environment variable is not set");
    }

    const ssl = connectionString.includes("amazonaws.com")
        ? { rejectUnauthorized: false }
        : false;

    const client = postgres(connectionString, { max: 1, ssl });
    const db = drizzle(client);

    try {
        console.log("[migrate] Starting migrations...");
        await migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });
        console.log("[migrate] All migrations applied successfully");

        console.log("[seed] Seeding pages...");
        await db
            .insert(pages)
            .values([
                { path: "/", label: "Reconciliation Dashboard", sortOrder: 1 },
                { path: "/funnel-analytics", label: "Funnel Analytics", sortOrder: 2 },
                { path: "/health", label: "Customer Health Index", sortOrder: 3 },
                { path: "/zoho-health", label: "Zoho Health", sortOrder: 4 },
                { path: "/shop-analytics", label: "Shop Analytics", sortOrder: 5 },
                { path: "/patients", label: "Patient Registry", sortOrder: 6 },
            ])
            .onConflictDoNothing();

        console.log("[seed] Seeding superadmin user...");
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

        console.log("[seed] Seed complete");

        await client.end();
        return { statusCode: 200, body: "Migrations and seed complete" };
    } catch (error) {
        await client.end();
        console.error("[migrate/seed] Failed:", error);
        throw error;
    }
};

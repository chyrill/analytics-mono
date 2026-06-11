import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "path";

/**
 * Lambda handler that runs Drizzle migrations against the analytics RDS instance.
 *
 * Invoked by the CI/CD pipeline after every production deploy.
 * Must be inside the VPC to reach the RDS instance.
 *
 * The migrations/ folder is bundled alongside this file in the Lambda zip.
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

        // __dirname is /var/task in Lambda; migrations/ is bundled alongside index.js
        await migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });

        await client.end();
        console.log("[migrate] All migrations applied successfully");
        return { statusCode: 200, body: "Migrations complete" };
    } catch (error) {
        await client.end();
        console.error("[migrate] Migration failed:", error);
        throw error;
    }
};

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/**/*.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://analytics:analytics@localhost:5433/analytics",
  },
  verbose: true,
  strict: false,
});

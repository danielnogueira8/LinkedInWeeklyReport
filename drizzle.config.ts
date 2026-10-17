import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Reads DATABASE_URL from .env.local the same way `next dev` does.
loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});

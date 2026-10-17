// Applies pending SQL migrations from ./drizzle. Runs before `next build` on Vercel,
// and skips (instead of failing the build) until a database is connected.
import nextEnv from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());

// Neon's integration also sets DATABASE_URL_UNPOOLED; schema changes should skip PgBouncer.
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("DATABASE_URL is not set, so migrations were skipped. Connect a database, then redeploy.");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString });
try {
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  console.log("Database migrations are up to date.");
} finally {
  await pool.end();
}

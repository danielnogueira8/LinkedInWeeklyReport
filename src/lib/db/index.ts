import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type Database = NodePgDatabase<typeof schema>;

// One pool per server instance (and per hot reload in dev).
const globalForDb = globalThis as unknown as { db?: Database };

function connect(): Database {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Point it at your Neon (or local Postgres) database.");
  }
  const pool = new Pool({ connectionString, max: 5 });
  // Lets Vercel close idle connections before a function instance is suspended.
  attachDatabasePool(pool);
  return drizzle(pool, { schema });
}

export function db(): Database {
  globalForDb.db ??= connect();
  return globalForDb.db;
}

export * from "./schema";

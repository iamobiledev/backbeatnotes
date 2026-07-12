import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Driver-agnostic Drizzle factory.
 *
 * - Neon HTTP driver (default): serverless-friendly, used on Vercel.
 * - node-postgres driver: used automatically for local/loopback Postgres so
 *   the app can run against a plain Postgres in development and CI.
 *
 * Force a driver with DATABASE_DRIVER=pg|neon when needed.
 */
export type Database = ReturnType<typeof createNeonDb>;

function createNeonDb(url: string) {
  const sql = neon(url);
  return drizzleNeon(sql, { schema });
}

export function isLocalPostgresUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    );
  } catch {
    return false;
  }
}

export function shouldUsePgDriver(url: string): boolean {
  const forced = process.env.DATABASE_DRIVER;
  if (forced === "pg") return true;
  if (forced === "neon") return false;
  return isLocalPostgresUrl(url);
}

export function createDatabase(url: string): Database {
  if (shouldUsePgDriver(url)) {
    const pool = new Pool({ connectionString: url });
    // Both drivers expose the same Drizzle query API surface used by the
    // app (select/insert/update/delete/execute/query with `.rows`), so we
    // present the Neon type as the canonical Database type.
    return drizzlePg(pool, { schema }) as unknown as Database;
  }
  return createNeonDb(url);
}

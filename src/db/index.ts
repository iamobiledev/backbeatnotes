import "server-only";
import { getServerEnv } from "@/env/server";
import { createDatabase, type Database } from "./create-db";

/**
 * Drizzle connection helper.
 * - Neon HTTP driver for Neon URLs (Vercel Functions — no persistent sockets).
 * - node-postgres for local/loopback URLs (development & CI).
 */
function createDb() {
  const { DATABASE_URL } = getServerEnv();
  return createDatabase(DATABASE_URL);
}

export type { Database };

const globalForDb = globalThis as unknown as { __docloomDb?: Database };

/**
 * Reuse the client across hot reloads in development.
 * On Vercel each invocation may get a fresh module scope; neon HTTP
 * does not hold persistent sockets, so this is safe.
 */
export function getDb(): Database {
  if (process.env.NODE_ENV === "production") {
    return createDb();
  }
  if (!globalForDb.__docloomDb) {
    globalForDb.__docloomDb = createDb();
  }
  return globalForDb.__docloomDb;
}

export * from "./schema";

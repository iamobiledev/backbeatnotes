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
 * Reuse the Drizzle/Neon factory for the lifetime of a warm runtime and
 * across development hot reloads. Neon HTTP holds no persistent socket, so a
 * shared query client is safe and avoids rebuilding schema/query machinery on
 * every helper call.
 */
export function getDb(): Database {
  if (!globalForDb.__docloomDb) {
    globalForDb.__docloomDb = createDb();
  }
  return globalForDb.__docloomDb;
}

export * from "./schema";

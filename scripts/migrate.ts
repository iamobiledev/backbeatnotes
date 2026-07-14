import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { shouldUsePgDriver } from "../src/db/create-db";

/**
 * Production-safe migration runner.
 * Uses DATABASE_URL_UNPOOLED when set (direct connection recommended for DDL).
 * Local/loopback URLs automatically use the node-postgres driver.
 *
 * Never invoked automatically by Vercel builds — run intentionally:
 *   pnpm db:migrate
 */
async function main() {
  const url =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL or DATABASE_URL_UNPOOLED is required to run migrations",
    );
  }

  console.log("Running migrations…");
  if (shouldUsePgDriver(url)) {
    const pool = new Pool({ connectionString: url });
    const db = drizzlePg(pool);
    await migratePg(db, { migrationsFolder: "./drizzle" });
    await pool.end();
  } else {
    const sql = neon(url);
    const db = drizzleNeon(sql);
    await migrateNeon(db, { migrationsFolder: "./drizzle" });
  }
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

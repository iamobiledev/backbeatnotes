import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getAppUrl } from "@/env/server";
import { resolveEmailDeliveryStatus } from "@/lib/email";

/**
 * Post-deployment health check — does not expose secrets or DB credentials.
 */
export async function GET() {
  const email = resolveEmailDeliveryStatus({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });
  let database: {
    connected: boolean;
    coreSchemaReady: boolean;
    searchSchemaReady: boolean;
    domainAccessSchemaReady: boolean;
    ownershipSchemaReady: boolean;
    error?: "unavailable";
  };
  try {
    const probe = getDb().execute(sql`
      SELECT
        to_regclass('public.documents') IS NOT NULL AS core_documents,
        to_regclass('public.workspace_members') IS NOT NULL AS core_memberships,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'documents'
            AND column_name = 'revision'
        ) AS core_revision,
        to_regclass('public.document_search_blocks') IS NOT NULL AS search_blocks,
        EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'vector'
        ) AS search_vector,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'workspaces'
            AND column_name = 'auto_join_domain'
        ) AS domain_access_column,
        to_regclass('public.workspaces_auto_join_domain_uidx') IS NOT NULL
          AS domain_access_index,
        to_regclass('public.workspace_members_single_owner_uidx') IS NOT NULL
          AS single_owner_index,
        to_regprocedure(
          'public.transfer_workspace_ownership(text,text,text)'
        ) IS NOT NULL AS ownership_transfer_function
    `);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      probe,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("health database timeout")),
          4_000,
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    const row = result.rows[0] as {
      core_documents?: boolean;
      core_memberships?: boolean;
      core_revision?: boolean;
      search_blocks?: boolean;
      search_vector?: boolean;
      domain_access_column?: boolean;
      domain_access_index?: boolean;
      single_owner_index?: boolean;
      ownership_transfer_function?: boolean;
    };
    database = {
      connected: true,
      coreSchemaReady: Boolean(
        row.core_documents && row.core_memberships && row.core_revision,
      ),
      searchSchemaReady: Boolean(row.search_blocks && row.search_vector),
      domainAccessSchemaReady: Boolean(
        row.domain_access_column && row.domain_access_index,
      ),
      ownershipSchemaReady: Boolean(
        row.single_owner_index && row.ownership_transfer_function,
      ),
    };
  } catch {
    database = {
      connected: false,
      coreSchemaReady: false,
      searchSchemaReady: false,
      domainAccessSchemaReady: false,
      ownershipSchemaReady: false,
      error: "unavailable",
    };
  }

  const requiredEnvReady = Boolean(
    process.env.DATABASE_URL &&
      process.env.BETTER_AUTH_SECRET &&
      process.env.NEXT_PUBLIC_APP_URL,
  );
  const ok =
    requiredEnvReady &&
    database.connected &&
    database.coreSchemaReady &&
    database.searchSchemaReady &&
    database.domainAccessSchemaReady &&
    database.ownershipSchemaReady;
  let appUrlHost = "unknown";
  try {
    appUrlHost = new URL(getAppUrl()).host;
  } catch {
    appUrlHost = "invalid";
  }
  const checks = {
    ok,
    service: "backbeat-notes",
    time: new Date().toISOString(),
    status: ok ? "ready" : database.coreSchemaReady ? "degraded" : "unavailable",
    database,
    env: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasAuthSecret: Boolean(process.env.BETTER_AUTH_SECRET),
      hasAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      /** Resolved outbound app host (no path/secrets) — Production should be backbeatnotes.com. */
      appUrlHost,
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      hasResend: Boolean(process.env.RESEND_API_KEY),
      hasEmailFrom: Boolean(process.env.EMAIL_FROM),
      /** "Continue with Google" is shown when true. */
      hasGoogleOAuth: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      ),
      /** "resend" = real delivery; "console-only" = logged, not sent. */
      emailDelivery: email.delivery,
      emailDeliveryMissing: email.missing,
      vercelEnv: process.env.VERCEL_ENV ?? "unknown",
      functionRegion: process.env.VERCEL_REGION ?? "unknown",
      databaseRegion: process.env.NEON_REGION ?? "unknown",
    },
  };

  return NextResponse.json(checks, { status: ok ? 200 : 503 });
}

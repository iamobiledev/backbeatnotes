import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/create-db";

const REQUIRED_INDEXES = [
  "document_search_blocks_doc_block_uidx",
  "documents_active_ws_title_idx",
  "documents_active_ws_updated_idx",
  "documents_active_parent_title_idx",
  "documents_trash_ws_archived_idx",
  "document_activity_coalesce_idx",
  "document_invitations_doc_status_expiry_idx",
  "workspace_invitations_ws_status_created_idx",
] as const;

async function main() {
  const url =
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL or DATABASE_URL_UNPOOLED is required to check schema",
    );
  }

  const db = createDatabase(url);
  const result = await db.execute(sql`
    SELECT
      to_regclass('public.documents')::text AS documents,
      to_regclass('public.workspace_members')::text AS workspace_members,
      to_regclass('public.document_versions')::text AS document_versions,
      to_regclass('public.document_search_blocks')::text AS document_search_blocks,
      to_regclass('drizzle.__drizzle_migrations')::text AS migration_journal,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'documents'
          AND column_name = 'revision'
      ) AS has_document_revision,
      EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS has_vector,
      COALESCE(
        (
          SELECT jsonb_agg(indexname ORDER BY indexname)
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (${sql.join(
              REQUIRED_INDEXES.map((name) => sql`${name}`),
              sql`, `,
            )})
        ),
        '[]'::jsonb
      ) AS indexes
  `);
  const row = result.rows[0] as {
    documents: string | null;
    workspace_members: string | null;
    document_versions: string | null;
    document_search_blocks: string | null;
    migration_journal: string | null;
    has_document_revision: boolean;
    has_vector: boolean;
    indexes: string[] | string;
  };
  const indexes = Array.isArray(row.indexes)
    ? row.indexes
    : (JSON.parse(String(row.indexes)) as string[]);
  const missingIndexes = REQUIRED_INDEXES.filter(
    (name) => !indexes.includes(name),
  );
  const checks = {
    connected: true,
    coreSchemaReady: Boolean(
      row.documents &&
        row.workspace_members &&
        row.document_versions &&
        row.has_document_revision,
    ),
    searchSchemaReady: Boolean(
      row.document_search_blocks && row.has_vector,
    ),
    migrationJournalReady: Boolean(row.migration_journal),
    missingIndexes,
  };
  const ready =
    checks.coreSchemaReady &&
    checks.searchSchemaReady &&
    checks.migrationJournalReady &&
    missingIndexes.length === 0;

  console.log(JSON.stringify({ ready, checks }, null, 2));
  if (!ready) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ready: false,
      checks: { connected: false },
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

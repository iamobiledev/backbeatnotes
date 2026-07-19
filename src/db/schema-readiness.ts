export const REQUIRED_SCHEMA_INDEXES = [
  "document_search_blocks_doc_block_uidx",
  "documents_active_ws_title_idx",
  "documents_active_ws_updated_idx",
  "documents_active_parent_title_idx",
  "documents_trash_ws_archived_idx",
  "document_activity_coalesce_idx",
  "document_invitations_doc_status_expiry_idx",
  "workspace_invitations_ws_status_created_idx",
  "workspaces_auto_join_domain_uidx",
  "workspace_members_single_owner_uidx",
] as const;

export type SchemaTargetLabel = "runtime" | "migration";

export type SchemaCheckTarget = {
  label: SchemaTargetLabel;
  url: string;
};

export type SchemaReadinessChecks = {
  connected: boolean;
  coreSchemaReady: boolean;
  searchSchemaReady: boolean;
  domainAccessSchemaReady: boolean;
  ownershipSchemaReady: boolean;
  migrationJournalReady: boolean;
  missingIndexes: string[];
};

export type SchemaTargetResult = {
  target: SchemaTargetLabel;
  ready: boolean;
  checks: SchemaReadinessChecks;
  error?: "unavailable";
};

export type SchemaReadinessDiagnostic =
  | "READY"
  | "NO_DATABASE_TARGET"
  | "SCHEMA_INCOMPLETE"
  | "RUNTIME_SCHEMA_BEHIND_MIGRATION_TARGET"
  | "MIGRATION_SCHEMA_BEHIND_RUNTIME_TARGET";

export type SchemaReadinessReport = {
  ready: boolean;
  diagnostic: SchemaReadinessDiagnostic;
  targets: SchemaTargetResult[];
};

type DatabaseEnvironment = {
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
};

/**
 * Resolve every configured database endpoint that must expose the schema.
 *
 * The application URL is authoritative and checked first. The direct
 * migration URL is checked as a second target when it differs. URLs stay in
 * this internal structure and must never be included in readiness reports.
 */
export function resolveSchemaCheckTargets(
  env: DatabaseEnvironment,
): SchemaCheckTarget[] {
  const runtimeUrl = env.DATABASE_URL?.trim();
  const migrationUrl = env.DATABASE_URL_UNPOOLED?.trim();
  const targets: SchemaCheckTarget[] = [];

  if (runtimeUrl) {
    targets.push({ label: "runtime", url: runtimeUrl });
  }
  if (migrationUrl && migrationUrl !== runtimeUrl) {
    targets.push({ label: "migration", url: migrationUrl });
  }

  return targets;
}

export function isSchemaReady(checks: SchemaReadinessChecks): boolean {
  return (
    checks.connected &&
    checks.coreSchemaReady &&
    checks.searchSchemaReady &&
    checks.domainAccessSchemaReady &&
    checks.ownershipSchemaReady &&
    checks.migrationJournalReady &&
    checks.missingIndexes.length === 0
  );
}

/**
 * Build a credential-free report and classify split-target drift explicitly.
 */
export function buildSchemaReadinessReport(
  targets: SchemaTargetResult[],
): SchemaReadinessReport {
  if (targets.length === 0) {
    return {
      ready: false,
      diagnostic: "NO_DATABASE_TARGET",
      targets: [],
    };
  }

  const ready = targets.every((target) => target.ready);
  if (ready) {
    return { ready: true, diagnostic: "READY", targets };
  }

  const runtime = targets.find((target) => target.target === "runtime");
  const migration = targets.find((target) => target.target === "migration");
  let diagnostic: SchemaReadinessDiagnostic = "SCHEMA_INCOMPLETE";

  if (runtime && migration) {
    if (!runtime.ready && migration.ready) {
      diagnostic = "RUNTIME_SCHEMA_BEHIND_MIGRATION_TARGET";
    } else if (runtime.ready && !migration.ready) {
      diagnostic = "MIGRATION_SCHEMA_BEHIND_RUNTIME_TARGET";
    }
  }

  return { ready: false, diagnostic, targets };
}

/** Remove database connection strings before rendering operational errors. */
export function redactDatabaseUrls(
  message: string,
  configuredUrls: readonly string[] = [],
): string {
  let redacted = message;
  for (const url of configuredUrls) {
    if (url) {
      redacted = redacted.replaceAll(url, "[REDACTED_DATABASE_URL]");
    }
  }
  return redacted.replace(
    /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
}

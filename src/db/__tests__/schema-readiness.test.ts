import { describe, expect, it } from "vitest";
import {
  buildSchemaReadinessReport,
  isSchemaReady,
  redactDatabaseUrls,
  resolveSchemaCheckTargets,
  type SchemaReadinessChecks,
  type SchemaTargetResult,
} from "../schema-readiness";

const READY_CHECKS: SchemaReadinessChecks = {
  connected: true,
  coreSchemaReady: true,
  searchSchemaReady: true,
  domainAccessSchemaReady: true,
  ownershipSchemaReady: true,
  migrationJournalReady: true,
  missingIndexes: [],
};

const STALE_CHECKS: SchemaReadinessChecks = {
  ...READY_CHECKS,
  domainAccessSchemaReady: false,
  ownershipSchemaReady: false,
  missingIndexes: [
    "workspaces_auto_join_domain_uidx",
    "workspace_members_single_owner_uidx",
  ],
};

function result(
  target: SchemaTargetResult["target"],
  checks: SchemaReadinessChecks,
): SchemaTargetResult {
  return { target, ready: isSchemaReady(checks), checks };
}

describe("schema check targets", () => {
  it("uses the application URL as the authoritative runtime target", () => {
    expect(
      resolveSchemaCheckTargets({
        DATABASE_URL: "postgresql://runtime.example/app",
      }),
    ).toEqual([
      {
        label: "runtime",
        url: "postgresql://runtime.example/app",
      },
    ]);
  });

  it("supports a direct-only environment for backwards compatibility", () => {
    expect(
      resolveSchemaCheckTargets({
        DATABASE_URL_UNPOOLED: "postgresql://direct.example/app",
      }),
    ).toEqual([
      {
        label: "migration",
        url: "postgresql://direct.example/app",
      },
    ]);
  });

  it("checks both distinct runtime and migration targets", () => {
    expect(
      resolveSchemaCheckTargets({
        DATABASE_URL: " postgresql://pooler.example/app ",
        DATABASE_URL_UNPOOLED: " postgresql://direct.example/app ",
      }),
    ).toEqual([
      {
        label: "runtime",
        url: "postgresql://pooler.example/app",
      },
      {
        label: "migration",
        url: "postgresql://direct.example/app",
      },
    ]);
  });

  it("deduplicates identical runtime and migration URLs", () => {
    expect(
      resolveSchemaCheckTargets({
        DATABASE_URL: "postgresql://same.example/app",
        DATABASE_URL_UNPOOLED: "postgresql://same.example/app",
      }),
    ).toEqual([
      {
        label: "runtime",
        url: "postgresql://same.example/app",
      },
    ]);
  });
});

describe("schema readiness report", () => {
  it("passes one or two ready targets", () => {
    expect(
      buildSchemaReadinessReport([result("runtime", READY_CHECKS)]),
    ).toMatchObject({ ready: true, diagnostic: "READY" });
    expect(
      buildSchemaReadinessReport([
        result("runtime", READY_CHECKS),
        result("migration", READY_CHECKS),
      ]),
    ).toMatchObject({ ready: true, diagnostic: "READY" });
  });

  it("detects the false-positive case where only direct migrations ran", () => {
    expect(
      buildSchemaReadinessReport([
        result("runtime", STALE_CHECKS),
        result("migration", READY_CHECKS),
      ]),
    ).toMatchObject({
      ready: false,
      diagnostic: "RUNTIME_SCHEMA_BEHIND_MIGRATION_TARGET",
    });
  });

  it("detects a stale direct migration target", () => {
    expect(
      buildSchemaReadinessReport([
        result("runtime", READY_CHECKS),
        result("migration", STALE_CHECKS),
      ]),
    ).toMatchObject({
      ready: false,
      diagnostic: "MIGRATION_SCHEMA_BEHIND_RUNTIME_TARGET",
    });
  });

  it("fails incomplete and missing target configurations", () => {
    expect(
      buildSchemaReadinessReport([result("runtime", STALE_CHECKS)]),
    ).toMatchObject({ ready: false, diagnostic: "SCHEMA_INCOMPLETE" });
    expect(buildSchemaReadinessReport([])).toEqual({
      ready: false,
      diagnostic: "NO_DATABASE_TARGET",
      targets: [],
    });
  });

  it("requires every readiness check and index", () => {
    expect(isSchemaReady(READY_CHECKS)).toBe(true);
    expect(isSchemaReady(STALE_CHECKS)).toBe(false);
    expect(
      isSchemaReady({ ...READY_CHECKS, connected: false }),
    ).toBe(false);
  });
});

describe("database URL redaction", () => {
  it("redacts configured and embedded Postgres URLs", () => {
    const secret =
      "postgresql://app:super-secret@ep-example.us-east-1.aws.neon.tech/main?sslmode=require";
    const output = redactDatabaseUrls(
      `Connection failed for ${secret}; fallback postgres://u:p@localhost/db`,
      [secret],
    );

    expect(output).toBe(
      "Connection failed for [REDACTED_DATABASE_URL]; fallback [REDACTED_DATABASE_URL]",
    );
    expect(output).not.toContain("super-secret");
  });

  it("never serializes target URLs in the public report", () => {
    const sentinel = "DO_NOT_LEAK_DATABASE_CREDENTIAL";
    const targets = resolveSchemaCheckTargets({
      DATABASE_URL: `postgresql://user:${sentinel}@runtime.example/app`,
      DATABASE_URL_UNPOOLED: `postgresql://user:${sentinel}@direct.example/app`,
    });
    const report = buildSchemaReadinessReport([
      result(targets[0].label, READY_CHECKS),
      result(targets[1].label, READY_CHECKS),
    ]);

    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(report.targets.map((target) => target.target)).toEqual([
      "runtime",
      "migration",
    ]);
  });
});

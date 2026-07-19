import { describe, expect, it } from "vitest";
import {
  isMissingPostgresColumn,
  isMissingPostgresRelation,
  postgresErrorCode,
} from "../errors";

describe("PostgreSQL error classification", () => {
  it("finds a driver code through Drizzle cause layers", () => {
    const error = new Error("Failed query", {
      cause: new Error('relation "document_search_blocks" does not exist', {
        cause: { code: "42P01" },
      }),
    });
    expect(postgresErrorCode(error)).toBe("42P01");
  });

  it("surfaces unique-violation codes used by domain-claim races", () => {
    const error = new Error("Failed query", {
      cause: Object.assign(new Error("duplicate key value"), { code: "23505" }),
    });
    expect(postgresErrorCode(error)).toBe("23505");
  });

  it("matches the missing relation on the same PostgreSQL error layer", () => {
    const error = new Error(
      'Failed query: select * from "document_search_blocks"',
      {
        cause: Object.assign(
          new Error('relation "document_search_blocks" does not exist'),
          { code: "42P01" },
        ),
      },
    );
    expect(
      isMissingPostgresRelation(error, "document_search_blocks"),
    ).toBe(true);
  });

  it("does not swallow another missing relation mentioned by outer SQL", () => {
    const error = new Error(
      'Failed query joining "document_search_blocks" to "documents"',
      {
        cause: Object.assign(
          new Error('relation "documents" does not exist'),
          { code: "42P01" },
        ),
      },
    );
    expect(
      isMissingPostgresRelation(error, "document_search_blocks"),
    ).toBe(false);
  });

  it("accepts a structured table field and rejects unrelated codes", () => {
    expect(
      isMissingPostgresRelation(
        { code: "42P01", table: "document_search_blocks" },
        "document_search_blocks",
      ),
    ).toBe(true);
    expect(
      isMissingPostgresRelation(
        {
          code: "42703",
          message: 'relation "document_search_blocks" does not exist',
        },
        "document_search_blocks",
      ),
    ).toBe(false);
  });

  it("matches a missing column through nested driver errors", () => {
    const error = new Error(
      'Failed query: select "auto_join_domain" from "workspaces"',
      {
        cause: Object.assign(
          new Error('column "auto_join_domain" does not exist'),
          { code: "42703" },
        ),
      },
    );
    expect(isMissingPostgresColumn(error, "auto_join_domain")).toBe(true);
  });

  it("matches qualified and structured missing-column errors", () => {
    expect(
      isMissingPostgresColumn(
        {
          code: "42703",
          message: 'column "workspaces.auto_join_domain" does not exist',
        },
        "auto_join_domain",
      ),
    ).toBe(true);
    expect(
      isMissingPostgresColumn(
        { code: "42703", column: "auto_join_domain" },
        "auto_join_domain",
      ),
    ).toBe(true);
  });

  it("does not swallow unrelated missing columns or SQLSTATEs", () => {
    expect(
      isMissingPostgresColumn(
        {
          code: "42703",
          message: 'column "workspaces.some_other_column" does not exist',
        },
        "auto_join_domain",
      ),
    ).toBe(false);
    expect(
      isMissingPostgresColumn(
        {
          code: "42P01",
          message: 'column "auto_join_domain" does not exist',
        },
        "auto_join_domain",
      ),
    ).toBe(false);
  });
});

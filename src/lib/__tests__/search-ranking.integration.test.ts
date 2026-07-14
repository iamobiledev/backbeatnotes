import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

/**
 * Integration tests for search ranking + permission filtering against a
 * real Postgres database. Skipped unless TEST_DATABASE_URL is set, e.g.:
 *
 *   TEST_DATABASE_URL=postgresql://docloom:docloom@localhost:5432/docloom pnpm test
 *
 * The tests create isolated fixture rows (unique nanoid-based tokens) and
 * clean them up afterwards, so they are safe to run against a dev database.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const runIf = TEST_DATABASE_URL ? describe : describe.skip;

runIf("search ranking + permissions (integration)", () => {
  // Unique token so fixtures never collide with real data or other runs.
  const token = `zq${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;

  let db: import("@/db/create-db").Database;
  let search: import("@/lib/search/types").SearchService;

  const memberId = `u-member-${token}`;
  const outsiderId = `u-outsider-${token}`;
  const workspaceId = `w-${token}`;
  const otherWorkspaceId = `w2-${token}`;

  const docs = {
    exactTitle: `d-exact-${token}`,
    prefixTitle: `d-prefix-${token}`,
    bodyOnly: `d-body-${token}`,
    trashed: `d-trashed-${token}`,
    privateDoc: `d-private-${token}`,
    otherWorkspace: `d-other-${token}`,
  };
  const embedding = (x: number, y: number) => [
    x,
    y,
    ...Array(510).fill(0),
  ];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.SKIP_ENV_VALIDATION = "1";
    const { createDatabase } = await import("@/db/create-db");
    const schema = await import("@/db/schema");
    const { getSearchService } = await import("@/lib/search");
    db = createDatabase(TEST_DATABASE_URL!);
    search = getSearchService();

    await db.insert(schema.user).values([
      { id: memberId, name: `Member ${token}`, email: `${memberId}@t.local` },
      { id: outsiderId, name: `Outsider ${token}`, email: `${outsiderId}@t.local` },
    ]);
    await db.insert(schema.workspaces).values([
      { id: workspaceId, name: `WS ${token}`, slug: `ws-${token}`, createdById: memberId },
      { id: otherWorkspaceId, name: `WS2 ${token}`, slug: `ws2-${token}`, createdById: outsiderId },
    ]);
    await db.insert(schema.workspaceMembers).values([
      { id: `m1-${token}`, workspaceId, userId: memberId, role: "owner" },
      { id: `m2-${token}`, workspaceId: otherWorkspaceId, userId: outsiderId, role: "owner" },
    ]);

    const mkDoc = (
      id: string,
      title: string,
      body: string,
      extra: Partial<typeof schema.documents.$inferInsert> = {},
    ) => ({
      id,
      workspaceId,
      title,
      breadcrumbPath: title,
      plainTextContent: body,
      contentJson: {},
      createdById: memberId,
      ...extra,
    });

    await db.insert(schema.documents).values([
      mkDoc(docs.exactTitle, `flumpet ${token}`, "nothing relevant here"),
      mkDoc(docs.prefixTitle, `flumpet ${token} roadmap draft`, "some body"),
      mkDoc(
        docs.bodyOnly,
        `unrelated title ${token}b`,
        `deep dive into the flumpet ${token} architecture and design`,
      ),
      mkDoc(docs.trashed, `flumpet ${token} trashed`, "trashed body", {
        archivedAt: new Date(),
      }),
      mkDoc(docs.privateDoc, `flumpet ${token} secret`, "private body", {
        visibility: "private" as const,
      }),
      {
        id: docs.otherWorkspace,
        workspaceId: otherWorkspaceId,
        title: `flumpet ${token} elsewhere`,
        breadcrumbPath: "",
        plainTextContent: "in another workspace",
        contentJson: {},
        createdById: outsiderId,
      },
    ]);

    await db.insert(schema.documentSearchBlocks).values([
      {
        id: `b-body-${token}`,
        documentId: docs.bodyOnly,
        blockId: `block_body_${token}`,
        blockType: "paragraph",
        position: 0,
        textContent: "Users are unable to receive account recovery email.",
        inputHash: "body-hash",
        embedding: embedding(1, 0),
      },
      {
        id: `b-exact-${token}`,
        documentId: docs.exactTitle,
        blockId: `block_exact_${token}`,
        blockType: "paragraph",
        position: 0,
        textContent: "A product planning paragraph.",
        inputHash: "exact-hash",
        embedding: embedding(0, 1),
      },
      {
        id: `b-other-${token}`,
        documentId: docs.otherWorkspace,
        blockId: `block_other_${token}`,
        blockType: "paragraph",
        position: 0,
        textContent: "Account recovery email troubleshooting.",
        inputHash: "other-hash",
        embedding: embedding(1, 0),
      },
    ]);
  });

  afterAll(async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM documents WHERE id LIKE ${"d-%" + token + "%"}`);
    await db.execute(sql`DELETE FROM workspaces WHERE id IN (${workspaceId}, ${otherWorkspaceId})`);
    await db.execute(sql`DELETE FROM "user" WHERE id IN (${memberId}, ${outsiderId})`);
  });

  it("ranks exact title > prefix > body match", async () => {
    const result = await search.search({
      query: `flumpet ${token}`,
      userId: memberId,
      workspaceId,
    });
    const ids = result.hits.map((hit) => hit.documentId);
    expect(ids[0]).toBe(docs.exactTitle);
    expect(ids.indexOf(docs.prefixTitle)).toBeLessThan(
      ids.indexOf(docs.bodyOnly),
    );
    expect(ids).toContain(docs.bodyOnly);
  });

  it("excludes trashed documents", async () => {
    const result = await search.search({
      query: `flumpet ${token}`,
      userId: memberId,
      workspaceId,
    });
    expect(result.hits.map((h) => h.documentId)).not.toContain(docs.trashed);
  });

  it("member sees their own private doc; others never do", async () => {
    const own = await search.search({
      query: `flumpet ${token} secret`,
      userId: memberId,
      workspaceId,
    });
    expect(own.hits.map((h) => h.documentId)).toContain(docs.privateDoc);

    const foreign = await search.search({
      query: `flumpet ${token}`,
      userId: outsiderId,
    });
    expect(foreign.hits.map((h) => h.documentId)).not.toContain(
      docs.privateDoc,
    );
  });

  it("non-members see nothing from the workspace", async () => {
    const result = await search.search({
      query: `flumpet ${token}`,
      userId: outsiderId,
    });
    const ids = result.hits.map((hit) => hit.documentId);
    // Only their own workspace's doc comes back.
    expect(ids).toEqual([docs.otherWorkspace]);
  });

  it("direct shares make pages searchable for non-members (incl. private)", async () => {
    const schema = await import("@/db/schema");
    await db.insert(schema.documentPermissions).values([
      {
        id: `p1-${token}`,
        documentId: docs.exactTitle,
        userId: outsiderId,
        level: "view",
      },
      {
        id: `p2-${token}`,
        documentId: docs.privateDoc,
        userId: outsiderId,
        level: "edit",
      },
    ]);

    const result = await search.search({
      query: `flumpet ${token}`,
      userId: outsiderId,
    });
    const ids = result.hits.map((hit) => hit.documentId);
    expect(ids).toContain(docs.exactTitle);
    // Private ("Only people invited") docs surface once directly shared.
    expect(ids).toContain(docs.privateDoc);
    // Unshared docs in the foreign workspace stay hidden.
    expect(ids).not.toContain(docs.prefixTitle);

    // Removing the grants hides the docs again.
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`DELETE FROM document_permissions WHERE id IN (${`p1-${token}`}, ${`p2-${token}`})`,
    );
    const revoked = await search.search({
      query: `flumpet ${token}`,
      userId: outsiderId,
    });
    const revokedIds = revoked.hits.map((hit) => hit.documentId);
    expect(revokedIds).not.toContain(docs.exactTitle);
    expect(revokedIds).not.toContain(docs.privateDoc);
  });

  it("body matches include highlighted snippets", async () => {
    const result = await search.search({
      query: "architecture design",
      userId: memberId,
      workspaceId,
    });
    const hit = result.hits.find((h) => h.documentId === docs.bodyOnly);
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain("⟪");
    expect(hit!.snippet).toContain("⟫");
  });

  it("finds the closest paragraph semantically and returns its anchor", async () => {
    const result = await search.semanticSearch({
      query: "password reset messages do not show up",
      embedding: embedding(1, 0),
      userId: memberId,
      workspaceIds: [workspaceId],
      limit: 3,
    });
    expect(result.hits[0].documentId).toBe(docs.bodyOnly);
    expect(result.hits[0].matchedBlock).toMatchObject({
      blockId: `block_body_${token}`,
      text: "Users are unable to receive account recovery email.",
    });
  });

  it("semantic Slack scope excludes otherwise accessible foreign workspaces", async () => {
    const schema = await import("@/db/schema");
    await db.insert(schema.documentPermissions).values({
      id: `p-semantic-${token}`,
      documentId: docs.otherWorkspace,
      userId: memberId,
      level: "view",
    });

    const result = await search.semanticSearch({
      query: "account recovery email",
      embedding: embedding(1, 0),
      userId: memberId,
      workspaceIds: [workspaceId],
      limit: 10,
    });
    expect(result.hits.map((hit) => hit.documentId)).not.toContain(
      docs.otherWorkspace,
    );

    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`DELETE FROM document_permissions WHERE id = ${`p-semantic-${token}`}`,
    );
  });

  it("owner filter narrows results", async () => {
    const result = await search.search({
      query: `flumpet ${token}`,
      userId: memberId,
      workspaceId,
      ownerId: outsiderId,
    });
    expect(result.hits).toHaveLength(0);
  });

  it("recency is a tiebreaker for equal scores", async () => {
    const { sql } = await import("drizzle-orm");
    // Two docs with identical titles, different updated_at.
    const oldId = `d-old-${token}`;
    const newId = `d-new-${token}`;
    await db.execute(sql`
      INSERT INTO documents (id, workspace_id, title, breadcrumb_path, plain_text_content, content_json, created_by_id, updated_at)
      VALUES
        (${oldId}, ${workspaceId}, ${"gronkle " + token}, '', 'aaa', '{}', ${memberId}, now() - interval '30 days'),
        (${newId}, ${workspaceId}, ${"gronkle " + token}, '', 'bbb', '{}', ${memberId}, now())
    `);
    const result = await search.search({
      query: `gronkle ${token}`,
      userId: memberId,
      workspaceId,
    });
    const ids = result.hits.map((hit) => hit.documentId);
    expect(ids.indexOf(newId)).toBeLessThan(ids.indexOf(oldId));
  });
});

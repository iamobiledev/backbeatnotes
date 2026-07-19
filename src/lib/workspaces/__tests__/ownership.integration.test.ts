import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const runIf = TEST_DATABASE_URL ? describe.sequential : describe.skip;

runIf("workspace ownership transfer (integration)", () => {
  const token = nanoid(10);
  const ownerId = `owner-${token}`;
  const targetId = `target-${token}`;
  const outsiderId = `outsider-${token}`;
  const workspaceId = `workspace-${token}`;

  let db: import("@/db/create-db").Database;
  let schema: typeof import("@/db/schema");
  let transferWorkspaceOwnership: typeof import("../service").transferWorkspaceOwnership;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    process.env.BETTER_AUTH_SECRET =
      "integration-test-secret-at-least-32-characters";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.SKIP_ENV_VALIDATION = "1";

    const databaseModule = await import("@/db/create-db");
    schema = await import("@/db/schema");
    ({ transferWorkspaceOwnership } = await import("../service"));
    db = databaseModule.createDatabase(TEST_DATABASE_URL!);

    await db.insert(schema.user).values([
      {
        id: ownerId,
        name: "Original Owner",
        email: `${ownerId}@test.local`,
      },
      {
        id: targetId,
        name: "Future Owner",
        email: `${targetId}@test.local`,
      },
      {
        id: outsiderId,
        name: "Outsider",
        email: `${outsiderId}@test.local`,
      },
    ]);
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: "Ownership Test",
      slug: `ownership-${token}`,
      createdById: ownerId,
    });
    await db.insert(schema.workspaceMembers).values([
      {
        id: `membership-owner-${token}`,
        workspaceId,
        userId: ownerId,
        role: "owner",
      },
      {
        id: `membership-target-${token}`,
        workspaceId,
        userId: targetId,
        role: "member",
      },
    ]);
  });

  afterAll(async () => {
    if (!db || !schema) return;
    await db
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId));
    await db
      .delete(schema.user)
      .where(
        sql`${schema.user.id} IN (${ownerId}, ${targetId}, ${outsiderId})`,
      );
  });

  it("rejects self-transfer and non-member targets", async () => {
    await expect(
      transferWorkspaceOwnership({
        userId: ownerId,
        workspaceId,
        targetUserId: ownerId,
      }),
    ).rejects.toThrow("CANNOT_TRANSFER_TO_SELF");
    await expect(
      transferWorkspaceOwnership({
        userId: ownerId,
        workspaceId,
        targetUserId: outsiderId,
      }),
    ).rejects.toThrow("TRANSFER_TARGET_NOT_MEMBER");
  });

  it("atomically swaps roles and ownership metadata", async () => {
    await transferWorkspaceOwnership({
      userId: ownerId,
      workspaceId,
      targetUserId: targetId,
    });

    const memberships = await db
      .select({
        userId: schema.workspaceMembers.userId,
        role: schema.workspaceMembers.role,
      })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
    expect(memberships).toEqual(
      expect.arrayContaining([
        { userId: ownerId, role: "admin" },
        { userId: targetId, role: "owner" },
      ]),
    );
    expect(memberships.filter(({ role }) => role === "owner")).toHaveLength(1);

    const [workspace] = await db
      .select({ createdById: schema.workspaces.createdById })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId));
    expect(workspace.createdById).toBe(targetId);
  });

  it("blocks the former owner and lets the new owner transfer it back", async () => {
    await expect(
      transferWorkspaceOwnership({
        userId: ownerId,
        workspaceId,
        targetUserId: targetId,
      }),
    ).rejects.toThrow("OWNER_ONLY");

    await transferWorkspaceOwnership({
      userId: targetId,
      workspaceId,
      targetUserId: ownerId,
    });

    const [restoredOwner] = await db
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          eq(schema.workspaceMembers.userId, ownerId),
        ),
      );
    expect(restoredOwner.role).toBe("owner");
  });

  it("enforces the one-owner database invariant", async () => {
    await expect(
      db
        .update(schema.workspaceMembers)
        .set({ role: "owner" })
        .where(
          and(
            eq(schema.workspaceMembers.workspaceId, workspaceId),
            eq(schema.workspaceMembers.userId, targetId),
          ),
        ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23505" }),
    });
  });
});

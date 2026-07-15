import "server-only";
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { getDb, workspaceMembers, type WorkspaceMember } from "@/db";
import {
  roleAtLeast,
  type WorkspaceRole,
  canEditDocuments,
  canManageWorkspace,
  canInvite,
} from "@/lib/roles";

export type { WorkspaceRole };
export { roleAtLeast, canEditDocuments, canManageWorkspace, canInvite };

/**
 * Resolve membership from the database. Never trust client-supplied roles.
 */
export const getMembership = cache(async function getMembership(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMember | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ?? null;
});

export async function requireMembership(
  userId: string,
  workspaceId: string,
  minimum: WorkspaceRole = "guest",
): Promise<WorkspaceMember> {
  const membership = await getMembership(userId, workspaceId);
  if (!membership || !roleAtLeast(membership.role, minimum)) {
    throw new Error("FORBIDDEN");
  }
  return membership;
}

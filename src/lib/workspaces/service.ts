import "server-only";
import { cache } from "react";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { after } from "next/server";
import { nanoid } from "nanoid";
import {
  getDb,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  user,
} from "@/db";
import {
  requireMembership,
  canInvite,
  canManageWorkspace,
} from "@/lib/permissions";
import { sendWorkspaceInvitationEmail } from "@/lib/email";
import {
  actorCanClaimAutoJoinDomain,
  membershipRoleFromInvitation,
  shouldApplyInvitationRoleToMembership,
  validateAutoJoinDomain,
} from "@/lib/workspaces/auto-join";
import { slugify } from "@/lib/utils";
import { brand } from "@/config/brand";
import { logger } from "@/lib/logger";
import {
  isMissingPostgresColumn,
  postgresErrorCode,
} from "@/lib/db/errors";

/**
 * Keep core workspace reads compatible with additive schema rollouts.
 * Optional/new columns must be queried by their owning feature so a pending
 * migration cannot break sign-in, personal-workspace bootstrap, or Slack.
 */
const stableWorkspaceSelection = {
  id: workspaces.id,
  name: workspaces.name,
  slug: workspaces.slug,
  iconUrl: workspaces.iconUrl,
  iconBlobPathname: workspaces.iconBlobPathname,
  isPersonal: workspaces.isPersonal,
  createdById: workspaces.createdById,
  createdAt: workspaces.createdAt,
  updatedAt: workspaces.updatedAt,
};

export async function createWorkspace(opts: {
  userId: string;
  name: string;
  isPersonal?: boolean;
}) {
  const db = getDb();

  // Team workspaces can only be created by platform admins.
  if (!opts.isPersonal) {
    const [creator] = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, opts.userId))
      .limit(1);
    if (creator?.role !== "admin") throw new Error("ADMIN_ONLY");
  }

  const id = nanoid();
  const base = slugify(opts.name) || "workspace";
  const slug = `${base}-${nanoid(6)}`;

  const [workspace] = await db
    .insert(workspaces)
    .values({
      id,
      name: opts.name.trim() || brand.defaultWorkspaceName,
      slug,
      isPersonal: opts.isPersonal ?? false,
      createdById: opts.userId,
    })
    .returning(stableWorkspaceSelection);

  await db.insert(workspaceMembers).values({
    id: nanoid(),
    workspaceId: workspace.id,
    userId: opts.userId,
    role: "owner",
  });

  return workspace;
}

export const PERSONAL_WORKSPACE_NAME = "Personal notebook";

/**
 * Every user gets a private single-member "Personal notebook" workspace.
 * Provisioned lazily; sharing/invitations are rejected for it server-side.
 */
export async function getOrCreatePersonalWorkspace(userId: string) {
  const db = getDb();
  const [existing] = await db
    .select(stableWorkspaceSelection)
    .from(workspaces)
    .where(
      and(eq(workspaces.createdById, userId), eq(workspaces.isPersonal, true)),
    )
    .limit(1);
  if (existing) return existing;

  try {
    return await createWorkspace({
      userId,
      name: PERSONAL_WORKSPACE_NAME,
      isPersonal: true,
    });
  } catch (error) {
    // Unique index race: another request created it concurrently.
    const [retry] = await db
      .select(stableWorkspaceSelection)
      .from(workspaces)
      .where(
        and(
          eq(workspaces.createdById, userId),
          eq(workspaces.isPersonal, true),
        ),
      )
      .limit(1);
    if (retry) return retry;
    throw error;
  }
}

export const getWorkspaceById = cache(async function getWorkspaceById(
  workspaceId: string,
) {
  const db = getDb();
  const [workspace] = await db
    .select(stableWorkspaceSelection)
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace ?? null;
});

export type WorkspaceAutoJoinDomainState =
  | { available: true; domain: string | null }
  | { available: false; domain: null };

/**
 * Domain access is optional during a rolling schema deployment. Only an exact
 * missing-column error is degraded; connectivity and unrelated schema errors
 * still fail loudly.
 */
export const getWorkspaceAutoJoinDomain = cache(
  async function getWorkspaceAutoJoinDomain(
    workspaceId: string,
  ): Promise<WorkspaceAutoJoinDomainState> {
    const db = getDb();
    try {
      const [workspace] = await db
        .select({ domain: workspaces.autoJoinDomain })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      return { available: true, domain: workspace?.domain ?? null };
    } catch (error) {
      if (isMissingPostgresColumn(error, "auto_join_domain")) {
        logger.warn("workspace.auto_join_schema_unavailable", {
          workspaceId,
        });
        return { available: false, domain: null };
      }
      throw error;
    }
  },
);

export async function listWorkspaceMembers(opts: {
  userId: string;
  workspaceId: string;
}) {
  await requireMembership(opts.userId, opts.workspaceId, "guest");
  const db = getDb();
  return db
    .select({
      membershipId: workspaceMembers.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, opts.workspaceId))
    .orderBy(workspaceMembers.createdAt);
}

export async function updateMemberRole(opts: {
  userId: string;
  workspaceId: string;
  targetUserId: string;
  role: "admin" | "member" | "guest";
}) {
  const membership = await requireMembership(
    opts.userId,
    opts.workspaceId,
    "admin",
  );
  if (!canManageWorkspace(membership.role)) throw new Error("FORBIDDEN");

  const db = getDb();
  const [target] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, opts.workspaceId),
        eq(workspaceMembers.userId, opts.targetUserId),
      ),
    )
    .limit(1);
  if (!target) throw new Error("NOT_FOUND");
  if (target.role === "owner") throw new Error("CANNOT_CHANGE_OWNER");

  await db
    .update(workspaceMembers)
    .set({ role: opts.role, updatedAt: new Date() })
    .where(eq(workspaceMembers.id, target.id));
}

type OwnershipTransferStatus =
  | "OK"
  | "NOT_FOUND"
  | "PERSONAL_WORKSPACE"
  | "OWNER_ONLY"
  | "CANNOT_TRANSFER_TO_SELF"
  | "TRANSFER_TARGET_NOT_MEMBER"
  | "ALREADY_OWNER";

/**
 * Atomically transfer singular team-workspace ownership.
 *
 * PostgreSQL owns the transaction boundary because the production Neon HTTP
 * Drizzle driver does not support callback transactions. Migration 0011
 * installs this security-invoker function and a unique owner index. The
 * function locks the workspace and both memberships before changing roles.
 */
export async function transferWorkspaceOwnership(opts: {
  userId: string;
  workspaceId: string;
  targetUserId: string;
}) {
  const result = await getDb().execute(sql`
    SELECT transfer_workspace_ownership(
      ${opts.workspaceId},
      ${opts.userId},
      ${opts.targetUserId}
    ) AS status
  `);
  const status = result.rows[0]?.status as OwnershipTransferStatus | undefined;
  if (status !== "OK") {
    throw new Error(status ?? "OWNERSHIP_TRANSFER_FAILED");
  }
}

export async function removeMember(opts: {
  userId: string;
  workspaceId: string;
  targetUserId: string;
}) {
  const membership = await requireMembership(
    opts.userId,
    opts.workspaceId,
    "admin",
  );
  if (!canManageWorkspace(membership.role)) throw new Error("FORBIDDEN");

  const db = getDb();
  const [target] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, opts.workspaceId),
        eq(workspaceMembers.userId, opts.targetUserId),
      ),
    )
    .limit(1);
  if (!target) throw new Error("NOT_FOUND");
  if (target.role === "owner") throw new Error("CANNOT_REMOVE_OWNER");

  await db.delete(workspaceMembers).where(eq(workspaceMembers.id, target.id));
}

/**
 * Set (or clear) the verified-email domain whose users automatically join
 * this workspace as members. Owner/admin only; personal notebooks never
 * allow domain access. Claiming a domain requires the actor's own verified
 * email to be at that domain, and each domain may be claimed by at most one
 * workspace.
 */
export async function setWorkspaceAutoJoinDomain(opts: {
  userId: string;
  workspaceId: string;
  domain: string | null;
}) {
  const membership = await requireMembership(
    opts.userId,
    opts.workspaceId,
    "admin",
  );
  if (!canManageWorkspace(membership.role)) throw new Error("FORBIDDEN");
  const workspace = await getWorkspaceById(opts.workspaceId);
  if (!workspace) throw new Error("NOT_FOUND");
  if (workspace.isPersonal) throw new Error("PERSONAL_WORKSPACE");

  const db = getDb();
  let domain: string | null = null;
  const raw = opts.domain?.trim() ?? "";
  if (raw) {
    const result = validateAutoJoinDomain(raw);
    if (!result.ok) throw new Error(result.error);
    domain = result.domain;

    const [actor] = await db
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
      })
      .from(user)
      .where(eq(user.id, opts.userId))
      .limit(1);
    if (!actor?.emailVerified) throw new Error("EMAIL_UNVERIFIED");
    if (
      !actorCanClaimAutoJoinDomain({
        actorEmail: actor.email,
        domain,
      })
    ) {
      throw new Error("DOMAIN_OWNERSHIP");
    }

    const [claimed] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.autoJoinDomain, domain),
          ne(workspaces.id, opts.workspaceId),
        ),
      )
      .limit(1);
    if (claimed) throw new Error("DOMAIN_ALREADY_CLAIMED");
  }

  let updated;
  try {
    [updated] = await db
      .update(workspaces)
      .set({ autoJoinDomain: domain, updatedAt: new Date() })
      .where(eq(workspaces.id, opts.workspaceId))
      .returning({ autoJoinDomain: workspaces.autoJoinDomain });
  } catch (error) {
    // Concurrent claimants can pass the pre-check; the unique index still
    // rejects the loser — surface the same friendly error as the pre-check.
    if (domain && postgresErrorCode(error) === "23505") {
      throw new Error("DOMAIN_ALREADY_CLAIMED");
    }
    throw error;
  }

  logger.info("workspace.auto_join_domain_updated", {
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    domain: domain ?? "(cleared)",
  });

  return updated;
}

export async function renameWorkspace(opts: {
  userId: string;
  workspaceId: string;
  name: string;
}) {
  const membership = await requireMembership(
    opts.userId,
    opts.workspaceId,
    "admin",
  );
  if (!canManageWorkspace(membership.role)) throw new Error("FORBIDDEN");
  const workspace = await getWorkspaceById(opts.workspaceId);
  if (!workspace) throw new Error("NOT_FOUND");
  if (workspace.isPersonal) throw new Error("PERSONAL_WORKSPACE");

  const db = getDb();
  const [updated] = await db
    .update(workspaces)
    .set({ name: opts.name.trim(), updatedAt: new Date() })
    .where(eq(workspaces.id, opts.workspaceId))
    .returning(stableWorkspaceSelection);
  return updated;
}

export async function listPendingInvitations(opts: {
  userId: string;
  workspaceId: string;
}) {
  await requireMembership(opts.userId, opts.workspaceId, "admin");
  const db = getDb();
  return db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      status: workspaceInvitations.status,
      expiresAt: workspaceInvitations.expiresAt,
      lastSentAt: workspaceInvitations.lastSentAt,
      createdAt: workspaceInvitations.createdAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, opts.workspaceId),
        eq(workspaceInvitations.status, "pending"),
      ),
    )
    .orderBy(workspaceInvitations.createdAt);
}

export async function revokeInvitation(opts: {
  userId: string;
  workspaceId: string;
  invitationId: string;
}) {
  const membership = await requireMembership(
    opts.userId,
    opts.workspaceId,
    "admin",
  );
  if (!canInvite(membership.role)) throw new Error("FORBIDDEN");
  const db = getDb();
  await db
    .update(workspaceInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(workspaceInvitations.id, opts.invitationId),
        eq(workspaceInvitations.workspaceId, opts.workspaceId),
        eq(workspaceInvitations.status, "pending"),
      ),
    );
}

export async function inviteToWorkspace(opts: {
  userId: string;
  workspaceId: string;
  email: string;
  role?: "admin" | "member" | "guest";
}) {
  const membership = await requireMembership(
    opts.userId,
    opts.workspaceId,
    "admin",
  );
  if (!canInvite(membership.role)) throw new Error("FORBIDDEN");

  const db = getDb();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, opts.workspaceId))
    .limit(1);
  if (!workspace) throw new Error("NOT_FOUND");
  // Personal notebooks can never be shared.
  if (workspace.isPersonal) throw new Error("PERSONAL_WORKSPACE");

  const [inviter] = await db
    .select()
    .from(user)
    .where(eq(user.id, opts.userId))
    .limit(1);

  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  const [invitation] = await db
    .insert(workspaceInvitations)
    .values({
      id: nanoid(),
      workspaceId: opts.workspaceId,
      email: opts.email.toLowerCase().trim(),
      role: opts.role ?? "member",
      token,
      status: "pending",
      invitedById: opts.userId,
      expiresAt,
    })
    .returning();

  // Email failures must not lose the invitation — admins can hit Resend.
  try {
    await sendWorkspaceInvitationEmail({
      to: invitation.email,
      workspaceName: workspace.name,
      inviterName: inviter?.name ?? "A teammate",
      token,
    });
  } catch (error) {
    logger.error("invitation.email_failed", {
      invitationId: invitation.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return invitation;
}

export async function acceptInvitation(opts: {
  userId: string;
  userEmail: string;
  token: string;
}) {
  const db = getDb();
  const [invitation] = await db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.token, opts.token))
    .limit(1);

  if (!invitation) throw new Error("NOT_FOUND");
  if (invitation.status !== "pending") throw new Error("INVITATION_INACTIVE");
  if (invitation.expiresAt.getTime() < Date.now()) {
    await db
      .update(workspaceInvitations)
      .set({ status: "expired" })
      .where(eq(workspaceInvitations.id, invitation.id));
    throw new Error("INVITATION_EXPIRED");
  }
  if (invitation.email.toLowerCase() !== opts.userEmail.toLowerCase()) {
    throw new Error("EMAIL_MISMATCH");
  }

  const existing = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, invitation.workspaceId),
        eq(workspaceMembers.userId, opts.userId),
      ),
    )
    .limit(1);

  const invitedRole = membershipRoleFromInvitation(invitation.role);
  if (existing.length === 0) {
    await db.insert(workspaceMembers).values({
      id: nanoid(),
      workspaceId: invitation.workspaceId,
      userId: opts.userId,
      role: invitedRole,
    });
  } else if (
    shouldApplyInvitationRoleToMembership({
      existingRole: existing[0].role,
      invitationRole: invitation.role,
    })
  ) {
    // Domain auto-join (or an earlier membership) may have created a `member`
    // row before the invite was accepted — apply the invited role so guest /
    // admin invites are not silently ignored.
    await db
      .update(workspaceMembers)
      .set({ role: invitedRole, updatedAt: new Date() })
      .where(eq(workspaceMembers.id, existing[0].id));
  }

  await db
    .update(workspaceInvitations)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(workspaceInvitations.id, invitation.id));

  // Email the new member + the inviter after the response is sent.
  after(async () => {
    const [workspace] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, invitation.workspaceId))
      .limit(1);
    const [member] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, opts.userId))
      .limit(1);
    if (!workspace || !member) return;
    const { notifyWorkspaceJoined } = await import("@/lib/notifications");
    await notifyWorkspaceJoined({
      workspaceId: invitation.workspaceId,
      workspaceName: workspace.name,
      member,
      inviterId: invitation.invitedById,
    });
  });

  return invitation.workspaceId;
}

/** Re-send a pending invitation email (admins only). */
export async function resendInvitation(opts: {
  userId: string;
  workspaceId: string;
  invitationId: string;
}) {
  const membership = await requireMembership(
    opts.userId,
    opts.workspaceId,
    "admin",
  );
  if (!canInvite(membership.role)) throw new Error("FORBIDDEN");

  const db = getDb();
  const [invitation] = await db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, opts.invitationId),
        eq(workspaceInvitations.workspaceId, opts.workspaceId),
        eq(workspaceInvitations.status, "pending"),
      ),
    )
    .limit(1);
  if (!invitation) throw new Error("NOT_FOUND");

  const [workspace] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, opts.workspaceId))
    .limit(1);
  const [inviter] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, opts.userId))
    .limit(1);

  // Refresh the expiry so the resent link stays usable for a full week.
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  await db
    .update(workspaceInvitations)
    .set({ lastSentAt: new Date(), expiresAt })
    .where(eq(workspaceInvitations.id, invitation.id));

  await sendWorkspaceInvitationEmail({
    to: invitation.email,
    workspaceName: workspace?.name ?? "your workspace",
    inviterName: inviter?.name ?? "A teammate",
    token: invitation.token,
  });

  return invitation;
}

export async function expireOldInvitations() {
  const db = getDb();
  const result = await db
    .update(workspaceInvitations)
    .set({ status: "expired" })
    .where(
      and(
        eq(workspaceInvitations.status, "pending"),
        lt(workspaceInvitations.expiresAt, new Date()),
      ),
    )
    .returning({ id: workspaceInvitations.id });
  return result.length;
}

export async function pruneOldDocumentVersions(retainPerDocument = 50) {
  const { sql } = await import("drizzle-orm");
  const db = getDb();
  const result = await db.execute(sql`
    DELETE FROM document_versions
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY version DESC) AS rn
        FROM document_versions
      ) ranked
      WHERE rn > ${retainPerDocument}
    )
  `);
  return result;
}

export { canManageWorkspace };

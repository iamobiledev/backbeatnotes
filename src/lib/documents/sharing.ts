import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  getDb,
  documents,
  documentPermissions,
  documentInvitations,
  workspaces,
  user,
} from "@/db";
import { getMembership } from "@/lib/permissions";
import {
  computeDocumentAccess,
  canShare,
  canView,
  type DocumentAccess,
  type DocumentPermissionLevel,
} from "./access";
import { getDocumentWithAccess, getDirectPermission } from "./service";
import { recordDocumentActivity } from "./activity";
import {
  sendDocumentSharedEmail,
  sendDocumentInvitationEmail,
} from "@/lib/email";
import { getAppUrl } from "@/env/server";
import { logger } from "@/lib/logger";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type {
  GeneralAccess,
  SharePerson,
  SharePendingInvitation,
  DocumentSharing,
} from "./types";
import type {
  GeneralAccess,
  SharePerson,
  DocumentSharing,
} from "./types";

export type ShareOutcome = "shared" | "invited" | "already" | "self";

const ACCESS_RANK: Record<DocumentAccess, number> = {
  none: 0,
  viewer: 1,
  editor: 2,
  full: 3,
};

function accessForLevel(level: DocumentPermissionLevel): DocumentAccess {
  return level === "full_access"
    ? "full"
    : level === "edit"
      ? "editor"
      : "viewer";
}

async function requireShareManager(userId: string, documentId: string) {
  const result = await getDocumentWithAccess(userId, documentId);
  if (!result) throw new Error("NOT_FOUND");
  if (!canShare(result.access)) throw new Error("FORBIDDEN");
  return result;
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                     */
/* -------------------------------------------------------------------------- */

/** Everything the Share popover needs. Caller must have view access. */
export async function listDocumentSharing(
  userId: string,
  documentId: string,
): Promise<DocumentSharing> {
  const result = await getDocumentWithAccess(userId, documentId);
  if (!result) throw new Error("NOT_FOUND");
  if (!canView(result.access)) throw new Error("FORBIDDEN");
  const { doc } = result;

  const db = getDb();
  const [workspace] = await db
    .select({ name: workspaces.name, isPersonal: workspaces.isPersonal })
    .from(workspaces)
    .where(eq(workspaces.id, doc.workspaceId))
    .limit(1);

  const [creator] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.id, doc.createdById))
    .limit(1);

  const grants = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      level: documentPermissions.level,
      createdAt: documentPermissions.createdAt,
    })
    .from(documentPermissions)
    .innerJoin(user, eq(user.id, documentPermissions.userId))
    .where(eq(documentPermissions.documentId, doc.id))
    .orderBy(documentPermissions.createdAt);

  const pending = await db
    .select({
      invitationId: documentInvitations.id,
      email: documentInvitations.email,
      level: documentInvitations.level,
    })
    .from(documentInvitations)
    .where(
      and(
        eq(documentInvitations.documentId, doc.id),
        eq(documentInvitations.status, "pending"),
        gt(documentInvitations.expiresAt, new Date()),
      ),
    )
    .orderBy(documentInvitations.createdAt);

  const people: SharePerson[] = [];
  if (creator) {
    people.push({
      kind: "user",
      userId: creator.id,
      name: creator.name,
      email: creator.email,
      image: creator.image,
      level: "full_access",
      isCreator: true,
      isYou: creator.id === userId,
    });
  }
  for (const grant of grants) {
    if (grant.userId === doc.createdById) continue; // creator row already shown
    people.push({
      kind: "user",
      userId: grant.userId,
      name: grant.name,
      email: grant.email,
      image: grant.image,
      level: grant.level,
      isCreator: false,
      isYou: grant.userId === userId,
    });
  }

  return {
    canShare: canShare(result.access),
    // Personal-notebook pages are always effectively invite-only (the
    // workspace has exactly one member), regardless of the visibility flag.
    generalAccess:
      doc.visibility === "private" || workspace?.isPersonal
        ? "invited"
        : "workspace",
    workspaceName: workspace?.name ?? "workspace",
    isPersonal: workspace?.isPersonal ?? false,
    published: doc.publishedAt !== null,
    publicSlug: doc.publicSlug,
    people,
    invitations: pending.map((p) => ({ kind: "invitation" as const, ...p })),
  };
}

/* -------------------------------------------------------------------------- */
/* Sharing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Share a page with a list of emails at a given level.
 * - Existing users get a document_permissions row + a notification email.
 * - Unknown emails get a pending document_invitations row + an invite email.
 * - People who already have equal-or-higher access are reported as "already".
 */
export async function shareDocument(opts: {
  userId: string;
  documentId: string;
  emails: string[];
  level: DocumentPermissionLevel;
}): Promise<Array<{ email: string; outcome: ShareOutcome }>> {
  const result = await requireShareManager(opts.userId, opts.documentId);
  const { doc } = result;
  const db = getDb();

  const [sharer] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, opts.userId))
    .limit(1);
  const documentUrl = `${getAppUrl()}/app/${doc.workspaceId}/docs/${doc.id}`;
  const requestedRank = ACCESS_RANK[accessForLevel(opts.level)];

  const outcomes: Array<{ email: string; outcome: ShareOutcome }> = [];
  const sharedWith: string[] = [];

  for (const raw of opts.emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;

    if (email === sharer?.email.toLowerCase()) {
      outcomes.push({ email, outcome: "self" });
      continue;
    }

    const [target] = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (!target) {
      // No account yet — pending invitation (converted on accept).
      const [existing] = await db
        .select({ id: documentInvitations.id })
        .from(documentInvitations)
        .where(
          and(
            eq(documentInvitations.documentId, doc.id),
            eq(documentInvitations.email, email),
            eq(documentInvitations.status, "pending"),
          ),
        )
        .limit(1);

      const token = nanoid(32);
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
      if (existing) {
        await db
          .update(documentInvitations)
          .set({ level: opts.level, expiresAt, lastSentAt: new Date() })
          .where(eq(documentInvitations.id, existing.id));
      } else {
        await db.insert(documentInvitations).values({
          id: nanoid(),
          documentId: doc.id,
          email,
          level: opts.level,
          token,
          status: "pending",
          invitedById: opts.userId,
          expiresAt,
        });
      }

      // Email failures must not lose the invitation.
      try {
        const [row] = await db
          .select({ token: documentInvitations.token })
          .from(documentInvitations)
          .where(
            and(
              eq(documentInvitations.documentId, doc.id),
              eq(documentInvitations.email, email),
              eq(documentInvitations.status, "pending"),
            ),
          )
          .limit(1);
        await sendDocumentInvitationEmail({
          to: email,
          sharerName: sharer?.name ?? "A teammate",
          documentTitle: doc.title,
          token: row?.token ?? token,
        });
      } catch (error) {
        logger.error("document_share.invite_email_failed", {
          documentId: doc.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      outcomes.push({ email, outcome: "invited" });
      sharedWith.push(email);
      continue;
    }

    // Existing user: skip when they already have equal-or-higher access.
    const [membership, directPermission] = await Promise.all([
      getMembership(target.id, doc.workspaceId),
      getDirectPermission(target.id, doc.id),
    ]);
    const currentAccess = computeDocumentAccess({
      visibility: doc.visibility,
      isCreator: doc.createdById === target.id,
      membershipRole: membership?.role ?? null,
      directPermission,
      archived: false,
      docType: doc.docType,
      locked: doc.lockedAt !== null,
    });
    if (ACCESS_RANK[currentAccess] >= requestedRank) {
      outcomes.push({ email, outcome: "already" });
      continue;
    }

    await db
      .insert(documentPermissions)
      .values({
        id: nanoid(),
        documentId: doc.id,
        userId: target.id,
        level: opts.level,
        invitedById: opts.userId,
      })
      .onConflictDoUpdate({
        target: [documentPermissions.documentId, documentPermissions.userId],
        set: { level: opts.level, updatedAt: new Date() },
      });

    try {
      await sendDocumentSharedEmail({
        to: target.email,
        recipientName: target.name,
        sharerName: sharer?.name ?? "A teammate",
        documentTitle: doc.title,
        level: opts.level,
        documentUrl,
      });
    } catch (error) {
      logger.error("document_share.email_failed", {
        documentId: doc.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    outcomes.push({ email, outcome: "shared" });
    sharedWith.push(email);
  }

  if (sharedWith.length > 0) {
    await recordDocumentActivity({
      documentId: doc.id,
      userId: opts.userId,
      action: "shared",
      metadata: { emails: sharedWith, level: opts.level },
    });
    logger.info("document.shared", {
      documentId: doc.id,
      count: sharedWith.length,
      level: opts.level,
    });
  }

  return outcomes;
}

/* -------------------------------------------------------------------------- */
/* Managing permissions                                                        */
/* -------------------------------------------------------------------------- */

export async function updateDocumentPermission(opts: {
  userId: string;
  documentId: string;
  targetUserId: string;
  level: DocumentPermissionLevel;
}) {
  const result = await requireShareManager(opts.userId, opts.documentId);
  // The creator's implicit full access can't be demoted.
  if (opts.targetUserId === result.doc.createdById) {
    throw new Error("CREATOR_PERMANENT");
  }

  const db = getDb();
  const [updated] = await db
    .update(documentPermissions)
    .set({ level: opts.level, updatedAt: new Date() })
    .where(
      and(
        eq(documentPermissions.documentId, opts.documentId),
        eq(documentPermissions.userId, opts.targetUserId),
      ),
    )
    .returning();
  if (!updated) throw new Error("NOT_FOUND");
  return updated;
}

export async function removeDocumentPermission(opts: {
  userId: string;
  documentId: string;
  targetUserId: string;
}) {
  const result = await requireShareManager(opts.userId, opts.documentId);
  if (opts.targetUserId === result.doc.createdById) {
    throw new Error("CREATOR_PERMANENT");
  }

  const db = getDb();
  const [removed] = await db
    .delete(documentPermissions)
    .where(
      and(
        eq(documentPermissions.documentId, opts.documentId),
        eq(documentPermissions.userId, opts.targetUserId),
      ),
    )
    .returning();
  if (!removed) throw new Error("NOT_FOUND");

  await recordDocumentActivity({
    documentId: opts.documentId,
    userId: opts.userId,
    action: "unshared",
    metadata: { targetUserId: opts.targetUserId },
  });
  return removed;
}

export async function revokeDocumentInvitation(opts: {
  userId: string;
  documentId: string;
  invitationId: string;
}) {
  await requireShareManager(opts.userId, opts.documentId);
  const db = getDb();
  await db
    .update(documentInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(documentInvitations.id, opts.invitationId),
        eq(documentInvitations.documentId, opts.documentId),
        eq(documentInvitations.status, "pending"),
      ),
    );
}

/* -------------------------------------------------------------------------- */
/* General access                                                              */
/* -------------------------------------------------------------------------- */

/**
 * "Only people invited" (private) vs "Everyone at {workspace}" (workspace).
 * Personal-notebook pages are always invite-only.
 */
export async function setGeneralAccess(opts: {
  userId: string;
  documentId: string;
  access: GeneralAccess;
}) {
  const result = await requireShareManager(opts.userId, opts.documentId);
  const { doc } = result;

  const db = getDb();
  if (opts.access === "workspace") {
    const [workspace] = await db
      .select({ isPersonal: workspaces.isPersonal })
      .from(workspaces)
      .where(eq(workspaces.id, doc.workspaceId))
      .limit(1);
    if (workspace?.isPersonal) throw new Error("PERSONAL_INVITE_ONLY");
  }

  const visibility = opts.access === "invited" ? "private" : "workspace";
  if (doc.visibility === visibility) return doc;

  const [updated] = await db
    .update(documents)
    .set({ visibility, updatedAt: new Date(), updatedById: opts.userId })
    .where(eq(documents.id, doc.id))
    .returning();

  await recordDocumentActivity({
    documentId: doc.id,
    userId: opts.userId,
    action: "general_access_changed",
    metadata: { access: opts.access },
  });
  logger.info("document.general_access", {
    documentId: doc.id,
    access: opts.access,
  });
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Accepting document invitations                                              */
/* -------------------------------------------------------------------------- */

export async function getDocumentInvitationByToken(token: string) {
  const db = getDb();
  const [invitation] = await db
    .select({
      id: documentInvitations.id,
      email: documentInvitations.email,
      level: documentInvitations.level,
      status: documentInvitations.status,
      expiresAt: documentInvitations.expiresAt,
      documentId: documentInvitations.documentId,
      documentTitle: documents.title,
      workspaceId: documents.workspaceId,
      inviterName: user.name,
    })
    .from(documentInvitations)
    .innerJoin(documents, eq(documents.id, documentInvitations.documentId))
    .leftJoin(user, eq(user.id, documentInvitations.invitedById))
    .where(eq(documentInvitations.token, token))
    .limit(1);
  return invitation ?? null;
}

/** Convert a pending document invitation into a permission row. */
export async function acceptDocumentInvitation(opts: {
  userId: string;
  userEmail: string;
  token: string;
}) {
  const db = getDb();
  const [invitation] = await db
    .select()
    .from(documentInvitations)
    .where(eq(documentInvitations.token, opts.token))
    .limit(1);

  if (!invitation) throw new Error("NOT_FOUND");
  if (invitation.status !== "pending") throw new Error("INVITATION_INACTIVE");
  if (invitation.expiresAt.getTime() < Date.now()) {
    await db
      .update(documentInvitations)
      .set({ status: "expired" })
      .where(eq(documentInvitations.id, invitation.id));
    throw new Error("INVITATION_EXPIRED");
  }
  if (invitation.email.toLowerCase() !== opts.userEmail.toLowerCase()) {
    throw new Error("EMAIL_MISMATCH");
  }

  await db
    .insert(documentPermissions)
    .values({
      id: nanoid(),
      documentId: invitation.documentId,
      userId: opts.userId,
      level: invitation.level,
      invitedById: invitation.invitedById,
    })
    .onConflictDoUpdate({
      target: [documentPermissions.documentId, documentPermissions.userId],
      set: { level: invitation.level, updatedAt: new Date() },
    });

  await db
    .update(documentInvitations)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(documentInvitations.id, invitation.id));

  const [doc] = await db
    .select({ workspaceId: documents.workspaceId })
    .from(documents)
    .where(eq(documents.id, invitation.documentId))
    .limit(1);

  logger.info("document.invitation_accepted", {
    documentId: invitation.documentId,
    userId: opts.userId,
  });
  return {
    documentId: invitation.documentId,
    workspaceId: doc?.workspaceId ?? "",
  };
}

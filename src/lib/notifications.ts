import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  getDb,
  notificationLog,
  user as userTable,
  workspaces,
  type Document,
} from "@/db";
import { getAppUrl } from "@/env/server";
import {
  sendDocumentActivityEmail,
  sendWorkspaceJoinedEmail,
  sendInvitationAcceptedEmail,
} from "@/lib/email";
import { getDocumentParticipantIds } from "@/lib/documents/activity";
import { logger } from "@/lib/logger";

/**
 * Outbound email notifications.
 *
 * Document-activity emails are throttled: at most one email per recipient
 * per document per DOC_ACTIVITY_THROTTLE_MS (checked + recorded in the
 * notification_log table), and each recipient can opt out entirely
 * (user.email_notifications).
 *
 * Everything here is fire-and-forget from the caller's perspective —
 * failures are logged and never break the triggering operation.
 */

export const DOC_ACTIVITY_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours
const DOC_ACTIVITY_TYPE = "doc-activity";

/**
 * Notify the document's participants (creator + previous editors) that
 * `actor` made changes.
 */
export async function notifyDocumentEdited(opts: {
  doc: Pick<Document, "id" | "workspaceId" | "title" | "createdById">;
  actorId: string;
  actorName: string;
}): Promise<void> {
  try {
    const db = getDb();

    const participantIds = new Set(await getDocumentParticipantIds(opts.doc.id));
    participantIds.add(opts.doc.createdById);
    participantIds.delete(opts.actorId);
    if (participantIds.size === 0) return;

    const recipients = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        emailNotifications: userTable.emailNotifications,
        emailVerified: userTable.emailVerified,
      })
      .from(userTable)
      .where(inArray(userTable.id, [...participantIds]));

    const [workspace] = await db
      .select({ name: workspaces.name, isPersonal: workspaces.isPersonal })
      .from(workspaces)
      .where(eq(workspaces.id, opts.doc.workspaceId))
      .limit(1);
    // Personal notebooks have no other participants worth emailing.
    if (!workspace || workspace.isPersonal) return;

    const documentUrl = `${getAppUrl()}/app/${opts.doc.workspaceId}/docs/${opts.doc.id}`;
    const windowStart = new Date(Date.now() - DOC_ACTIVITY_THROTTLE_MS);

    for (const recipient of recipients) {
      if (!recipient.emailNotifications || !recipient.emailVerified) continue;

      // Throttle: skip when this recipient already got an email for this
      // document within the window.
      const [recent] = await db
        .select({ id: notificationLog.id })
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.recipientId, recipient.id),
            eq(notificationLog.documentId, opts.doc.id),
            eq(notificationLog.type, DOC_ACTIVITY_TYPE),
            gt(notificationLog.sentAt, windowStart),
          ),
        )
        .limit(1);
      if (recent) continue;

      // Record first (acts as the throttle claim), then send.
      await db.insert(notificationLog).values({
        id: nanoid(),
        recipientId: recipient.id,
        documentId: opts.doc.id,
        type: DOC_ACTIVITY_TYPE,
      });

      await sendDocumentActivityEmail({
        to: recipient.email,
        recipientName: recipient.name,
        actorName: opts.actorName,
        documentTitle: opts.doc.title,
        workspaceName: workspace.name,
        documentUrl,
      });
      logger.info("notify.doc_activity_sent", {
        documentId: opts.doc.id,
        recipientId: recipient.id,
      });
    }
  } catch (error) {
    logger.error("notify.doc_activity_failed", {
      documentId: opts.doc.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Emails sent when an invitation is accepted. */
export async function notifyWorkspaceJoined(opts: {
  workspaceId: string;
  workspaceName: string;
  member: { name: string; email: string };
  inviterId: string;
}): Promise<void> {
  try {
    const db = getDb();
    const workspaceUrl = `${getAppUrl()}/app/${opts.workspaceId}`;

    await sendWorkspaceJoinedEmail({
      to: opts.member.email,
      memberName: opts.member.name,
      workspaceName: opts.workspaceName,
      workspaceUrl,
    });

    const [inviter] = await db
      .select({ name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, opts.inviterId))
      .limit(1);
    if (inviter && inviter.email !== opts.member.email) {
      await sendInvitationAcceptedEmail({
        to: inviter.email,
        inviterName: inviter.name,
        memberName: opts.member.name,
        memberEmail: opts.member.email,
        workspaceName: opts.workspaceName,
        workspaceUrl,
      });
    }
    logger.info("notify.workspace_joined_sent", {
      workspaceId: opts.workspaceId,
    });
  } catch (error) {
    logger.error("notify.workspace_joined_failed", {
      workspaceId: opts.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

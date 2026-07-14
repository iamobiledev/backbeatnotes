import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  getDb,
  documentActivity,
  user as userTable,
  type Database,
} from "@/db";
import { logger } from "@/lib/logger";

/**
 * Per-document audit log ("who made what changes").
 *
 * `edited` entries are coalesced: consecutive autosaves by the same user
 * within EDIT_COALESCE_WINDOW_MS extend the existing entry instead of
 * creating a new row — the log stays readable with many people editing.
 */

export const EDIT_COALESCE_WINDOW_MS = 15 * 60 * 1000;

export type ActivityAction =
  | "created"
  | "edited"
  | "renamed"
  | "moved"
  | "trashed"
  | "restored"
  | "published"
  | "unpublished"
  | "version_restored"
  | "locked"
  | "unlocked"
  | "shared"
  | "unshared"
  | "general_access_changed";

export async function recordDocumentActivity(opts: {
  documentId: string;
  userId: string;
  action: ActivityAction;
  metadata?: Record<string, unknown>;
  db?: Database;
}): Promise<void> {
  const db = opts.db ?? getDb();
  try {
    if (opts.action === "edited") {
      // Coalesce with the user's own recent edit entry.
      const windowStart = new Date(Date.now() - EDIT_COALESCE_WINDOW_MS);
      const [recent] = await db
        .select({
          id: documentActivity.id,
          metadata: documentActivity.metadata,
        })
        .from(documentActivity)
        .where(
          and(
            eq(documentActivity.documentId, opts.documentId),
            eq(documentActivity.userId, opts.userId),
            eq(documentActivity.action, "edited"),
            gt(documentActivity.updatedAt, windowStart),
          ),
        )
        .orderBy(desc(documentActivity.updatedAt))
        .limit(1);

      if (recent) {
        const previousDelta = Number(
          (recent.metadata as { charDelta?: number }).charDelta ?? 0,
        );
        const newDelta = Number(
          (opts.metadata as { charDelta?: number } | undefined)?.charDelta ?? 0,
        );
        await db
          .update(documentActivity)
          .set({
            updatedAt: new Date(),
            metadata: {
              ...recent.metadata,
              ...opts.metadata,
              charDelta: previousDelta + newDelta,
            },
          })
          .where(eq(documentActivity.id, recent.id));
        return;
      }
    }

    await db.insert(documentActivity).values({
      id: nanoid(),
      documentId: opts.documentId,
      userId: opts.userId,
      action: opts.action,
      metadata: opts.metadata ?? {},
    });
  } catch (error) {
    // The audit log must never break the underlying operation.
    logger.error("activity.record_failed", {
      documentId: opts.documentId,
      action: opts.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type ActivityEntry = {
  id: string;
  action: ActivityAction;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  userName: string | null;
  userImage: string | null;
};

/** Newest-first activity for a document (access checked by the caller). */
export async function listDocumentActivity(
  documentId: string,
  limit = 50,
): Promise<ActivityEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: documentActivity.id,
      action: documentActivity.action,
      metadata: documentActivity.metadata,
      createdAt: documentActivity.createdAt,
      updatedAt: documentActivity.updatedAt,
      userName: userTable.name,
      userImage: userTable.image,
    })
    .from(documentActivity)
    .leftJoin(userTable, eq(userTable.id, documentActivity.userId))
    .where(eq(documentActivity.documentId, documentId))
    .orderBy(desc(documentActivity.updatedAt))
    .limit(limit);
  return rows as ActivityEntry[];
}

/**
 * Users who have participated in a document (any recorded action).
 * Used to pick email-notification recipients.
 */
export async function getDocumentParticipantIds(
  documentId: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ userId: documentActivity.userId })
    .from(documentActivity)
    .where(eq(documentActivity.documentId, documentId));
  return rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
}

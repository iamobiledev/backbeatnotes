import "server-only";
import { desc, eq, sql } from "drizzle-orm";
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
      const windowStart = new Date(Date.now() - EDIT_COALESCE_WINDOW_MS);
      const newDelta = Number(
        (opts.metadata as { charDelta?: number } | undefined)?.charDelta ?? 0,
      );
      const metadata = JSON.stringify(opts.metadata ?? {});
      const id = nanoid();

      // Claim/update the latest edit session or insert a new one in a single
      // statement. This removes a full Neon round trip from every autosave and
      // prevents concurrent saves from creating avoidable duplicate sessions.
      await db.execute(sql`
        WITH recent AS (
          SELECT id
          FROM document_activity
          WHERE document_id = ${opts.documentId}
            AND user_id = ${opts.userId}
            AND action = 'edited'
            AND updated_at > ${windowStart}
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE
        ),
        updated AS (
          UPDATE document_activity activity
          SET
            updated_at = NOW(),
            metadata =
              activity.metadata ||
              ${metadata}::jsonb ||
              jsonb_build_object(
                'charDelta',
                COALESCE((activity.metadata->>'charDelta')::int, 0) +
                ${newDelta}
              )
          FROM recent
          WHERE activity.id = recent.id
          RETURNING activity.id
        )
        INSERT INTO document_activity (
          id,
          document_id,
          user_id,
          action,
          metadata
        )
        SELECT
          ${id},
          ${opts.documentId},
          ${opts.userId},
          'edited',
          ${metadata}::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM updated)
      `);
      return;
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

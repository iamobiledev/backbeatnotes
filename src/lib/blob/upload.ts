import "server-only";
import { del } from "@vercel/blob";
import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb, files } from "@/db";
import { getServerEnv } from "@/env/server";
import { requireMembership } from "@/lib/permissions";
import { logger } from "@/lib/logger";

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
]);

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export type UploadKind =
  | "avatar"
  | "workspace-icon"
  | "document-image"
  | "cover-image"
  | "attachment";

/**
 * Soft-delete a file. Blob object is removed only when no other
 * non-deleted file row (or document version reference) still points at it.
 */
export async function softDeleteFile(opts: {
  fileId: string;
  userId: string;
  workspaceId: string;
}) {
  await requireMembership(opts.userId, opts.workspaceId, "member");
  const db = getDb();

  const [file] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, opts.fileId),
        eq(files.workspaceId, opts.workspaceId),
        isNull(files.deletedAt),
      ),
    )
    .limit(1);

  if (!file) {
    throw new Error("NOT_FOUND");
  }

  await db
    .update(files)
    .set({ deletedAt: new Date() })
    .where(eq(files.id, file.id));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(files)
    .where(
      and(eq(files.blobPathname, file.blobPathname), isNull(files.deletedAt)),
    );

  if (Number(count) === 0) {
    const env = getServerEnv();
    if (env.BLOB_READ_WRITE_TOKEN) {
      try {
        await del(file.blobUrl, { token: env.BLOB_READ_WRITE_TOKEN });
        logger.info("blob.deleted", { pathname: file.blobPathname });
      } catch (error) {
        logger.warn("blob.delete_failed", {
          pathname: file.blobPathname,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

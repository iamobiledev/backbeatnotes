import { NextResponse } from "next/server";
import { head } from "@vercel/blob";
import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, files } from "@/db";
import { getSession } from "@/lib/session";
import { requireMembership } from "@/lib/permissions";
import {
  getDocumentWithAccess,
} from "@/lib/documents/service";
import { canEdit } from "@/lib/documents/access";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
} from "@/lib/blob/upload";
import { getServerEnv } from "@/env/server";
import { logger } from "@/lib/logger";

const uploadRequestSchema = z.object({
  workspaceId: z.string().min(1).max(100),
  documentId: z.string().min(1).max(100).optional(),
  kind: z.enum([
    "avatar",
    "workspace-icon",
    "document-image",
    "cover-image",
    "attachment",
  ]),
  access: z.enum(["private", "workspace", "public"]).default("workspace"),
  originalFilename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  fileSize: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
});

const completionPayloadSchema = uploadRequestSchema.extend({
  id: z.string().min(1),
  uploadedById: z.string().min(1),
  pathnamePrefix: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    if (!env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
    }
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      token: env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await getSession();
        if (!session?.user) throw new Error("UNAUTHORIZED");
        const payload = uploadRequestSchema.parse(
          JSON.parse(clientPayload ?? "{}"),
        );
        if (!ALLOWED_UPLOAD_MIME_TYPES.has(payload.mimeType)) {
          throw new Error(`Unsupported file type: ${payload.mimeType}`);
        }

        await requireMembership(
          session.user.id,
          payload.workspaceId,
          "member",
        );
        if (payload.documentId) {
          const document = await getDocumentWithAccess(
            session.user.id,
            payload.documentId,
          );
          if (
            !document ||
            document.doc.workspaceId !== payload.workspaceId ||
            !canEdit(document.access)
          ) {
            throw new Error("FORBIDDEN");
          }
        }

        const pathnamePrefix =
          `workspaces/${payload.workspaceId}/${payload.kind}/`;
        const basename = pathname.slice(pathnamePrefix.length);
        if (
          !pathname.startsWith(pathnamePrefix) ||
          !basename ||
          basename.includes("/") ||
          basename.includes("..")
        ) {
          throw new Error("INVALID_PATHNAME");
        }

        return {
          allowedContentTypes: [payload.mimeType],
          maximumSizeInBytes: MAX_UPLOAD_SIZE_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            ...payload,
            id: nanoid(),
            uploadedById: session.user.id,
            pathnamePrefix,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = completionPayloadSchema.parse(
          JSON.parse(tokenPayload ?? "{}"),
        );
        if (
          !blob.pathname.startsWith(payload.pathnamePrefix) ||
          blob.contentType !== payload.mimeType
        ) {
          throw new Error("INVALID_UPLOAD_COMPLETION");
        }

        const metadata = await head(blob.url, {
          token: env.BLOB_READ_WRITE_TOKEN,
        });
        if (
          metadata.size <= 0 ||
          metadata.size > MAX_UPLOAD_SIZE_BYTES ||
          metadata.contentType !== payload.mimeType
        ) {
          throw new Error("INVALID_UPLOAD_COMPLETION");
        }

        const db = getDb();
        const inserted = await db
          .insert(files)
          .values({
            id: payload.id,
            workspaceId: payload.workspaceId,
            uploadedById: payload.uploadedById,
            documentId: payload.documentId,
            blobUrl: blob.url,
            blobPathname: blob.pathname,
            originalFilename: payload.originalFilename,
            mimeType: payload.mimeType,
            fileSize: metadata.size,
            access: payload.access,
          })
          .onConflictDoNothing({ target: files.blobPathname })
          .returning({ id: files.id });
        if (inserted.length > 0) {
          logger.info("blob.uploaded", {
            fileId: payload.id,
            workspaceId: payload.workspaceId,
            kind: payload.kind,
            size: metadata.size,
          });
        }
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("api.upload.error", { error: message });
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "FORBIDDEN"
        ? 403
        : error instanceof z.ZodError ||
            message.startsWith("Unsupported") ||
            message === "INVALID_PATHNAME"
          ? 400
          : 500;
    return NextResponse.json(
      { error: status >= 500 ? "Upload failed" : message },
      { status },
    );
  }
}

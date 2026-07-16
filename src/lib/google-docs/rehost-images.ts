import "server-only";
import { put } from "@vercel/blob";
import { nanoid } from "nanoid";
import { getDb, files } from "@/db";
import { getServerEnv } from "@/env/server";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
} from "@/lib/blob/upload";
import { logger } from "@/lib/logger";

function guessMimeFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".avif")) return "image/avif";
  return null;
}

function safeFilename(name: string): string {
  const sanitized = name
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return sanitized || "image";
}

function resolveZipPath(
  src: string,
  zipFiles: Map<string, Uint8Array>,
): { path: string; bytes: Uint8Array } | null {
  // Google HTML often uses relative paths like "images/image1.png".
  const candidates = [
    src,
    src.replace(/^\.\//, ""),
    decodeURIComponent(src),
    decodeURIComponent(src).replace(/^\.\//, ""),
  ];
  // Also try basename matches.
  const base = src.split("/").pop();
  if (base) {
    for (const [path, bytes] of zipFiles) {
      if (path === base || path.endsWith(`/${base}`)) {
        return { path, bytes };
      }
    }
  }
  for (const candidate of candidates) {
    const bytes = zipFiles.get(candidate);
    if (bytes) return { path: candidate, bytes };
  }
  return null;
}

export type RehostImagesResult = {
  imageSrcMap: Map<string, string>;
  imagesSkipped: number;
  uploadedFileIds: string[];
};

/**
 * Upload zip-local (or skip remote) images to Vercel Blob and build a src map.
 * When Blob is not configured, all images are skipped.
 */
export async function rehostImportImages(opts: {
  workspaceId: string;
  userId: string;
  documentId?: string;
  htmlImageSrcs: string[];
  zipFiles: Map<string, Uint8Array>;
}): Promise<RehostImagesResult> {
  const imageSrcMap = new Map<string, string>();
  const uploadedFileIds: string[] = [];
  let imagesSkipped = 0;

  const env = getServerEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    if (opts.htmlImageSrcs.length > 0) {
      logger.warn("google.import_images_skipped_no_blob", {
        workspaceId: opts.workspaceId,
        count: opts.htmlImageSrcs.length,
      });
    }
    return {
      imageSrcMap,
      imagesSkipped: opts.htmlImageSrcs.length,
      uploadedFileIds,
    };
  }

  const db = getDb();

  for (const src of opts.htmlImageSrcs) {
    if (imageSrcMap.has(src)) continue;

    // Skip remote Google URLs that aren't in the zip — they often require cookies.
    if (/^https?:\/\//i.test(src)) {
      imagesSkipped += 1;
      continue;
    }

    const resolved = resolveZipPath(src, opts.zipFiles);
    if (!resolved) {
      imagesSkipped += 1;
      continue;
    }

    const mime =
      guessMimeFromPath(resolved.path) ?? "application/octet-stream";
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(mime)) {
      imagesSkipped += 1;
      continue;
    }
    if (resolved.bytes.byteLength <= 0 || resolved.bytes.byteLength > MAX_UPLOAD_SIZE_BYTES) {
      imagesSkipped += 1;
      continue;
    }

    const fileId = nanoid();
    const filename = safeFilename(resolved.path.split("/").pop() ?? "image");
    const pathname = `workspaces/${opts.workspaceId}/document-image/${fileId}-${filename}`;

    try {
      const blob = await put(pathname, Buffer.from(resolved.bytes), {
        access: "public",
        token: env.BLOB_READ_WRITE_TOKEN,
        contentType: mime,
        addRandomSuffix: false,
      });

      await db.insert(files).values({
        id: fileId,
        workspaceId: opts.workspaceId,
        uploadedById: opts.userId,
        documentId: opts.documentId,
        blobUrl: blob.url,
        blobPathname: blob.pathname,
        originalFilename: filename,
        mimeType: mime,
        fileSize: resolved.bytes.byteLength,
        access: "workspace",
      });

      imageSrcMap.set(src, blob.url);
      uploadedFileIds.push(fileId);
    } catch (error) {
      imagesSkipped += 1;
      logger.warn("google.import_image_upload_failed", {
        path: resolved.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { imageSrcMap, imagesSkipped, uploadedFileIds };
}

/** Attach uploaded file rows to the document created after rehost. */
export async function attachFilesToDocument(opts: {
  fileIds: string[];
  documentId: string;
}) {
  if (opts.fileIds.length === 0) return;
  const db = getDb();
  const { inArray } = await import("drizzle-orm");
  await db
    .update(files)
    .set({ documentId: opts.documentId })
    .where(inArray(files.id, opts.fileIds));
}

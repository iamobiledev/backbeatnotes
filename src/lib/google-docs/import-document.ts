import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, documentImportSources } from "@/db";
import { importDocument } from "@/lib/documents/service";
import { requireMembership } from "@/lib/permissions";
import { getValidAccessToken } from "./service";
import {
  exportGoogleDocHtmlZip,
  getGoogleFileMeta,
} from "./client";
import { unzipHtmlExport } from "./zip";
import { collectImageSrcs, htmlToTiptap } from "./html-to-tiptap";
import {
  attachFilesToDocument,
  rehostImportImages,
} from "./rehost-images";
import { logger } from "@/lib/logger";

export const GOOGLE_DOCS_PROVIDER = "google_docs";

export type ImportGoogleDocResult = {
  documentId: string;
  title: string;
  skipped: boolean;
  imagesSkipped: number;
};

function googleDocUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${fileId}/edit`;
}

export async function findExistingImport(opts: {
  workspaceId: string;
  googleFileId: string;
}): Promise<{ documentId: string; title: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      documentId: documentImportSources.documentId,
      title: documentImportSources.externalTitle,
    })
    .from(documentImportSources)
    .where(
      and(
        eq(documentImportSources.workspaceId, opts.workspaceId),
        eq(documentImportSources.provider, GOOGLE_DOCS_PROVIDER),
        eq(documentImportSources.externalId, opts.googleFileId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Export a Google Doc and create a flat root-level BackBeat page.
 */
export async function importGoogleDoc(opts: {
  userId: string;
  workspaceId: string;
  googleFileId: string;
}): Promise<ImportGoogleDocResult> {
  await requireMembership(opts.userId, opts.workspaceId, "member");

  const existing = await findExistingImport({
    workspaceId: opts.workspaceId,
    googleFileId: opts.googleFileId,
  });
  if (existing) {
    throw new Error("ALREADY_IMPORTED");
  }

  const accessToken = await getValidAccessToken(opts.userId);
  const meta = await getGoogleFileMeta({
    accessToken,
    fileId: opts.googleFileId,
  });
  if (!meta.ok) {
    throw new Error(
      meta.error === "NOT_A_GOOGLE_DOC" ? "NOT_A_GOOGLE_DOC" : "EXPORT_FAILED",
    );
  }

  const exported = await exportGoogleDocHtmlZip({
    accessToken,
    fileId: opts.googleFileId,
  });
  if (!exported.ok) {
    throw new Error("EXPORT_FAILED");
  }

  let html: string;
  let zipFiles: Map<string, Uint8Array>;
  try {
    const unzipped = unzipHtmlExport(exported.bytes);
    html = unzipped.html;
    zipFiles = unzipped.files;
  } catch (error) {
    logger.error("google.import_unzip_failed", {
      fileId: opts.googleFileId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error("EXPORT_FAILED");
  }

  const htmlImageSrcs = collectImageSrcs(html);
  const { imageSrcMap, imagesSkipped, uploadedFileIds } =
    await rehostImportImages({
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      htmlImageSrcs,
      zipFiles,
    });

  const contentJson = htmlToTiptap(html, { imageSrcMap });
  const title = meta.name.trim() || "Untitled";

  const doc = await importDocument({
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    title,
    contentJson,
    activityMetadata: {
      importedFrom: GOOGLE_DOCS_PROVIDER,
      googleFileId: opts.googleFileId,
    },
  });

  await attachFilesToDocument({
    fileIds: uploadedFileIds,
    documentId: doc.id,
  });

  const db = getDb();
  try {
    await db.insert(documentImportSources).values({
      id: nanoid(),
      documentId: doc.id,
      workspaceId: opts.workspaceId,
      provider: GOOGLE_DOCS_PROVIDER,
      externalId: opts.googleFileId,
      externalUrl: meta.webViewLink ?? googleDocUrl(opts.googleFileId),
      externalTitle: title,
      importedById: opts.userId,
    });
  } catch (error) {
    // Unique violation = concurrent import of the same source.
    logger.warn("google.import_source_insert_failed", {
      documentId: doc.id,
      googleFileId: opts.googleFileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    documentId: doc.id,
    title: doc.title,
    skipped: false,
    imagesSkipped,
  };
}

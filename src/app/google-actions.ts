"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVerifiedSession } from "@/lib/session";
import { requireMembership } from "@/lib/permissions";
import { deleteConnection, getValidAccessToken } from "@/lib/google-docs/service";
import { isGoogleDocsConfigured } from "@/lib/google-docs/status";
import { listGoogleDocs } from "@/lib/google-docs/client";
import {
  findExistingImport,
  importGoogleDoc,
} from "@/lib/google-docs/import-document";
import { logger } from "@/lib/logger";

export type GoogleActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const FRIENDLY: Record<string, string> = {
  FORBIDDEN: "You don't have permission to do that.",
  GOOGLE_NOT_CONFIGURED: "Google Docs import isn't configured for this deployment.",
  GOOGLE_NOT_CONNECTED: "Connect your Google account first.",
  GOOGLE_TOKEN_REFRESH_FAILED:
    "Your Google connection expired. Disconnect and connect again.",
  NOT_A_GOOGLE_DOC: "That file isn't a Google Doc.",
  ALREADY_IMPORTED: "That Google Doc was already imported into this workspace.",
  EXPORT_FAILED: "Couldn't export that Google Doc. Try again.",
  IMPORT_FAILED: "Import failed. Please try again.",
};

function friendly(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return FRIENDLY[code] ?? "Something went wrong. Please try again.";
}

export async function actionDisconnectGoogle(input: {
  workspaceId: string;
}): Promise<GoogleActionResult<undefined>> {
  const session = await requireVerifiedSession();
  try {
    const parsed = z.object({ workspaceId: z.string().min(1) }).parse(input);
    await requireMembership(session.user.id, parsed.workspaceId, "member");
    await deleteConnection(session.user.id);
    revalidatePath(`/app/${parsed.workspaceId}/settings`);
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("google.disconnect_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: friendly(error) };
  }
}

export async function actionListGoogleDocs(input: {
  workspaceId: string;
  pageToken?: string | null;
  query?: string | null;
}): Promise<
  GoogleActionResult<{
    files: Array<{
      id: string;
      name: string;
      modifiedTime: string | null;
      webViewLink: string | null;
    }>;
    nextPageToken: string | null;
  }>
> {
  const session = await requireVerifiedSession();
  try {
    if (!isGoogleDocsConfigured()) throw new Error("GOOGLE_NOT_CONFIGURED");
    const parsed = z
      .object({
        workspaceId: z.string().min(1),
        pageToken: z.string().min(1).nullable().optional(),
        query: z.string().max(200).nullable().optional(),
      })
      .parse(input);
    await requireMembership(session.user.id, parsed.workspaceId, "member");
    const accessToken = await getValidAccessToken(session.user.id);
    const result = await listGoogleDocs({
      accessToken,
      pageToken: parsed.pageToken,
      query: parsed.query,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      data: {
        files: result.files,
        nextPageToken: result.nextPageToken,
      },
    };
  } catch (error) {
    logger.error("google.list_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: friendly(error) };
  }
}

export async function actionImportGoogleDoc(input: {
  workspaceId: string;
  googleFileId: string;
}): Promise<
  GoogleActionResult<{
    documentId: string;
    title: string;
    skipped: boolean;
    imagesSkipped: number;
  }>
> {
  const session = await requireVerifiedSession();
  try {
    if (!isGoogleDocsConfigured()) throw new Error("GOOGLE_NOT_CONFIGURED");
    const parsed = z
      .object({
        workspaceId: z.string().min(1),
        googleFileId: z.string().min(1).max(256),
      })
      .parse(input);
    await requireMembership(session.user.id, parsed.workspaceId, "member");
    const result = await importGoogleDoc({
      userId: session.user.id,
      workspaceId: parsed.workspaceId,
      googleFileId: parsed.googleFileId,
    });
    revalidatePath(`/app/${parsed.workspaceId}`, "layout");
    return { ok: true, data: result };
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === "ALREADY_IMPORTED") {
      // Surface as a soft skip so bulk import can continue cleanly.
      const existing = await findExistingImport({
        workspaceId: input.workspaceId,
        googleFileId: input.googleFileId,
      }).catch(() => null);
      return {
        ok: true,
        data: {
          documentId: existing?.documentId ?? "",
          title: existing?.title ?? "",
          skipped: true,
          imagesSkipped: 0,
        },
      };
    }
    logger.error("google.import_failed", {
      error: code,
      googleFileId: input.googleFileId,
    });
    return { ok: false, error: friendly(error) };
  }
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { uploadWorkspaceFile } from "@/lib/blob/upload";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const workspaceId = String(formData.get("workspaceId") ?? "");
    const documentId = String(formData.get("documentId") ?? "") || undefined;
    const kind = String(formData.get("kind") ?? "document-image") as
      | "avatar"
      | "workspace-icon"
      | "document-image"
      | "cover-image"
      | "attachment";
    const access = (String(formData.get("access") ?? "workspace") ||
      "workspace") as "private" | "workspace" | "public";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }

    const record = await uploadWorkspaceFile({
      file,
      userId: session.user.id,
      workspaceId,
      documentId,
      kind,
      access,
    });

    return NextResponse.json({
      id: record.id,
      url: record.blobUrl,
      pathname: record.blobPathname,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("api.upload.error", { error: message });
    const status =
      message === "FORBIDDEN"
        ? 403
        : message.startsWith("Unsupported") || message.startsWith("File size")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

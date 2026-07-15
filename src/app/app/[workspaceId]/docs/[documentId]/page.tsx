import { notFound } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { FileQuestion, Trash2 } from "lucide-react";
import { requireVerifiedSession } from "@/lib/session";
import {
  getDocumentWithAccess,
  getDocumentAncestors,
  isFavorited,
  recordDocumentView,
  listUserWorkspaces,
  refreshSubpageTitles,
} from "@/lib/documents/service";
import { getWorkspaceById } from "@/lib/workspaces/service";
import { getSlackStatus } from "@/lib/slack/status";
import {
  canEdit as accessCanEdit,
  canManageWikiLock,
} from "@/lib/documents/access";
import { Lock } from "lucide-react";
import { DocumentEditorClient } from "./editor-client";
import { DocHeader } from "@/components/documents/doc-header";
import { RequestAccess } from "@/components/documents/request-access";
import { RestoreBanner } from "@/components/documents/restore-banner";
import { StaticDocument } from "@/components/documents/static-document";
import { Button } from "@/components/ui/button";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ workspaceId: string; documentId: string }>;
}) {
  const { workspaceId, documentId } = await params;
  const session = await requireVerifiedSession();
  const result = await getDocumentWithAccess(session.user.id, documentId);

  if (!result) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <FileQuestion className="h-10 w-10 text-[var(--muted-foreground)]" />
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-semibold">
          This page doesn’t exist
        </h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          It may have been permanently removed, or the link is wrong.
        </p>
        <Button asChild className="mt-6">
          <Link href="/app">Back to your workspaces</Link>
        </Button>
      </div>
    );
  }

  if (result.access === "none") {
    return <RequestAccess documentId={documentId} />;
  }

  const { doc } = result;
  if (doc.workspaceId !== workspaceId) notFound();

  const [ancestors, favorited, workspaces, slack, contentJson] =
    await Promise.all([
      getDocumentAncestors(doc.id),
      isFavorited(session.user.id, doc.id),
      listUserWorkspaces(session.user.id),
      getSlackStatus(doc.workspaceId),
      refreshSubpageTitles(doc.contentJson),
    ]);
  after(() => recordDocumentView(session.user.id, doc.id));

  // The viewer may not be a workspace member (page shared directly with
  // them) — fall back to loading the workspace and treating them as a guest.
  const membership = workspaces.find((w) => w.id === doc.workspaceId);
  const isWorkspaceMember = Boolean(membership);
  let workspace: {
    id: string;
    name: string;
    isPersonal: boolean;
    role: "owner" | "admin" | "member" | "guest";
  };
  if (membership) {
    workspace = {
      id: membership.id,
      name: membership.name,
      isPersonal: membership.isPersonal,
      role: membership.role,
    };
  } else {
    const shared = await getWorkspaceById(doc.workspaceId);
    if (!shared) notFound();
    workspace = {
      id: shared.id,
      name: shared.name,
      isPersonal: shared.isPersonal,
      role: "guest",
    };
  }

  const editable = accessCanEdit(result.access);
  const trashed = doc.archivedAt !== null;
  const locked = doc.lockedAt !== null;
  const manageLock =
    doc.docType === "wiki" &&
    isWorkspaceMember &&
    canManageWikiLock({
      membershipRole: workspace.role,
      platformRole: result.platformRole,
    });

  return (
    <div className="mx-auto max-w-3xl">
      {trashed ? (
        <RestoreBanner documentId={doc.id} workspaceId={doc.workspaceId} />
      ) : (
        <DocHeader
          doc={{
            id: doc.id,
            workspaceId: doc.workspaceId,
            title: doc.title,
            published: doc.publishedAt !== null,
            publicSlug: doc.publicSlug,
            docType: doc.docType,
            locked,
          }}
          isWorkspaceMember={isWorkspaceMember}
          canManageLock={manageLock}
          workspace={{
            id: workspace.id,
            name: workspace.name,
            isPersonal: workspace.isPersonal,
            role: workspace.role,
          }}
          ancestors={ancestors}
          favorited={favorited}
          canEdit={editable}
          slack={slack}
        />
      )}

      {trashed && (
        <div className="mb-4 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <Trash2 className="h-4 w-4" />
          This page is in the trash and is read-only.
        </div>
      )}

      {!trashed && doc.docType === "wiki" && locked && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--hero-wash)] px-3 py-2 text-sm text-[var(--primary)]">
          <Lock className="h-4 w-4 shrink-0" />
          {editable
            ? "This wiki is locked — you can edit it because you're an admin."
            : "This wiki is locked. Only admins can make changes."}
        </div>
      )}

      {!editable || trashed ? (
        <div>
          <h1 className="editor-title mb-2 text-4xl font-bold tracking-tight">
            {doc.title || "Untitled"}
          </h1>
          <StaticDocument contentJson={contentJson} />
        </div>
      ) : (
        <DocumentEditorClient
          documentId={doc.id}
          workspaceId={doc.workspaceId}
          initialTitle={doc.title}
          initialContent={contentJson}
          initialRevision={doc.revision}
        />
      )}
    </div>
  );
}

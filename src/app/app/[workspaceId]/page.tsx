import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Clock, FileText, Lock, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { requireVerifiedSession } from "@/lib/session";
import {
  getRecentDocuments,
  listWorkspaceDocuments,
  listFavoriteDocuments,
  listUserWorkspaces,
} from "@/lib/documents/service";
import { CreateDocumentButton } from "@/components/documents/create-document-button";
import { ImportGoogleDocsButton } from "@/components/documents/import-google-docs-button";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await requireVerifiedSession();
  const workspaces = await listUserWorkspaces(session.user.id);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) notFound();

  const [docs, recent, favorites] = await Promise.all([
    listWorkspaceDocuments(session.user.id, workspaceId),
    getRecentDocuments(session.user.id, workspaceId),
    listFavoriteDocuments(session.user.id, workspaceId),
  ]);

  const canEdit = workspace.role !== "guest";

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            {workspace.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {workspace.isPersonal
              ? "Only you can see the pages in your personal notebook."
              : `${docs.length} ${docs.length === 1 ? "page" : "pages"}`}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <ImportGoogleDocsButton workspaceId={workspaceId} />
            <CreateDocumentButton
              workspaceId={workspaceId}
              docType="wiki"
              label="New wiki"
              variant="outline"
              className="gap-1.5"
            />
            <CreateDocumentButton
              workspaceId={workspaceId}
              label="New page"
              className="gap-1.5"
            />
          </div>
        )}
      </div>

      {docs.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-[var(--border)] py-20 text-center">
          <FileText className="h-9 w-9 text-[var(--muted-foreground)]" />
          <h2 className="mt-4 text-lg font-medium">
            {workspace.isPersonal
              ? "Your notebook is empty"
              : "No pages here yet"}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">
            {canEdit
              ? "Create your first page to capture notes, docs, and ideas. Press N anywhere to start writing."
              : "Pages your teammates create will show up here."}
          </p>
          {canEdit && (
            <CreateDocumentButton
              workspaceId={workspaceId}
              label="Create your first page"
              className="mt-6 gap-1.5"
            />
          )}
        </div>
      ) : (
        <>
          {favorites.length > 0 && (
            <section aria-labelledby="favorites-heading">
              <h2
                id="favorites-heading"
                className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)]"
              >
                <Star className="h-3.5 w-3.5" />
                Favorites
              </h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {favorites.map((doc) => (
                  <li key={doc.id}>
                    <Link
                      href={`/app/${workspaceId}/docs/${doc.id}`}
                      className="block rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 transition-colors hover:border-[var(--primary)]"
                    >
                      <span className="block truncate font-medium">
                        {doc.icon && <span className="mr-1.5">{doc.icon}</span>}
                        {doc.title || "Untitled"}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                        Updated{" "}
                        {formatDistanceToNow(doc.updatedAt, {
                          addSuffix: true,
                        })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="recent-heading">
            <h2
              id="recent-heading"
              className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)]"
            >
              <Clock className="h-3.5 w-3.5" />
              Recent
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {recent.slice(0, 6).map((doc) => (
                <li key={doc.id}>
                  <Link
                    href={`/app/${workspaceId}/docs/${doc.id}`}
                    className="block rounded-md border border-transparent px-3 py-2 transition-colors hover:border-[var(--border)] hover:bg-[var(--card)]"
                  >
                    <span className="block truncate font-medium">
                      {doc.icon && <span className="mr-1.5">{doc.icon}</span>}
                      {doc.title || "Untitled"}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                      {formatDistanceToNow(doc.updatedAt, { addSuffix: true })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="all-heading">
            <h2
              id="all-heading"
              className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)]"
            >
              <FileText className="h-3.5 w-3.5" />
              All pages
            </h2>
            <ul className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Link
                    href={`/app/${workspaceId}/docs/${doc.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[var(--muted)]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      {doc.icon && <span>{doc.icon}</span>}
                      {doc.docType === "wiki" && (
                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                      )}
                      <span className="truncate">{doc.title || "Untitled"}</span>
                      {doc.lockedAt && (
                        <Lock className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" />
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--muted-foreground)]">
                      {doc.publishedAt && (
                        <span className="rounded-full bg-[var(--hero-wash)] px-2 py-0.5 font-medium text-[var(--primary)]">
                          Published
                        </span>
                      )}
                      {formatDistanceToNow(doc.updatedAt, { addSuffix: true })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

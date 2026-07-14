import { Suspense } from "react";
import { requireVerifiedSession, platformRoleOf } from "@/lib/session";
import {
  listUserWorkspaces,
  listWorkspaceDocumentTree,
  listAllFavoriteDocuments,
  listFavoriteDocumentIds,
  listSharedWithMe,
} from "@/lib/documents/service";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

export const unstable_instant = false;

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<WorkspaceShellLoading />}>
      <WorkspaceChrome params={params}>{children}</WorkspaceChrome>
    </Suspense>
  );
}

async function WorkspaceChrome({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await requireVerifiedSession();
  const workspaces = await listUserWorkspaces(session.user.id);

  // Viewing a workspace you're not a member of (e.g. a page shared directly
  // with you) keeps the familiar shell with your own sidebar — your personal
  // notebook acts as the "current" workspace.
  const workspace =
    workspaces.find((w) => w.id === workspaceId) ??
    workspaces.find((w) => w.isPersonal) ??
    workspaces[0];

  if (!workspace) {
    // No workspaces at all — render a bare shell. Document pages show the
    // request-access screen; everything else 404s at the page level.
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4">
        <div className="w-full">{children}</div>
      </div>
    );
  }

  // Notion-style sidebar: trees for every workspace (Private + Teamspaces).
  const [trees, favoriteDocs, favoriteIds, sharedDocs] = await Promise.all([
    Promise.all(
      workspaces.map(async (ws) => ({
        workspaceId: ws.id,
        nodes: await listWorkspaceDocumentTree(session.user.id, ws.id),
      })),
    ),
    listAllFavoriteDocuments(session.user.id),
    listFavoriteDocumentIds(session.user.id),
    listSharedWithMe(session.user.id),
  ]);

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      platformRole={platformRoleOf(session.user)}
      workspace={{
        id: workspace.id,
        name: workspace.name,
        isPersonal: workspace.isPersonal,
        role: workspace.role,
      }}
      workspaces={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        isPersonal: w.isPersonal,
        role: w.role,
      }))}
      trees={trees}
      favorites={favoriteDocs.map((f) => ({
        id: f.id,
        title: f.title,
        workspaceId: f.workspaceId,
      }))}
      favoriteIds={favoriteIds}
      shared={sharedDocs.map((s) => ({
        id: s.id,
        title: s.title,
        icon: s.icon,
        workspaceId: s.workspaceId,
      }))}
    >
      {children}
    </AppShell>
  );
}

function WorkspaceShellLoading() {
  return (
    <div
      className="flex min-h-screen w-full"
      aria-busy
      aria-label="Loading workspace"
    >
      <aside className="hidden h-screen w-60 shrink-0 space-y-3 border-r border-[var(--border)] bg-[var(--sidebar)] p-3 md:block">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-6 h-4 w-20" />
        {[...Array(6)].map((_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </aside>
      <div className="min-w-0 flex-1 p-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-8 h-12 w-2/3" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-3 h-4 w-5/6" />
      </div>
    </div>
  );
}

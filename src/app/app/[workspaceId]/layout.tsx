import { requireVerifiedSession, platformRoleOf } from "@/lib/session";
import {
  listUserWorkspaces,
  listWorkspaceDocumentTree,
  listAllFavoriteDocuments,
  listFavoriteDocumentIds,
} from "@/lib/documents/service";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await requireVerifiedSession();
  const workspaces = await listUserWorkspaces(session.user.id);
  const workspace = workspaces.find((w) => w.id === workspaceId);

  if (!workspace) {
    // Not a member — render a bare shell. Document pages show the
    // request-access screen; everything else 404s at the page level.
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4">
        <div className="w-full">{children}</div>
      </div>
    );
  }

  // Notion-style sidebar: trees for every workspace (Private + Teamspaces).
  const [trees, favoriteDocs, favoriteIds] = await Promise.all([
    Promise.all(
      workspaces.map(async (ws) => ({
        workspaceId: ws.id,
        nodes: await listWorkspaceDocumentTree(session.user.id, ws.id),
      })),
    ),
    listAllFavoriteDocuments(session.user.id),
    listFavoriteDocumentIds(session.user.id),
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
    >
      {children}
    </AppShell>
  );
}

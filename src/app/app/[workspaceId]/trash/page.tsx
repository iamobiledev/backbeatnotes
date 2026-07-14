import { notFound } from "next/navigation";
import { requireVerifiedSession } from "@/lib/session";
import {
  listTrashedDocuments,
  listUserWorkspaces,
} from "@/lib/documents/service";
import { TrashList } from "./trash-list";

export const metadata = { title: "Trash" };

export default async function TrashPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const session = await requireVerifiedSession();
  const workspaces = await listUserWorkspaces(session.user.id);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) notFound();

  const trashed = await listTrashedDocuments(session.user.id, workspaceId);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
        Trash
      </h1>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Trashed pages stay here until you restore them — nothing is permanently
        deleted from the app.
      </p>

      <TrashList
        workspaceId={workspaceId}
        items={trashed.map((item) => ({
          id: item.id,
          title: item.title,
          icon: item.icon,
          archivedAt: item.archivedAt?.toISOString() ?? null,
        }))}
        canRestore={workspace.role !== "guest"}
      />
    </div>
  );
}

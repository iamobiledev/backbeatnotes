export type WorkspaceRouteRef = {
  id: string;
  slug: string;
};

export function findWorkspaceByRouteKey<T extends WorkspaceRouteRef>(
  workspaces: readonly T[],
  routeKey: string,
): T | undefined {
  return workspaces.find(
    (workspace) =>
      workspace.slug === routeKey || workspace.id === routeKey,
  );
}

export function workspacePath(workspace: WorkspaceRouteRef): string {
  return `/app/${workspace.slug}`;
}

export function workspaceDocumentPath(
  workspace: WorkspaceRouteRef,
  documentId: string,
): string {
  return `${workspacePath(workspace)}/docs/${documentId}`;
}

export function workspacePathForId(
  workspaces: readonly WorkspaceRouteRef[],
  workspaceId: string,
): string {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  return workspace ? workspacePath(workspace) : `/app/${workspaceId}`;
}

export function workspaceDocumentPathForId(
  workspaces: readonly WorkspaceRouteRef[],
  workspaceId: string,
  documentId: string,
): string {
  return `${workspacePathForId(workspaces, workspaceId)}/docs/${documentId}`;
}

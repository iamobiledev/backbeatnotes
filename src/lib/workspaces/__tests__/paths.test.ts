import { describe, expect, it } from "vitest";
import {
  findWorkspaceByRouteKey,
  workspaceDocumentPath,
  workspaceDocumentPathForId,
  workspacePath,
  workspacePathForId,
} from "@/lib/workspaces/paths";

const workspaces = [
  { id: "opaque-id", slug: "rowsone" },
  { id: "personal-id", slug: "personal-notebook" },
];

describe("workspace URL paths", () => {
  it("uses the readable slug for workspace and document URLs", () => {
    expect(workspacePath(workspaces[0])).toBe("/app/rowsone");
    expect(workspaceDocumentPath(workspaces[0], "doc-id")).toBe(
      "/app/rowsone/docs/doc-id",
    );
  });

  it("resolves both canonical slugs and legacy IDs", () => {
    expect(findWorkspaceByRouteKey(workspaces, "rowsone")).toBe(workspaces[0]);
    expect(findWorkspaceByRouteKey(workspaces, "opaque-id")).toBe(
      workspaces[0],
    );
    expect(findWorkspaceByRouteKey(workspaces, "missing")).toBeUndefined();
  });

  it("maps related records from workspace IDs to slug URLs", () => {
    expect(workspacePathForId(workspaces, "personal-id")).toBe(
      "/app/personal-notebook",
    );
    expect(
      workspaceDocumentPathForId(workspaces, "opaque-id", "doc-id"),
    ).toBe("/app/rowsone/docs/doc-id");
  });

  it("keeps ID URLs as a compatibility fallback for unknown workspaces", () => {
    expect(workspacePathForId(workspaces, "shared-id")).toBe("/app/shared-id");
    expect(
      workspaceDocumentPathForId(workspaces, "shared-id", "doc-id"),
    ).toBe("/app/shared-id/docs/doc-id");
  });
});

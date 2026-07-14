import { describe, expect, it } from "vitest";
import {
  computeDocumentAccess,
  canManageWikiLock,
  canView,
  canEdit,
  canShare,
} from "@/lib/documents/access";
import type { WorkspaceRole } from "@/lib/roles";

/**
 * Security-sensitive: the full access decision matrix.
 * Personal notebooks are enforced by membership (single-member workspace),
 * so the matrix covers roles × visibility × creator × archived × direct
 * per-document shares (document_permissions).
 */
describe("computeDocumentAccess", () => {
  const roles: WorkspaceRole[] = ["owner", "admin", "member", "guest"];

  it("denies everything to non-members without a direct share", () => {
    for (const visibility of ["private", "workspace", "public"] as const) {
      expect(
        computeDocumentAccess({
          visibility,
          isCreator: false,
          membershipRole: null,
          archived: false,
        }),
      ).toBe("none");
    }
  });

  it("non-members get no access even as creator (revoked membership)", () => {
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: true,
        membershipRole: null,
        archived: false,
      }),
    ).toBe("none");
  });

  it("workspace-visible docs: guests view, members edit, admins/owners full", () => {
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: "guest",
        archived: false,
      }),
    ).toBe("viewer");
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: "member",
        archived: false,
      }),
    ).toBe("editor");
    for (const role of ["admin", "owner"] as const) {
      expect(
        computeDocumentAccess({
          visibility: "workspace",
          isCreator: false,
          membershipRole: role,
          archived: false,
        }),
      ).toBe("full");
    }
  });

  it("the creator (member+) gets full access to manage sharing", () => {
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: true,
        membershipRole: "member",
        archived: false,
      }),
    ).toBe("full");
    // Guests never get edit/full even as creator (defensive).
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: true,
        membershipRole: "guest",
        archived: false,
      }),
    ).toBe("viewer");
  });

  it('private ("Only people invited") docs exclude everyone but the creator and invitees', () => {
    for (const role of roles) {
      expect(
        computeDocumentAccess({
          visibility: "private",
          isCreator: false,
          membershipRole: role,
          archived: false,
        }),
      ).toBe("none");
    }
    expect(
      computeDocumentAccess({
        visibility: "private",
        isCreator: true,
        membershipRole: "member",
        archived: false,
      }),
    ).toBe("full");
  });

  it("direct shares grant page access to non-members", () => {
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: null,
        directPermission: "view",
        archived: false,
      }),
    ).toBe("viewer");
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: null,
        directPermission: "edit",
        archived: false,
      }),
    ).toBe("editor");
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: null,
        directPermission: "full_access",
        archived: false,
      }),
    ).toBe("full");
  });

  it("direct shares open up private docs (members and non-members)", () => {
    expect(
      computeDocumentAccess({
        visibility: "private",
        isCreator: false,
        membershipRole: null,
        directPermission: "view",
        archived: false,
      }),
    ).toBe("viewer");
    expect(
      computeDocumentAccess({
        visibility: "private",
        isCreator: false,
        membershipRole: "admin",
        directPermission: "edit",
        archived: false,
      }),
    ).toBe("editor");
  });

  it("final access is the max of membership and direct share", () => {
    // A guest with a direct edit share can edit.
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: "guest",
        directPermission: "edit",
        archived: false,
      }),
    ).toBe("editor");
    // A direct view share never demotes a member's edit access.
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: "member",
        directPermission: "view",
        archived: false,
      }),
    ).toBe("editor");
  });

  it("public (legacy) visibility behaves like workspace for members", () => {
    expect(
      computeDocumentAccess({
        visibility: "public",
        isCreator: false,
        membershipRole: "member",
        archived: false,
      }),
    ).toBe("editor");
    expect(
      computeDocumentAccess({
        visibility: "public",
        isCreator: false,
        membershipRole: "guest",
        archived: false,
      }),
    ).toBe("viewer");
  });

  it("trashed docs are read-only for everyone", () => {
    for (const role of roles) {
      const access = computeDocumentAccess({
        visibility: "workspace",
        isCreator: true,
        membershipRole: role,
        archived: true,
      });
      expect(access).toBe("viewer");
    }
    // Direct full-access shares don't bypass the trash cap either.
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: null,
        directPermission: "full_access",
        archived: true,
      }),
    ).toBe("viewer");
  });

  it("locked wikis: members demoted to viewer; workspace admins/owners keep edit", () => {
    const base = {
      visibility: "workspace" as const,
      isCreator: false,
      archived: false,
      docType: "wiki" as const,
      locked: true,
    };
    expect(
      computeDocumentAccess({ ...base, membershipRole: "member" }),
    ).toBe("viewer");
    expect(
      computeDocumentAccess({ ...base, membershipRole: "guest" }),
    ).toBe("viewer");
    expect(
      computeDocumentAccess({ ...base, membershipRole: "admin" }),
    ).toBe("full");
    expect(
      computeDocumentAccess({ ...base, membershipRole: "owner" }),
    ).toBe("full");
    // Creator status does not bypass the lock.
    expect(
      computeDocumentAccess({
        ...base,
        isCreator: true,
        membershipRole: "member",
      }),
    ).toBe("viewer");
    // Direct shares do not bypass the lock.
    expect(
      computeDocumentAccess({
        ...base,
        membershipRole: null,
        directPermission: "full_access",
      }),
    ).toBe("viewer");
  });

  it("locked wikis: platform admins keep edit even as workspace members", () => {
    const base = {
      visibility: "workspace" as const,
      isCreator: false,
      archived: false,
      docType: "wiki" as const,
      locked: true,
      membershipRole: "member" as const,
    };
    expect(computeDocumentAccess({ ...base, platformRole: "admin" })).toBe(
      "editor",
    );
    expect(computeDocumentAccess({ ...base, platformRole: "developer" })).toBe(
      "viewer",
    );
    // Platform admins still need workspace membership.
    expect(
      computeDocumentAccess({
        ...base,
        membershipRole: null,
        platformRole: "admin",
      }),
    ).toBe("none");
  });

  it("unlocked wikis and locked regular docs behave normally", () => {
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: "member",
        archived: false,
        docType: "wiki",
        locked: false,
      }),
    ).toBe("editor");
    // Lock flag is ignored for non-wiki docs (defensive).
    expect(
      computeDocumentAccess({
        visibility: "workspace",
        isCreator: false,
        membershipRole: "member",
        archived: false,
        docType: "doc",
        locked: true,
      }),
    ).toBe("editor");
  });

  it("canManageWikiLock: workspace admins/owners and platform admins only", () => {
    expect(canManageWikiLock({ membershipRole: "owner" })).toBe(true);
    expect(canManageWikiLock({ membershipRole: "admin" })).toBe(true);
    expect(canManageWikiLock({ membershipRole: "member" })).toBe(false);
    expect(
      canManageWikiLock({ membershipRole: "member", platformRole: "admin" }),
    ).toBe(true);
    expect(
      canManageWikiLock({ membershipRole: null, platformRole: "admin" }),
    ).toBe(false);
  });

  it("helpers reflect levels", () => {
    expect(canView("viewer")).toBe(true);
    expect(canView("editor")).toBe(true);
    expect(canView("full")).toBe(true);
    expect(canView("none")).toBe(false);
    expect(canEdit("full")).toBe(true);
    expect(canEdit("editor")).toBe(true);
    expect(canEdit("viewer")).toBe(false);
    expect(canShare("full")).toBe(true);
    expect(canShare("editor")).toBe(false);
    expect(canShare("viewer")).toBe(false);
    expect(canShare("none")).toBe(false);
  });
});

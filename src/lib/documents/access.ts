import type { WorkspaceRole } from "@/lib/roles";
import { roleAtLeast } from "@/lib/roles";

/**
 * Document access levels, from lowest to highest.
 * `full` = can edit *and* manage sharing (invite people, change levels,
 * change General access) — Notion's "Full access".
 */
export type DocumentAccess = "none" | "viewer" | "editor" | "full";

/** Direct per-document share levels (document_permissions.level). */
export type DocumentPermissionLevel = "full_access" | "edit" | "view";

export type DocumentVisibility = "private" | "workspace" | "public";

export type PlatformRole = "admin" | "developer";

const ACCESS_RANK: Record<DocumentAccess, number> = {
  none: 0,
  viewer: 1,
  editor: 2,
  full: 3,
};

function maxAccess(a: DocumentAccess, b: DocumentAccess): DocumentAccess {
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

function accessFromPermission(
  level: DocumentPermissionLevel | null | undefined,
): DocumentAccess {
  switch (level) {
    case "full_access":
      return "full";
    case "edit":
      return "editor";
    case "view":
      return "viewer";
    default:
      return "none";
  }
}

export type AccessInput = {
  /**
   * Document visibility flag — the page's "General access":
   * `private` = "Only people invited"; `workspace` = everyone in the
   * workspace. (`public` is a legacy value treated like `workspace`;
   * publish-to-web is tracked separately via published_at.)
   */
  visibility: DocumentVisibility;
  /** Whether the requesting user created the document. */
  isCreator: boolean;
  /** The requesting user's role in the document's workspace (null = not a member). */
  membershipRole: WorkspaceRole | null;
  /** The requesting user's direct share on this document (null = none). */
  directPermission?: DocumentPermissionLevel | null;
  /** Whether the document is in the trash (archived). */
  archived: boolean;
  /** Document type — wikis support locking. */
  docType?: "doc" | "wiki";
  /** Whether the wiki is currently locked. */
  locked?: boolean;
  /** The requesting user's platform role (admin | developer). */
  platformRole?: PlatformRole;
};

/**
 * Single source of truth for document access decisions.
 *
 * Model (agreed with the team):
 * - Personal notebooks are single-member workspaces, so membership alone
 *   scopes them to their owner. Individual pages can still be shared with
 *   specific people via document_permissions (Notion-style).
 * - Any `workspace`-visible document is available to everyone in that
 *   workspace: guests read, members edit, owners/admins and the page's
 *   creator get full access (may manage sharing).
 * - `private` visibility means "Only people invited": only the creator and
 *   direct permission holders can access — even other admins are excluded.
 * - Direct shares (document_permissions) grant page-level access regardless
 *   of workspace membership: view → viewer, edit → editor,
 *   full_access → full. The final access is the max of the
 *   membership-derived and direct-share levels.
 * - Publishing to the web (published_at) is orthogonal: /p/[slug] serves
 *   published pages read-only to anyone (handled by the public page — this
 *   function covers in-app access).
 * - Trashed documents are read-only (restore first to edit).
 * - Locked wikis are read-only for everyone except workspace owners/admins
 *   and platform `admin` users (who must still be workspace members).
 *   Direct shares do not bypass a lock.
 *
 * This is used by the app, mirrored in search SQL, and by Slack unfurling —
 * keep all of them in sync when the model changes.
 */
export function computeDocumentAccess(input: AccessInput): DocumentAccess {
  const directAccess = accessFromPermission(input.directPermission);

  let membershipAccess: DocumentAccess = "none";
  if (input.membershipRole) {
    // "Only people invited": membership alone grants nothing to non-creators.
    if (input.visibility === "private" && !input.isCreator) {
      membershipAccess = "none";
    } else if (roleAtLeast(input.membershipRole, "admin")) {
      membershipAccess = "full";
    } else if (input.isCreator && roleAtLeast(input.membershipRole, "member")) {
      membershipAccess = "full";
    } else if (roleAtLeast(input.membershipRole, "member")) {
      membershipAccess = "editor";
    } else {
      membershipAccess = "viewer";
    }
  }

  const access = maxAccess(membershipAccess, directAccess);
  if (access === "none") return "none";

  // Trashed documents can be viewed (in trash) but never edited in place.
  if (input.archived) return "viewer";

  // Locked wikis: only workspace admins/owners or platform admins can edit.
  if (input.docType === "wiki" && input.locked) {
    const canManageLocked =
      (input.membershipRole !== null &&
        roleAtLeast(input.membershipRole, "admin")) ||
      (input.platformRole === "admin" && input.membershipRole !== null);
    if (!canManageLocked) return "viewer";
  }

  return access;
}

/** Whether a user may lock/unlock a wiki (must also have view access). */
export function canManageWikiLock(opts: {
  membershipRole: WorkspaceRole | null;
  platformRole?: PlatformRole;
}): boolean {
  if (!opts.membershipRole) return false;
  return (
    roleAtLeast(opts.membershipRole, "admin") || opts.platformRole === "admin"
  );
}

export function canView(access: DocumentAccess): boolean {
  return access !== "none";
}

export function canEdit(access: DocumentAccess): boolean {
  return access === "editor" || access === "full";
}

/** Whether the user may manage sharing (invite, change levels, General access). */
export function canShare(access: DocumentAccess): boolean {
  return access === "full";
}

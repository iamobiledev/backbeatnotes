/** Shared document types safe to import from client components. */

export type DocumentVisibility = "private" | "workspace" | "public";

export type DocumentType = "doc" | "wiki";

export type DocumentTreeNode = {
  id: string;
  title: string;
  parentId: string | null;
  icon: string | null;
  visibility: DocumentVisibility;
  docType: DocumentType;
  locked: boolean;
  updatedAt: Date;
  createdById: string;
  /** Display name of the last editor (falls back to the creator). */
  updatedByName: string | null;
  children: DocumentTreeNode[];
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  isPersonal: boolean;
  role: "owner" | "admin" | "member" | "guest";
};

/* ------------------------------- Sharing --------------------------------- */

export type DocumentPermissionLevel = "full_access" | "edit" | "view";

/** The page's "General access": invite-only vs everyone in the workspace. */
export type GeneralAccess = "invited" | "workspace";

export type SharePerson = {
  kind: "user";
  userId: string;
  name: string;
  email: string;
  image: string | null;
  level: DocumentPermissionLevel;
  isCreator: boolean;
  isYou: boolean;
};

export type SharePendingInvitation = {
  kind: "invitation";
  invitationId: string;
  email: string;
  level: DocumentPermissionLevel;
};

/** Everything the Share popover needs (returned by actionGetDocumentSharing). */
export type DocumentSharing = {
  /** Whether the caller may manage sharing (invite, change, General access). */
  canShare: boolean;
  generalAccess: GeneralAccess;
  workspaceName: string;
  isPersonal: boolean;
  published: boolean;
  publicSlug: string | null;
  people: SharePerson[];
  invitations: SharePendingInvitation[];
};

/** Sidebar "Shared" section rows. */
export type SharedWithMeItem = {
  id: string;
  title: string;
  icon: string | null;
  workspaceId: string;
};

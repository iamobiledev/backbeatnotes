import "server-only";

import { eq } from "drizzle-orm";
import {
  documentInvitations,
  documents,
  getDb,
  user,
  workspaceInvitations,
  workspaces,
} from "@/db";

export const INVITATION_SIGN_UP_HEADER =
  "x-backbeat-invitation-sign-up-token";

type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

type InvitationBase = {
  token: string;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
};

export type WorkspaceInvitationDetails = InvitationBase & {
  kind: "workspace";
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "member" | "guest";
};

export type DocumentInvitationDetails = InvitationBase & {
  kind: "document";
  documentId: string;
  documentTitle: string;
  workspaceId: string;
  inviterName: string | null;
  level: "full_access" | "edit" | "view";
};

export type InvitationDetails =
  | WorkspaceInvitationDetails
  | DocumentInvitationDetails;

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isInvitationActive(
  invitation: InvitationDetails,
  now = new Date(),
): boolean {
  return (
    invitation.status === "pending" &&
    invitation.expiresAt.getTime() >= now.getTime()
  );
}

export function invitationMatchesEmail(
  invitation: InvitationDetails,
  email: string,
): boolean {
  return (
    normalizeInvitationEmail(invitation.email) ===
    normalizeInvitationEmail(email)
  );
}

export async function getInvitationByToken(
  token: string,
): Promise<InvitationDetails | null> {
  const db = getDb();
  const [workspaceInvitation] = await db
    .select({
      token: workspaceInvitations.token,
      email: workspaceInvitations.email,
      status: workspaceInvitations.status,
      expiresAt: workspaceInvitations.expiresAt,
      workspaceId: workspaceInvitations.workspaceId,
      workspaceName: workspaces.name,
      role: workspaceInvitations.role,
    })
    .from(workspaceInvitations)
    .innerJoin(
      workspaces,
      eq(workspaces.id, workspaceInvitations.workspaceId),
    )
    .where(eq(workspaceInvitations.token, token))
    .limit(1);

  if (workspaceInvitation) {
    return {
      kind: "workspace",
      ...workspaceInvitation,
      email: normalizeInvitationEmail(workspaceInvitation.email),
    };
  }

  const [documentInvitation] = await db
    .select({
      token: documentInvitations.token,
      email: documentInvitations.email,
      status: documentInvitations.status,
      expiresAt: documentInvitations.expiresAt,
      documentId: documentInvitations.documentId,
      documentTitle: documents.title,
      workspaceId: documents.workspaceId,
      inviterName: user.name,
      level: documentInvitations.level,
    })
    .from(documentInvitations)
    .innerJoin(documents, eq(documents.id, documentInvitations.documentId))
    .leftJoin(user, eq(user.id, documentInvitations.invitedById))
    .where(eq(documentInvitations.token, token))
    .limit(1);

  if (!documentInvitation) return null;

  return {
    kind: "document",
    ...documentInvitation,
    email: normalizeInvitationEmail(documentInvitation.email),
  };
}

export async function invitationBelongsToEmail(
  token: string,
  email: string,
): Promise<boolean> {
  const invitation = await getInvitationByToken(token);
  return Boolean(
    invitation &&
      isInvitationActive(invitation) &&
      invitationMatchesEmail(invitation, email),
  );
}

export async function getInvitationAccount(email: string) {
  const db = getDb();
  const [account] = await db
    .select({
      id: user.id,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.email, normalizeInvitationEmail(email)))
    .limit(1);
  return account ?? null;
}

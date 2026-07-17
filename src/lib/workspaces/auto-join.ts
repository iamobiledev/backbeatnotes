import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  getDb,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
} from "@/db";
import { logger } from "@/lib/logger";

/**
 * Domain-based automatic workspace membership.
 *
 * Workspaces may declare an `autoJoinDomain` (e.g. "rowsone.com"). Every time
 * a session is created for a user whose *verified* email is at that domain,
 * the user is idempotently added to the workspace as a plain `member`.
 *
 * Pending, unexpired invitations for the same email take precedence: domain
 * auto-join skips those workspaces so an explicit guest/admin invite cannot be
 * silently overwritten by a `member` row. Existing memberships (of any role)
 * are never modified by auto-join.
 *
 * This module intentionally imports only the db + logger so it can be used
 * from `src/lib/auth.ts` without creating import cycles.
 */

/** Public consumer email providers that must never be used for auto-join. */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
]);

/**
 * RFC-1035-ish hostname check: dot-separated labels of letters/digits/hyphens
 * (no leading/trailing hyphen), at least two labels, alphabetic TLD.
 */
const DOMAIN_PATTERN =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lowercased domain portion of an email address, or null when malformed. */
export function emailDomainOf(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  return DOMAIN_PATTERN.test(domain) ? domain : null;
}

/**
 * Normalize admin input for an auto-join domain: trims whitespace, lowers
 * case, and strips a leading "@" (people naturally type "@rowsone.com").
 */
export function normalizeAutoJoinDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^@+/, "");
}

export type AutoJoinDomainValidation =
  | { ok: true; domain: string }
  | { ok: false; error: "INVALID_DOMAIN" | "PUBLIC_EMAIL_DOMAIN" };

/** Validate a (normalized) auto-join domain. */
export function validateAutoJoinDomain(input: string): AutoJoinDomainValidation {
  const domain = normalizeAutoJoinDomain(input);
  if (!DOMAIN_PATTERN.test(domain)) {
    return { ok: false, error: "INVALID_DOMAIN" };
  }
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, error: "PUBLIC_EMAIL_DOMAIN" };
  }
  return { ok: true, domain };
}

/**
 * Drop workspace ids that have a pending invitation so auto-join cannot race
 * ahead of explicit invite roles (guest/admin).
 */
export function excludeWorkspacesWithPendingInvite(
  workspaceIds: readonly string[],
  pendingInviteWorkspaceIds: Iterable<string>,
): string[] {
  const blocked = new Set(pendingInviteWorkspaceIds);
  return workspaceIds.filter((id) => !blocked.has(id));
}

/**
 * Map an invitation role onto a workspace membership role.
 * Invitations may still use legacy `owner`; memberships store that as `admin`.
 */
export function membershipRoleFromInvitation(
  invitationRole: "owner" | "admin" | "member" | "guest",
): "admin" | "member" | "guest" {
  return invitationRole === "owner" ? "admin" : invitationRole;
}

/**
 * Decide whether accepting an invitation should change an existing membership.
 * Owners are never demoted via invitation accept.
 */
export function shouldApplyInvitationRoleToMembership(opts: {
  existingRole: "owner" | "admin" | "member" | "guest";
  invitationRole: "owner" | "admin" | "member" | "guest";
}): boolean {
  if (opts.existingRole === "owner") return false;
  return (
    membershipRoleFromInvitation(opts.invitationRole) !== opts.existingRole
  );
}

/**
 * Add the user as a `member` to every team workspace whose auto-join domain
 * matches their verified email domain. Idempotent: existing memberships (of
 * any role) are never modified. Returns the ids of workspaces actually joined.
 */
export async function autoJoinWorkspacesForUser(opts: {
  userId: string;
  email: string;
  emailVerified: boolean;
}): Promise<string[]> {
  if (!opts.emailVerified) return [];
  const domain = emailDomainOf(opts.email);
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return [];

  const db = getDb();
  const matches = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.autoJoinDomain, domain),
        eq(workspaces.isPersonal, false),
      ),
    );
  if (matches.length === 0) return [];

  const matchIds = matches.map((workspace) => workspace.id);
  const email = opts.email.trim().toLowerCase();
  const pendingInvites = await db
    .select({ workspaceId: workspaceInvitations.workspaceId })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.email, email),
        eq(workspaceInvitations.status, "pending"),
        gt(workspaceInvitations.expiresAt, new Date()),
        inArray(workspaceInvitations.workspaceId, matchIds),
      ),
    );

  const eligibleIds = excludeWorkspacesWithPendingInvite(
    matchIds,
    pendingInvites.map((row) => row.workspaceId),
  );
  if (eligibleIds.length === 0) return [];

  const joined: string[] = [];
  for (const workspaceId of eligibleIds) {
    const inserted = await db
      .insert(workspaceMembers)
      .values({
        id: nanoid(),
        workspaceId,
        userId: opts.userId,
        role: "member",
      })
      .onConflictDoNothing({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      })
      .returning({ id: workspaceMembers.id });
    if (inserted.length > 0) joined.push(workspaceId);
  }

  if (joined.length > 0) {
    logger.info("workspace.auto_join", {
      userId: opts.userId,
      domain,
      workspaceIds: joined,
    });
  }
  return joined;
}

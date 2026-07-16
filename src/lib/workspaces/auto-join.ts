import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, workspaces, workspaceMembers } from "@/db";
import { logger } from "@/lib/logger";

/**
 * Domain-based automatic workspace membership.
 *
 * Workspaces may declare an `autoJoinDomain` (e.g. "rowsone.com"). Every time
 * a session is created for a user whose *verified* email is at that domain,
 * the user is idempotently added to the workspace as a plain `member`.
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

  const joined: string[] = [];
  for (const workspace of matches) {
    const inserted = await db
      .insert(workspaceMembers)
      .values({
        id: nanoid(),
        workspaceId: workspace.id,
        userId: opts.userId,
        role: "member",
      })
      .onConflictDoNothing({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      })
      .returning({ id: workspaceMembers.id });
    if (inserted.length > 0) joined.push(workspace.id);
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

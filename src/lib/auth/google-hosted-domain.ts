/**
 * Extra Google Workspace domain checks used alongside Better Auth's built-in
 * `hd` enforcement (verifyIdToken + getUserInfo in better-auth ≥1.6.16).
 *
 * Prefer the verified Workspace `hd` claim (same signal Better Auth uses).
 * Do not require the email suffix to match — Workspace accounts can use
 * secondary/alias domains while still carrying `hd: primary.com`.
 *
 * Do NOT replace `getUserInfo` on the Google provider — that would override
 * Better Auth's built-in `hd` claim enforcement. Use `mapProfileToUser`
 * instead (it runs after that check).
 */

export type GoogleHostedDomainProfile = {
  email?: string | null;
  /** Verified Google Workspace hosted-domain claim from the id token. */
  hd?: string | null;
};

/** True when `email` is at exactly `hostedDomain` (case-insensitive). */
export function emailMatchesHostedDomain(
  email: string | null | undefined,
  hostedDomain: string,
): boolean {
  const domain = hostedDomain.trim().toLowerCase();
  if (!domain) return false;
  const normalized = String(email ?? "")
    .trim()
    .toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;
  return normalized.slice(at + 1) === domain;
}

/** True when the verified `hd` claim equals the configured hosted domain. */
export function hdClaimMatchesHostedDomain(
  hd: string | null | undefined,
  hostedDomain: string,
): boolean {
  const expected = hostedDomain.trim().toLowerCase();
  if (!expected) return false;
  if (typeof hd !== "string") return false;
  const actual = hd.trim().toLowerCase();
  return actual.length > 0 && actual === expected;
}

/**
 * Throw when a Google profile is outside the configured Workspace domain.
 * Used from `socialProviders.google.mapProfileToUser`.
 *
 * Uses the verified `hd` claim when present (allows Workspace email aliases).
 * Falls back to the email suffix only when `hd` is missing.
 */
export function assertGoogleEmailMatchesHostedDomain(
  profile: GoogleHostedDomainProfile,
  hostedDomain: string | undefined,
): void {
  if (!hostedDomain) return;
  if (typeof profile.hd === "string" && profile.hd.trim()) {
    if (!hdClaimMatchesHostedDomain(profile.hd, hostedDomain)) {
      throw new Error("GOOGLE_HOSTED_DOMAIN_MISMATCH");
    }
    return;
  }
  if (!emailMatchesHostedDomain(profile.email, hostedDomain)) {
    throw new Error("GOOGLE_HOSTED_DOMAIN_MISMATCH");
  }
}

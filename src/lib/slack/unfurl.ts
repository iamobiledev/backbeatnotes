/**
 * Unfurl decision logic (pure — unit-tested; security-sensitive).
 *
 * Rules agreed with the team:
 * - Deleted or trashed documents → minimal neutral card (no title leak).
 * - Public (published) documents → full card for anyone.
 * - Otherwise, the *sharer* must have a linked Slack identity AND view
 *   access to the document — else a minimal card.
 */

import type { DocumentAccess } from "@/lib/documents/access";

export type UnfurlDecision = "full" | "minimal";

export type UnfurlInput = {
  /** Document exists (false → deleted/unknown id). */
  exists: boolean;
  /** Document is in the trash. */
  archived: boolean;
  /** Document is published to the web (published_at set). */
  published: boolean;
  /** The sharer has a linked Slack identity. */
  sharerLinked: boolean;
  /** The sharer's resolved access to the document ("none" if unlinked). */
  sharerAccess: DocumentAccess;
};

export function decideUnfurl(input: UnfurlInput): UnfurlDecision {
  if (!input.exists) return "minimal";
  if (input.archived) return "minimal";
  if (input.published) return "full";
  if (!input.sharerLinked) return "minimal";
  if (
    input.sharerAccess === "viewer" ||
    input.sharerAccess === "editor" ||
    input.sharerAccess === "full"
  ) {
    return "full";
  }
  return "minimal";
}

/* ----------------------- Link → document resolution ---------------------- */

export type ParsedDocLink =
  | { kind: "doc"; documentId: string; url: string }
  | { kind: "public"; slug: string; url: string };

/**
 * Extract document references from URLs on our domain:
 * - /app/{workspaceId}/docs/{documentId}
 * - /p/{slug}
 */
export function parseDocLinks(urls: string[], appUrl: string): ParsedDocLink[] {
  const results: ParsedDocLink[] = [];
  const base = appUrl.replace(/\/$/, "");
  for (const url of urls) {
    if (!url.startsWith(base)) {
      // Also tolerate scheme/host case differences.
      try {
        const parsed = new URL(url);
        const baseParsed = new URL(base);
        if (parsed.host.toLowerCase() !== baseParsed.host.toLowerCase()) {
          continue;
        }
      } catch {
        continue;
      }
    }
    try {
      const { pathname } = new URL(url);
      const docMatch = pathname.match(/^\/app\/[^/]+\/docs\/([^/]+)\/?$/);
      if (docMatch) {
        results.push({ kind: "doc", documentId: docMatch[1], url });
        continue;
      }
      const publicMatch = pathname.match(/^\/p\/([^/]+)\/?$/);
      if (publicMatch) {
        results.push({ kind: "public", slug: publicMatch[1], url });
      }
    } catch {
      // ignore unparseable URLs
    }
  }
  return results;
}

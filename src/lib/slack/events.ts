import "server-only";
import { eq } from "drizzle-orm";
import { getDb, documents, user as userTable, workspaces } from "@/db";
import { getAppUrl } from "@/env/server";
import { getMembership } from "@/lib/permissions";
import { computeDocumentAccess } from "@/lib/documents/access";
import {
  getPublicDocument,
  getDirectPermission,
} from "@/lib/documents/service";
import { brand } from "@/config/brand";
import { logger } from "@/lib/logger";
import {
  chatUnfurl,
  chatPostMessage,
  type SlackBlock,
} from "./client";
import { documentCard, minimalCard } from "./blocks";
import { decideUnfurl, parseDocLinks } from "./unfurl";
import { getConnectionsForTeam, getLinkedUser } from "./service";
import { buildSearchReply } from "./assistant";

/**
 * Async processors for Slack events. Called via `after()` — the HTTP
 * response has already been sent, so everything here must catch its own
 * failures and merely log them (a failed unfurl must never break anything).
 */

export type LinkSharedEvent = {
  channel: string;
  message_ts: string;
  user?: string;
  links: Array<{ url: string; domain: string }>;
  unfurl_id?: string;
  source?: string;
};

type DocRow = {
  id: string;
  workspaceId: string;
  title: string;
  visibility: "private" | "workspace" | "public";
  publishedAt: Date | null;
  plainTextContent: string;
  archivedAt: Date | null;
  createdById: string;
  updatedAt: Date;
  creatorName: string | null;
  workspaceName: string | null;
  isPersonal: boolean | null;
};

async function loadDoc(documentId: string): Promise<DocRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      title: documents.title,
      visibility: documents.visibility,
      publishedAt: documents.publishedAt,
      plainTextContent: documents.plainTextContent,
      archivedAt: documents.archivedAt,
      createdById: documents.createdById,
      updatedAt: documents.updatedAt,
      creatorName: userTable.name,
      workspaceName: workspaces.name,
      isPersonal: workspaces.isPersonal,
    })
    .from(documents)
    .leftJoin(userTable, eq(userTable.id, documents.createdById))
    .leftJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .where(eq(documents.id, documentId))
    .limit(1);
  return row ?? null;
}

export async function processLinkShared(teamId: string, event: LinkSharedEvent) {
  try {
    const appUrl = getAppUrl();
    const parsed = parseDocLinks(
      event.links.map((link) => link.url),
      appUrl,
    );
    if (parsed.length === 0) return;

    const connections = await getConnectionsForTeam(teamId);
    if (connections.length === 0) {
      logger.warn("slack.unfurl_no_connection", { teamId });
      return;
    }

    const sharer = event.user
      ? await getLinkedUser({ slackTeamId: teamId, slackUserId: event.user })
      : null;

    const unfurls: Record<string, { blocks: SlackBlock[] }> = {};

    for (const link of parsed) {
      if (link.kind === "public") {
        // Published pages are readable by anyone — full card.
        const doc = await getPublicDocument(link.slug);
        unfurls[link.url] = {
          blocks: doc
            ? documentCard({
                title: doc.title,
                excerptSource: doc.plainTextContent,
                authorName: doc.creatorName ?? "Unknown",
                updatedAt: doc.updatedAt,
                url: link.url,
                workspaceName: doc.workspaceName ?? undefined,
                appName: brand.name,
              })
            : minimalCard({ url: link.url, appName: brand.name }),
        };
        continue;
      }

      const doc = await loadDoc(link.documentId);
      let sharerAccess: ReturnType<typeof computeDocumentAccess> = "none";
      if (doc && sharer) {
        const [membership, directPermission] = await Promise.all([
          getMembership(sharer.userId, doc.workspaceId),
          getDirectPermission(sharer.userId, doc.id),
        ]);
        sharerAccess = computeDocumentAccess({
          visibility: doc.visibility,
          isCreator: doc.createdById === sharer.userId,
          membershipRole: membership?.role ?? null,
          directPermission,
          archived: doc.archivedAt !== null,
        });
      }

      const decision = decideUnfurl({
        exists: Boolean(doc),
        archived: doc?.archivedAt != null,
        published: doc?.publishedAt != null,
        sharerLinked: Boolean(sharer),
        sharerAccess,
      });

      // Personal notebook pages never unfurl with content, even for the
      // owner — a shared link to them is useless for everyone else anyway.
      const full = decision === "full" && doc && !doc.isPersonal;

      unfurls[link.url] = {
        blocks: full
          ? documentCard({
              title: doc.title,
              excerptSource: doc.plainTextContent,
              authorName: doc.creatorName ?? "Unknown",
              updatedAt: doc.updatedAt,
              url: link.url,
              workspaceName: doc.workspaceName ?? undefined,
              appName: brand.name,
            })
          : minimalCard({ url: link.url, appName: brand.name }),
      };
    }

    if (Object.keys(unfurls).length === 0) return;

    const token = connections[0].botToken();
    const result = await chatUnfurl({
      token,
      channel: event.channel,
      ts: event.message_ts,
      unfurls,
      unfurlId: event.unfurl_id,
      source: event.source,
    });
    if (!result.ok) {
      logger.warn("slack.unfurl_failed", {
        teamId,
        channel: event.channel,
        slackError: result.error,
      });
    } else {
      logger.info("slack.unfurl_sent", {
        teamId,
        channel: event.channel,
        links: Object.keys(unfurls).length,
      });
    }
  } catch (error) {
    logger.error("slack.link_shared_processing_failed", {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type AppMentionEvent = {
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
};

export async function processAppMention(teamId: string, event: AppMentionEvent) {
  try {
    const connections = await getConnectionsForTeam(teamId);
    if (connections.length === 0 || !event.user) return;
    const token = connections[0].botToken();

    const linked = await getLinkedUser({
      slackTeamId: teamId,
      slackUserId: event.user,
    });

    const reply = await buildSearchReply({
      rawText: event.text ?? "",
      linkedUserId: linked?.userId ?? null,
      slackTeamId: teamId,
      limit: 3,
    });

    const result = await chatPostMessage({
      token,
      channel: event.channel,
      text: reply.text,
      blocks: reply.blocks,
      // Reply in-thread to keep channels tidy.
      threadTs: event.thread_ts ?? event.ts,
    });
    if (!result.ok) {
      logger.warn("slack.mention_reply_failed", {
        teamId,
        channel: event.channel,
        slackError: result.error,
      });
    }
  } catch (error) {
    logger.error("slack.app_mention_processing_failed", {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

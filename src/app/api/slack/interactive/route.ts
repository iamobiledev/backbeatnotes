import { NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest } from "@/lib/slack/http";
import { getLinkedUser, getConnectionsForTeam } from "@/lib/slack/service";
import {
  chatPostMessage,
  respondViaResponseUrl,
} from "@/lib/slack/client";
import { documentCard } from "@/lib/slack/blocks";
import { getDocumentWithAccess } from "@/lib/documents/service";
import { canView } from "@/lib/documents/access";
import { getWorkspaceById } from "@/lib/workspaces/service";
import { getDb, user as userTable } from "@/db";
import { eq } from "drizzle-orm";
import { getAppUrl } from "@/env/server";
import { brand } from "@/config/brand";
import { logger } from "@/lib/logger";

type BlockActionsPayload = {
  type?: string;
  team?: { id: string };
  user?: { id: string };
  channel?: { id: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
};

/**
 * Slack interactivity endpoint (block_actions).
 * Handles "Share to channel" from `/docs` results. URL buttons
 * (open_in_app, link_account) also POST here and are simply acked.
 */
export async function POST(request: Request) {
  const verified = await verifySlackRequest(request, "interactive");
  if (!verified.ok) return verified.response;

  const params = new URLSearchParams(verified.rawBody);
  let payload: BlockActionsPayload;
  try {
    payload = JSON.parse(params.get("payload") ?? "{}") as BlockActionsPayload;
  } catch {
    return new NextResponse(null, { status: 200 });
  }

  if (payload.type !== "block_actions") {
    return new NextResponse(null, { status: 200 });
  }

  const action = payload.actions?.find(
    (a) => a.action_id === "share_doc_to_channel",
  );
  const teamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  const channelId = payload.channel?.id;
  const responseUrl = payload.response_url;

  if (!action?.value || !teamId || !slackUserId || !channelId) {
    return new NextResponse(null, { status: 200 });
  }

  const documentId = action.value;

  after(async () => {
    const ephemeral = async (text: string) => {
      if (responseUrl) {
        await respondViaResponseUrl(responseUrl, {
          response_type: "ephemeral",
          replace_original: false,
          text,
        });
      }
    };

    try {
      const linked = await getLinkedUser({ slackTeamId: teamId, slackUserId });
      if (!linked) {
        await ephemeral(
          `Link your ${brand.name} account first (run /docs to get the link button).`,
        );
        return;
      }

      // Re-check access at click time — permissions may have changed.
      const result = await getDocumentWithAccess(linked.userId, documentId);
      if (!result || !canView(result.access) || result.doc.archivedAt) {
        await ephemeral("You no longer have access to that document.");
        return;
      }

      const workspace = await getWorkspaceById(result.doc.workspaceId);
      if (workspace?.isPersonal) {
        await ephemeral(
          "Personal notebook pages can't be shared to channels.",
        );
        return;
      }

      const connections = await getConnectionsForTeam(teamId);
      if (connections.length === 0) {
        await ephemeral("Slack isn't connected for this workspace anymore.");
        return;
      }

      const db = getDb();
      const [creator] = await db
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, result.doc.createdById))
        .limit(1);

      const url = `${getAppUrl()}/app/${result.doc.workspaceId}/docs/${result.doc.id}`;
      const post = await chatPostMessage({
        token: connections[0].botToken(),
        channel: channelId,
        text: `${result.doc.title} — shared from ${brand.name}`,
        blocks: documentCard({
          title: result.doc.title,
          excerptSource: result.doc.plainTextContent,
          authorName: creator?.name ?? "Unknown",
          updatedAt: result.doc.updatedAt,
          url,
          workspaceName: workspace?.name,
          appName: brand.name,
        }),
      });

      if (!post.ok) {
        if (post.error === "not_in_channel") {
          await ephemeral(
            `I'm not in this channel yet — run \`/invite @${brand.name}\` first, then try again.`,
          );
        } else {
          await ephemeral("Couldn't share the document. Please try again.");
        }
        logger.warn("slack.share_to_channel_failed", {
          teamId,
          channel: channelId,
          slackError: post.error,
        });
      }
    } catch (error) {
      logger.error("slack.interactive_processing_failed", {
        teamId,
        error: error instanceof Error ? error.message : String(error),
      });
      await ephemeral("Something went wrong. Please try again.");
    }
  });

  return new NextResponse(null, { status: 200 });
}

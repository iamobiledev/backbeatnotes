"use server";

import { z } from "zod";
import { requireVerifiedSession } from "@/lib/session";
import { requireMembership } from "@/lib/permissions";
import { getDocumentWithAccess } from "@/lib/documents/service";
import { canView } from "@/lib/documents/access";
import { getWorkspaceById } from "@/lib/workspaces/service";
import {
  deleteConnection,
  getConnectionForWorkspace,
  getBotTokenForWorkspace,
  unlinkSlackUser,
} from "@/lib/slack/service";
import {
  listConversations,
  chatPostMessage,
} from "@/lib/slack/client";
import { documentCard, escapeSlackText } from "@/lib/slack/blocks";
import { getAppUrl } from "@/env/server";
import { getDb, user as userTable } from "@/db";
import { eq } from "drizzle-orm";
import { brand } from "@/config/brand";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";

export type SlackActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/* ----------------------------- Admin actions ----------------------------- */

export async function actionDisconnectSlack(input: {
  workspaceId: string;
}): Promise<SlackActionResult<undefined>> {
  const session = await requireVerifiedSession();
  try {
    const parsed = z.object({ workspaceId: z.string().min(1) }).parse(input);
    await requireMembership(session.user.id, parsed.workspaceId, "admin");
    await deleteConnection(parsed.workspaceId);
    revalidatePath(`/app/${parsed.workspaceId}/settings`);
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Couldn't disconnect Slack. Please try again." };
  }
}

export async function actionUnlinkSlackIdentity(input: {
  workspaceId?: string;
}): Promise<SlackActionResult<undefined>> {
  const session = await requireVerifiedSession();
  try {
    await unlinkSlackUser({ userId: session.user.id });
    if (input.workspaceId) {
      revalidatePath(`/app/${input.workspaceId}/settings`);
    }
    return { ok: true, data: undefined };
  } catch {
    return {
      ok: false,
      error: "Couldn't unlink your Slack account. Please try again.",
    };
  }
}

/* --------------------------- Share to Slack ------------------------------ */

export async function actionListSlackChannels(input: {
  workspaceId: string;
}): Promise<SlackActionResult<Array<{ id: string; name: string }>>> {
  const session = await requireVerifiedSession();
  try {
    const parsed = z.object({ workspaceId: z.string().min(1) }).parse(input);
    await requireMembership(session.user.id, parsed.workspaceId, "guest");

    const token = await getBotTokenForWorkspace(parsed.workspaceId);
    if (!token) return { ok: false, error: "Slack isn't connected." };

    const channels: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await listConversations({ token, cursor });
      if (!result.ok) {
        return { ok: false, error: "Couldn't load Slack channels." };
      }
      for (const channel of result.channels ?? []) {
        if (!channel.is_archived) {
          channels.push({ id: channel.id, name: channel.name });
        }
      }
      cursor = result.response_metadata?.next_cursor || undefined;
      if (!cursor) break;
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: channels };
  } catch {
    return { ok: false, error: "Couldn't load Slack channels." };
  }
}

export async function actionShareDocToSlack(input: {
  documentId: string;
  channelId: string;
  message?: string;
}): Promise<SlackActionResult<undefined>> {
  const session = await requireVerifiedSession();
  try {
    const parsed = z
      .object({
        documentId: z.string().min(1),
        channelId: z.string().min(1).max(50),
        message: z.string().max(500).optional(),
      })
      .parse(input);

    const result = await getDocumentWithAccess(
      session.user.id,
      parsed.documentId,
    );
    if (!result || !canView(result.access) || result.doc.archivedAt) {
      return { ok: false, error: "You don't have access to this document." };
    }

    const workspace = await getWorkspaceById(result.doc.workspaceId);
    if (!workspace || workspace.isPersonal) {
      return {
        ok: false,
        error: "Personal notebook pages can't be shared to Slack.",
      };
    }

    const [token, connection] = await Promise.all([
      getBotTokenForWorkspace(workspace.id),
      getConnectionForWorkspace(workspace.id),
    ]);
    if (!token || !connection) {
      return { ok: false, error: "Slack isn't connected for this workspace." };
    }

    const db = getDb();
    const [creator] = await db
      .select({ name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, result.doc.createdById))
      .limit(1);

    const url = `${getAppUrl()}/app/${result.doc.workspaceId}/docs/${result.doc.id}`;
    const blocks = [];
    const trimmedMessage = parsed.message?.trim();
    if (trimmedMessage) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `💬 ${escapeSlackText(trimmedMessage)} — _${escapeSlackText(session.user.name)}_`,
        },
      });
    }
    blocks.push(
      ...documentCard({
        title: result.doc.title,
        excerptSource: result.doc.plainTextContent,
        authorName: creator?.name ?? "Unknown",
        updatedAt: result.doc.updatedAt,
        url,
        workspaceName: workspace.name,
        appName: brand.name,
      }),
    );

    const post = await chatPostMessage({
      token,
      channel: parsed.channelId,
      text: `${result.doc.title} — shared from ${brand.name} by ${session.user.name}`,
      blocks,
    });

    if (!post.ok) {
      logger.warn("slack.share_from_app_failed", {
        documentId: parsed.documentId,
        slackError: post.error,
      });
      if (post.error === "not_in_channel") {
        return {
          ok: false,
          error: `The ${brand.name} bot isn't in that channel yet — run /invite @${brand.name} in Slack first.`,
        };
      }
      return { ok: false, error: "Slack rejected the message. Try again." };
    }
    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("slack.share_from_app_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Couldn't share to Slack. Please try again." };
  }
}

import { NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest } from "@/lib/slack/http";
import { getLinkedUser } from "@/lib/slack/service";
import { buildSearchReply } from "@/lib/slack/assistant";
import { respondViaResponseUrl } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * `/docs <query>` slash command.
 * Acks immediately with a lightweight message; results are searched and
 * posted to the response_url asynchronously (ephemeral to the invoker).
 */
export async function POST(request: Request) {
  const verified = await verifySlackRequest(request, "commands");
  if (!verified.ok) return verified.response;

  const params = new URLSearchParams(verified.rawBody);
  const teamId = params.get("team_id") ?? "";
  const slackUserId = params.get("user_id") ?? "";
  const text = params.get("text") ?? "";
  const responseUrl = params.get("response_url") ?? "";

  if (!teamId || !slackUserId || !responseUrl) {
    return new NextResponse(null, { status: 200 });
  }

  after(async () => {
    try {
      const linked = await getLinkedUser({ slackTeamId: teamId, slackUserId });
      const reply = await buildSearchReply({
        rawText: text,
        linkedUserId: linked?.userId ?? null,
        slackTeamId: teamId,
        limit: 5,
        includeShareButtons: true,
      });
      await respondViaResponseUrl(responseUrl, {
        response_type: "ephemeral",
        text: reply.text,
        blocks: reply.blocks,
      });
    } catch (error) {
      logger.error("slack.command_processing_failed", {
        teamId,
        error: error instanceof Error ? error.message : String(error),
      });
      await respondViaResponseUrl(responseUrl, {
        response_type: "ephemeral",
        text: "Something went wrong while searching. Please try again.",
      });
    }
  });

  // Immediate ack (< 3s): a quiet placeholder the async reply replaces.
  return NextResponse.json({
    response_type: "ephemeral",
    text: text.trim() ? `Searching for “${text.trim()}”…` : "Searching…",
  });
}

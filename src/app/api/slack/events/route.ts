import { NextResponse } from "next/server";
import { after } from "next/server";
import { verifySlackRequest } from "@/lib/slack/http";
import { claimEvent } from "@/lib/slack/service";
import {
  processLinkShared,
  processAppMention,
  type LinkSharedEvent,
  type AppMentionEvent,
} from "@/lib/slack/events";
import { logger } from "@/lib/logger";

/**
 * Slack Events API endpoint.
 *
 * Acknowledges within Slack's 3-second window: signature check + dedupe
 * happen inline (fast DB insert), all heavy work (doc lookups, unfurl
 * rendering, Slack API calls) runs after the response via `after()`.
 */
export async function POST(request: Request) {
  const verified = await verifySlackRequest(request, "events");
  if (!verified.ok) return verified.response;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(verified.rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // URL verification handshake when enabling the endpoint.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    return new NextResponse(null, { status: 200 });
  }

  const teamId = String(payload.team_id ?? "");
  const eventId = String(payload.event_id ?? "");
  const event = payload.event as
    | ({ type?: string } & Record<string, unknown>)
    | undefined;

  if (!teamId || !event?.type) {
    return new NextResponse(null, { status: 200 });
  }

  // Idempotency: Slack redelivers events when acks are slow — claim the
  // event id before processing so retries become no-ops.
  if (eventId) {
    const isFirstDelivery = await claimEvent(`evt:${eventId}`);
    if (!isFirstDelivery) {
      logger.info("slack.event_duplicate_skipped", { eventId });
      return new NextResponse(null, { status: 200 });
    }
  }

  if (event.type === "link_shared") {
    const linkEvent = event as unknown as LinkSharedEvent;
    after(async () => {
      await processLinkShared(teamId, linkEvent);
    });
  } else if (event.type === "app_mention") {
    const mentionEvent = event as unknown as AppMentionEvent;
    after(async () => {
      await processAppMention(teamId, mentionEvent);
    });
  }

  return new NextResponse(null, { status: 200 });
}

import { NextResponse } from "next/server";
import { pruneOldDocumentVersions } from "@/lib/workspaces/service";
import { pruneSlackEvents } from "@/lib/slack/service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Protected Vercel Cron: prune old document versions and Slack event
 * idempotency keys.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await pruneOldDocumentVersions(50);
    const prunedEvents = await pruneSlackEvents(24);
    logger.info("cron.prune_versions", { retain: 50, prunedEvents });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("cron.prune_versions.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}

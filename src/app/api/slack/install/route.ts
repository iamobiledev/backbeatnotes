import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { requireMembership } from "@/lib/permissions";
import { getWorkspaceById } from "@/lib/workspaces/service";
import { getServerEnv, getAppUrl } from "@/env/server";
import { isSlackConfigured } from "@/lib/slack/status";
import { createStateToken } from "@/lib/slack/state";

export const runtime = "nodejs";

/** Bot scopes — exactly what the features need, nothing more. */
export const SLACK_BOT_SCOPES = [
  "links:read",
  "links:write",
  "chat:write",
  "commands",
  "app_mentions:read",
].join(",");

/**
 * Starts the Slack workspace install flow (admin-only).
 * GET /api/slack/install?workspaceId=…
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", getAppUrl()));
  }
  if (!isSlackConfigured()) {
    return NextResponse.json(
      { error: "Slack integration is not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId") ?? "";
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace || workspace.isPersonal) {
    return NextResponse.json({ error: "Invalid workspace" }, { status: 400 });
  }

  try {
    await requireMembership(session.user.id, workspaceId, "admin");
  } catch {
    return NextResponse.json(
      { error: "Only workspace admins can connect Slack" },
      { status: 403 },
    );
  }

  const env = getServerEnv();
  const state = createStateToken({
    kind: "install",
    workspaceId,
    userId: session.user.id,
  });

  const authorize = new URL("https://slack.com/oauth/v2/authorize");
  authorize.searchParams.set("client_id", env.SLACK_CLIENT_ID!);
  authorize.searchParams.set("scope", SLACK_BOT_SCOPES);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set(
    "redirect_uri",
    `${getAppUrl()}/api/slack/oauth/callback`,
  );

  return NextResponse.redirect(authorize);
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getServerEnv, getAppUrl } from "@/env/server";
import { verifyStateToken } from "@/lib/slack/state";
import { oauthAccess } from "@/lib/slack/client";
import { saveConnection } from "@/lib/slack/service";
import { logger } from "@/lib/logger";

function settingsRedirect(workspaceId: string, params: Record<string, string>) {
  const url = new URL(`/app/${workspaceId}/settings`, getAppUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.hash = "slack";
  return NextResponse.redirect(url);
}

/** Slack redirects here after the admin approves the app install. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", getAppUrl()));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateToken = searchParams.get("state") ?? "";
  const state = verifyStateToken(stateToken);

  if (!state || state.kind !== "install" || !state.workspaceId) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }
  if (state.userId !== session.user.id) {
    return NextResponse.json({ error: "State/user mismatch" }, { status: 403 });
  }
  if (!code) {
    // User cancelled on Slack's consent screen.
    return settingsRedirect(state.workspaceId, { slack: "cancelled" });
  }

  const env = getServerEnv();
  const result = await oauthAccess({
    clientId: env.SLACK_CLIENT_ID!,
    clientSecret: env.SLACK_CLIENT_SECRET!,
    code,
    redirectUri: `${getAppUrl()}/api/slack/oauth/callback`,
  });

  if (!result.ok || !result.access_token || !result.team?.id) {
    logger.error("slack.oauth_failed", {
      slackError: !result.ok ? result.error : "missing token/team",
    });
    return settingsRedirect(state.workspaceId, { slack: "error" });
  }

  await saveConnection({
    workspaceId: state.workspaceId,
    slackTeamId: result.team.id,
    slackTeamName: result.team.name ?? result.team.id,
    botToken: result.access_token,
    botUserId: result.bot_user_id ?? "",
    scopes: result.scope ?? "",
    installedById: session.user.id,
  });

  return settingsRedirect(state.workspaceId, { slack: "connected" });
}

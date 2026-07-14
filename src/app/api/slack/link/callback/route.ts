import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getServerEnv, getAppUrl } from "@/env/server";
import { verifyStateToken } from "@/lib/slack/state";
import { openIdConnectToken, openIdConnectUserInfo } from "@/lib/slack/client";
import { linkSlackUser } from "@/lib/slack/service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

function backToApp(workspaceId: string | undefined, status: string) {
  const url = workspaceId
    ? new URL(`/app/${workspaceId}/settings`, getAppUrl())
    : new URL("/app", getAppUrl());
  url.searchParams.set("slackLink", status);
  if (workspaceId) url.hash = "slack";
  return NextResponse.redirect(url);
}

/** Slack redirects here after the user approves identity linking. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", getAppUrl()));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = verifyStateToken(searchParams.get("state") ?? "");

  if (!state || state.kind !== "link") {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }
  if (state.userId !== session.user.id) {
    return NextResponse.json({ error: "State/user mismatch" }, { status: 403 });
  }
  if (!code) {
    return backToApp(state.workspaceId, "cancelled");
  }

  const env = getServerEnv();
  const tokenResult = await openIdConnectToken({
    clientId: env.SLACK_CLIENT_ID!,
    clientSecret: env.SLACK_CLIENT_SECRET!,
    code,
    redirectUri: `${getAppUrl()}/api/slack/link/callback`,
  });

  if (!tokenResult.ok || !tokenResult.access_token) {
    logger.error("slack.link_token_failed", {
      slackError: !tokenResult.ok ? tokenResult.error : "missing access_token",
    });
    return backToApp(state.workspaceId, "error");
  }

  const userInfo = await openIdConnectUserInfo(tokenResult.access_token);
  const slackTeamId = userInfo["https://slack.com/team_id"];
  const slackUserId = userInfo["https://slack.com/user_id"] ?? userInfo.sub;

  if (!userInfo.ok || !slackTeamId || !slackUserId) {
    logger.error("slack.link_userinfo_failed", {
      slackError: !userInfo.ok ? userInfo.error : "missing team/user id",
    });
    return backToApp(state.workspaceId, "error");
  }

  await linkSlackUser({
    userId: session.user.id,
    slackTeamId,
    slackUserId,
  });

  return backToApp(state.workspaceId, "linked");
}

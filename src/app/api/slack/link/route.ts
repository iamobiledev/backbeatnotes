import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getServerEnv, getAppUrl } from "@/env/server";
import { isSlackConfigured } from "@/lib/slack/status";
import { createStateToken } from "@/lib/slack/state";

export const runtime = "nodejs";

/**
 * Starts the Sign-in-with-Slack (OIDC) flow to link the current user's
 * Slack identity to their Docloom account.
 * GET /api/slack/link?workspaceId=…   (workspaceId is only used to
 * redirect back to the right settings page afterwards)
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    const signIn = new URL("/sign-in", getAppUrl());
    signIn.searchParams.set("next", new URL(request.url).pathname);
    return NextResponse.redirect(signIn);
  }
  if (!isSlackConfigured()) {
    return NextResponse.json(
      { error: "Slack integration is not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId") ?? undefined;

  const env = getServerEnv();
  const state = createStateToken({
    kind: "link",
    workspaceId,
    userId: session.user.id,
  });

  const authorize = new URL("https://slack.com/openid/connect/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", env.SLACK_CLIENT_ID!);
  authorize.searchParams.set("scope", "openid email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set(
    "redirect_uri",
    `${getAppUrl()}/api/slack/link/callback`,
  );

  return NextResponse.redirect(authorize);
}

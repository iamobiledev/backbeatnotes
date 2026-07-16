import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAppUrl } from "@/env/server";
import { verifyGoogleStateToken } from "@/lib/google-docs/state";
import { exchangeCode, getUserInfo } from "@/lib/google-docs/client";
import { saveConnection } from "@/lib/google-docs/service";
import { logger } from "@/lib/logger";

function settingsRedirect(
  workspaceId: string,
  params: Record<string, string>,
) {
  const url = new URL(`/app/${workspaceId}/settings`, getAppUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.hash = "google-docs";
  return NextResponse.redirect(url);
}

/** Google redirects here after the user approves Drive access. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", getAppUrl()));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateToken = searchParams.get("state") ?? "";
  const oauthError = searchParams.get("error");
  const state = verifyGoogleStateToken(stateToken);

  if (!state) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }
  if (state.userId !== session.user.id) {
    return NextResponse.json({ error: "State/user mismatch" }, { status: 403 });
  }

  if (oauthError === "access_denied" || (!code && oauthError)) {
    return settingsRedirect(state.workspaceId, { google: "cancelled" });
  }
  if (!code) {
    return settingsRedirect(state.workspaceId, { google: "error" });
  }

  const tokens = await exchangeCode(code);
  if (!tokens.ok || !tokens.access_token) {
    logger.error("google.oauth_exchange_failed", {
      error: tokens.error ?? "missing_token",
    });
    return settingsRedirect(state.workspaceId, { google: "error" });
  }
  if (!tokens.refresh_token) {
    logger.error("google.oauth_missing_refresh_token", {
      userId: session.user.id,
    });
    return settingsRedirect(state.workspaceId, { google: "error" });
  }

  const profile = await getUserInfo(tokens.access_token);
  if (!profile) {
    logger.error("google.oauth_userinfo_failed", {
      userId: session.user.id,
    });
    return settingsRedirect(state.workspaceId, { google: "error" });
  }

  const expiresInSec = tokens.expires_in ?? 3600;
  await saveConnection({
    userId: session.user.id,
    googleAccountEmail: profile.email,
    googleAccountId: profile.id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
    scopes: tokens.scope ?? "",
  });

  return settingsRedirect(state.workspaceId, { google: "connected" });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { requireMembership } from "@/lib/permissions";
import { getWorkspaceById } from "@/lib/workspaces/service";
import { getAppUrl } from "@/env/server";
import { isGoogleDocsConfigured } from "@/lib/google-docs/status";
import { createGoogleStateToken } from "@/lib/google-docs/state";
import { googleAuthorizeUrl } from "@/lib/google-docs/client";

/**
 * Starts the Google OAuth connect flow for Docs import.
 * GET /api/google/oauth/start?workspaceId=…
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/sign-in", getAppUrl()));
  }
  if (!isGoogleDocsConfigured()) {
    return NextResponse.json(
      { error: "Google Docs import is not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId") ?? "";
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: "Invalid workspace" }, { status: 400 });
  }

  try {
    await requireMembership(session.user.id, workspaceId, "member");
  } catch {
    return NextResponse.json(
      { error: "You need workspace membership to connect Google Docs" },
      { status: 403 },
    );
  }

  const state = createGoogleStateToken({
    userId: session.user.id,
    workspaceId,
  });

  return NextResponse.redirect(googleAuthorizeUrl(state));
}

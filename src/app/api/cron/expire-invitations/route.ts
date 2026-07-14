import { NextResponse } from "next/server";
import { expireOldInvitations } from "@/lib/workspaces/service";
import { logger } from "@/lib/logger";

/**
 * Protected Vercel Cron: expire pending invitations past their expiry.
 * Configure in vercel.json. Authorize with CRON_SECRET bearer token.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const count = await expireOldInvitations();
    logger.info("cron.expire_invitations", { count });
    return NextResponse.json({ ok: true, expired: count });
  } catch (error) {
    logger.error("cron.expire_invitations.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}

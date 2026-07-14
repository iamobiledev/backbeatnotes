import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, session } from "@/db";
import { logger } from "@/lib/logger";

/**
 * Sign out from all devices: revoke every session for the current user.
 */
export async function POST() {
  const auth = getAuth();
  const current = await auth.api.getSession({
    headers: await headers(),
  });

  if (!current?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    await db.delete(session).where(eq(session.userId, current.user.id));
    logger.info("auth.revoke_all_sessions", { userId: current.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("auth.revoke_all_sessions.error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

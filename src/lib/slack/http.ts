import "server-only";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/env/server";
import { verifySlackSignature } from "./verify";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Shared request handling for Slack webhook endpoints:
 * configuration check → signature verification → rate limiting.
 */

export type VerifiedSlackRequest =
  | { ok: true; rawBody: string }
  | { ok: false; response: NextResponse };

export async function verifySlackRequest(
  request: Request,
  routeName: string,
): Promise<VerifiedSlackRequest> {
  const env = getServerEnv();
  if (!env.SLACK_SIGNING_SECRET) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Slack integration is not configured" },
        { status: 503 },
      ),
    };
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  const verified = verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    timestamp,
    signature,
    rawBody,
  });

  if (!verified) {
    logger.warn("slack.invalid_signature", { route: routeName });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "invalid signature" },
        { status: 401 },
      ),
    };
  }

  const limited = rateLimit({
    key: `slack:${routeName}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.allowed) {
    logger.warn("slack.rate_limited", { route: routeName });
    return {
      ok: false,
      response: new NextResponse(null, { status: 429 }),
    };
  }

  return { ok: true, rawBody };
}

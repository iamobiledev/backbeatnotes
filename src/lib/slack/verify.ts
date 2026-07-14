import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack request signature verification (v0 scheme).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */

export const SLACK_SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

export function computeSlackSignature(opts: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
}): string {
  const base = `${SLACK_SIGNATURE_VERSION}:${opts.timestamp}:${opts.rawBody}`;
  const hmac = createHmac("sha256", opts.signingSecret)
    .update(base)
    .digest("hex");
  return `${SLACK_SIGNATURE_VERSION}=${hmac}`;
}

export function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowSeconds?: number;
}): boolean {
  if (!opts.timestamp || !opts.signature) return false;

  // Reject stale requests (replay protection).
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const expected = computeSlackSignature({
    signingSecret: opts.signingSecret,
    timestamp: opts.timestamp,
    rawBody: opts.rawBody,
  });

  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/env/server";

/**
 * Signed, short-lived state tokens for the Slack OAuth flows
 * (CSRF protection). HMAC-SHA256 with the app auth secret.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

type StatePayload = {
  kind: "install" | "link";
  workspaceId?: string;
  userId: string;
  exp: number;
};

function sign(data: string): string {
  const secret = getServerEnv().BETTER_AUTH_SECRET;
  return createHmac("sha256", `slack-state:${secret}`)
    .update(data)
    .digest("base64url");
}

export function createStateToken(
  payload: Omit<StatePayload, "exp">,
): string {
  const full: StatePayload = { ...payload, exp: Date.now() + STATE_TTL_MS };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyStateToken(token: string): StatePayload | null {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  const expected = sign(data);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as StatePayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

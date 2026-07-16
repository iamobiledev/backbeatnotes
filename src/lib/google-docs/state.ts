import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/env/server";

/**
 * Signed, short-lived state tokens for the Google OAuth connect flow
 * (CSRF protection). HMAC-SHA256 with the app auth secret.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleStatePayload = {
  kind: "google_connect";
  userId: string;
  /** Workspace to return to after OAuth (Settings page). */
  workspaceId: string;
  exp: number;
};

function sign(data: string): string {
  const secret = getServerEnv().BETTER_AUTH_SECRET;
  return createHmac("sha256", `google-state:${secret}`)
    .update(data)
    .digest("base64url");
}

export function createGoogleStateToken(
  payload: Omit<GoogleStatePayload, "exp" | "kind"> & {
    kind?: "google_connect";
  },
): string {
  const full: GoogleStatePayload = {
    kind: "google_connect",
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    exp: Date.now() + STATE_TTL_MS,
  };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyGoogleStateToken(
  token: string,
): GoogleStatePayload | null {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  const expected = sign(data);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as GoogleStatePayload;
    if (payload.kind !== "google_connect") return null;
    if (payload.exp < Date.now()) return null;
    if (!payload.userId || !payload.workspaceId) return null;
    return payload;
  } catch {
    return null;
  }
}

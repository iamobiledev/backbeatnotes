import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, googleConnections } from "@/db";
import { encryptGoogleToken, decryptGoogleToken } from "./crypto";
import { refreshAccessToken } from "./client";
import { logger } from "@/lib/logger";

export type GoogleConnection = {
  id: string;
  userId: string;
  googleAccountEmail: string;
  googleAccountId: string;
  scopes: string;
  accessTokenExpiresAt: Date;
};

export async function saveConnection(opts: {
  userId: string;
  googleAccountEmail: string;
  googleAccountId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scopes: string;
}) {
  const db = getDb();
  const encryptedAccessToken = encryptGoogleToken(opts.accessToken);
  const encryptedRefreshToken = encryptGoogleToken(opts.refreshToken);
  const now = new Date();

  const existing = await getConnectionForUser(opts.userId);
  if (existing) {
    await db
      .update(googleConnections)
      .set({
        googleAccountEmail: opts.googleAccountEmail,
        googleAccountId: opts.googleAccountId,
        encryptedAccessToken,
        encryptedRefreshToken,
        accessTokenExpiresAt: opts.accessTokenExpiresAt,
        scopes: opts.scopes,
        updatedAt: now,
      })
      .where(eq(googleConnections.userId, opts.userId));
    return;
  }

  await db.insert(googleConnections).values({
    id: nanoid(),
    userId: opts.userId,
    googleAccountEmail: opts.googleAccountEmail,
    googleAccountId: opts.googleAccountId,
    encryptedAccessToken,
    encryptedRefreshToken,
    accessTokenExpiresAt: opts.accessTokenExpiresAt,
    scopes: opts.scopes,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteConnection(userId: string) {
  const db = getDb();
  await db
    .delete(googleConnections)
    .where(eq(googleConnections.userId, userId));
}

export const getConnectionForUser = cache(async function getConnectionForUser(
  userId: string,
): Promise<GoogleConnection | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: googleConnections.id,
      userId: googleConnections.userId,
      googleAccountEmail: googleConnections.googleAccountEmail,
      googleAccountId: googleConnections.googleAccountId,
      scopes: googleConnections.scopes,
      accessTokenExpiresAt: googleConnections.accessTokenExpiresAt,
    })
    .from(googleConnections)
    .where(eq(googleConnections.userId, userId))
    .limit(1);
  return row ?? null;
});

/**
 * Return a valid access token for the user, refreshing when close to expiry.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(googleConnections)
    .where(eq(googleConnections.userId, userId))
    .limit(1);
  if (!row) throw new Error("GOOGLE_NOT_CONNECTED");

  const refreshSkewMs = 60_000;
  const stillValid =
    row.accessTokenExpiresAt.getTime() - refreshSkewMs > Date.now();
  if (stillValid) {
    return decryptGoogleToken(row.encryptedAccessToken);
  }

  const refreshToken = decryptGoogleToken(row.encryptedRefreshToken);
  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed.ok || !refreshed.access_token) {
    logger.error("google.token_refresh_failed", {
      userId,
      error: refreshed.error ?? "missing_access_token",
    });
    throw new Error("GOOGLE_TOKEN_REFRESH_FAILED");
  }

  const expiresInSec = refreshed.expires_in ?? 3600;
  const accessTokenExpiresAt = new Date(Date.now() + expiresInSec * 1000);
  const encryptedAccessToken = encryptGoogleToken(refreshed.access_token);
  // Google may omit refresh_token on refresh; keep the existing one.
  const encryptedRefreshToken = refreshed.refresh_token
    ? encryptGoogleToken(refreshed.refresh_token)
    : row.encryptedRefreshToken;

  await db
    .update(googleConnections)
    .set({
      encryptedAccessToken,
      encryptedRefreshToken,
      accessTokenExpiresAt,
      scopes: refreshed.scope ?? row.scopes,
      updatedAt: new Date(),
    })
    .where(eq(googleConnections.id, row.id));

  return refreshed.access_token;
}

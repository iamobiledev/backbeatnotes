import "server-only";
import {
  encryptToken as encryptWithKey,
  decryptToken as decryptWithKey,
} from "@/lib/slack/crypto";
import { getServerEnv } from "@/env/server";

/**
 * Encrypt/decrypt Google OAuth tokens at rest.
 * Prefers GOOGLE_TOKEN_ENCRYPTION_KEY; falls back to SLACK_TOKEN_ENCRYPTION_KEY
 * so local setups only need one encryption key.
 */

function encryptionKey(): string {
  const env = getServerEnv();
  const key =
    env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? env.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY (or SLACK_TOKEN_ENCRYPTION_KEY) is required to store Google tokens",
    );
  }
  return key;
}

export function encryptGoogleToken(plaintext: string): string {
  return encryptWithKey(plaintext, encryptionKey());
}

export function decryptGoogleToken(payload: string): string {
  return decryptWithKey(payload, encryptionKey());
}

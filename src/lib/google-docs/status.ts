import "server-only";

export type GoogleDocsStatus = {
  /** Google OAuth client credentials are present in the environment. */
  configured: boolean;
  /** The current user has connected a Google account. */
  connected: boolean;
  email: string | null;
};

export function isGoogleDocsConfigured(): boolean {
  const hasClient =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET);
  const hasKey =
    Boolean(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY) ||
    Boolean(process.env.SLACK_TOKEN_ENCRYPTION_KEY);
  return hasClient && hasKey;
}

/**
 * Resolve Google Docs import status for the current user (Settings UI).
 */
export async function getGoogleDocsStatus(
  userId: string,
): Promise<GoogleDocsStatus> {
  if (!isGoogleDocsConfigured()) {
    return { configured: false, connected: false, email: null };
  }
  const { getConnectionForUser } = await import("./service");
  const connection = await getConnectionForUser(userId);
  return {
    configured: true,
    connected: Boolean(connection),
    email: connection?.googleAccountEmail ?? null,
  };
}

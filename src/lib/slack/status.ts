import "server-only";

export type SlackStatus = {
  /** Slack app credentials are present in the environment. */
  configured: boolean;
  /** This workspace has an active Slack connection. */
  connected: boolean;
  teamName: string | null;
};

export function isSlackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_CLIENT_ID &&
      process.env.SLACK_CLIENT_SECRET &&
      process.env.SLACK_SIGNING_SECRET &&
      process.env.SLACK_TOKEN_ENCRYPTION_KEY,
  );
}

/**
 * Resolve the Slack status for a workspace (used by share dialog/settings).
 */
export async function getSlackStatus(workspaceId: string): Promise<SlackStatus> {
  if (!isSlackConfigured()) {
    return { configured: false, connected: false, teamName: null };
  }
  const { getConnectionForWorkspace } = await import("./service");
  const connection = await getConnectionForWorkspace(workspaceId);
  return {
    configured: true,
    connected: Boolean(connection),
    teamName: connection?.slackTeamName ?? null,
  };
}

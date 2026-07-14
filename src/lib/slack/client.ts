import "server-only";
import { getServerEnv } from "@/env/server";
import { logger } from "@/lib/logger";

/**
 * Thin, typed Slack Web API client (fetch-based — no SDK).
 * Only the handful of methods this app needs. All calls log failures with
 * context and return `ok: false` instead of throwing, so Slack problems can
 * never break user-facing flows.
 */

export type SlackApiResult<T = Record<string, unknown>> = (
  | { ok: true }
  | { ok: false; error: string }
) &
  T;

function apiBase(): string {
  return (
    getServerEnv().SLACK_API_BASE?.replace(/\/$/, "") ?? "https://slack.com/api"
  );
}

async function slackCall<T = Record<string, unknown>>(
  method: string,
  opts: {
    token?: string;
    /** JSON body (POST). */
    json?: Record<string, unknown>;
    /** Form-encoded body (POST) — used for oauth.access. */
    form?: Record<string, string>;
    context?: Record<string, unknown>;
  },
): Promise<SlackApiResult<T>> {
  const url = `${apiBase()}/${method}`;
  const headers: Record<string, string> = {};
  let body: string;

  if (opts.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  } else {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(opts.json ?? {});
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await response.json()) as SlackApiResult<T>;
    if (!data.ok) {
      logger.warn("slack.api_error", {
        method,
        slackError: (data as { error?: string }).error ?? "unknown",
        status: response.status,
        ...opts.context,
      });
    }
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("slack.api_request_failed", {
      method,
      error: message,
      ...opts.context,
    });
    return { ok: false, error: `request_failed: ${message}` } as SlackApiResult<T>;
  }
}

/* ------------------------------- OAuth ---------------------------------- */

export type OAuthAccessResponse = {
  access_token?: string;
  bot_user_id?: string;
  scope?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string };
};

export async function oauthAccess(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  return slackCall<OAuthAccessResponse>("oauth.v2.access", {
    form: {
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    },
  });
}

export type OpenIdTokenResponse = {
  id_token?: string;
  access_token?: string;
};

/** Sign in with Slack (OIDC) — exchange the code for an id_token. */
export async function openIdConnectToken(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  return slackCall<OpenIdTokenResponse>("openid.connect.token", {
    form: {
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    },
  });
}

export type OpenIdUserInfoResponse = {
  sub?: string;
  email?: string;
  name?: string;
  "https://slack.com/team_id"?: string;
  "https://slack.com/user_id"?: string;
};

export async function openIdConnectUserInfo(accessToken: string) {
  return slackCall<OpenIdUserInfoResponse>("openid.connect.userInfo", {
    token: accessToken,
    form: {},
  });
}

/* ------------------------------ Messaging -------------------------------- */

export type SlackBlock = Record<string, unknown>;

export async function chatUnfurl(opts: {
  token: string;
  channel: string;
  ts: string;
  unfurls: Record<string, { blocks: SlackBlock[] }>;
  /** Prefer unfurl_id + source when provided by the event. */
  unfurlId?: string;
  source?: string;
}) {
  const payload: Record<string, unknown> = {
    unfurls: JSON.stringify(opts.unfurls),
  };
  if (opts.unfurlId && opts.source) {
    payload.unfurl_id = opts.unfurlId;
    payload.source = opts.source;
  } else {
    payload.channel = opts.channel;
    payload.ts = opts.ts;
  }
  return slackCall("chat.unfurl", {
    token: opts.token,
    json: payload,
    context: { channel: opts.channel },
  });
}

export async function chatPostMessage(opts: {
  token: string;
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
}) {
  return slackCall<{ ts?: string; channel?: string }>("chat.postMessage", {
    token: opts.token,
    json: {
      channel: opts.channel,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
      ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
      unfurl_links: false,
    },
    context: { channel: opts.channel },
  });
}

export async function chatPostEphemeral(opts: {
  token: string;
  channel: string;
  user: string;
  text: string;
  blocks?: SlackBlock[];
}) {
  return slackCall("chat.postEphemeral", {
    token: opts.token,
    json: {
      channel: opts.channel,
      user: opts.user,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
    },
    context: { channel: opts.channel },
  });
}

export type SlackChannel = {
  id: string;
  name: string;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
};

export async function listConversations(opts: {
  token: string;
  cursor?: string;
}) {
  return slackCall<{
    channels?: SlackChannel[];
    response_metadata?: { next_cursor?: string };
  }>("conversations.list", {
    token: opts.token,
    form: {
      types: "public_channel",
      exclude_archived: "true",
      limit: "200",
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
    },
  });
}

/** POST to a slash-command/interactivity response_url. */
export async function respondViaResponseUrl(
  responseUrl: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      logger.warn("slack.response_url_failed", { status: response.status });
    }
    return response.ok;
  } catch (error) {
    logger.error("slack.response_url_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

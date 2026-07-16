import "server-only";
import { getServerEnv, getAppUrl } from "@/env/server";
import { logger } from "@/lib/logger";

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
].join(" ");

export function googleOAuthRedirectUri(): string {
  return `${getAppUrl()}/api/google/oauth/callback`;
}

export function googleAuthorizeUrl(state: string): string {
  const env = getServerEnv();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", googleOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenSuccess = {
  ok: true;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: undefined;
};

type TokenFailure = {
  ok: false;
  error: string;
  access_token?: undefined;
  refresh_token?: undefined;
  expires_in?: undefined;
  scope?: undefined;
};

export type TokenResponse = TokenSuccess | TokenFailure;

async function tokenRequest(
  body: Record<string, string>,
  context: Record<string, unknown>,
): Promise<TokenResponse> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      id_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !data.access_token) {
      const error =
        data.error_description ?? data.error ?? `http_${response.status}`;
      logger.warn("google.token_error", { error, ...context });
      return { ok: false, error };
    }
    return {
      ok: true,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      scope: data.scope,
      token_type: data.token_type,
      id_token: data.id_token,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("google.token_request_failed", { error: message, ...context });
    return { ok: false, error: `request_failed: ${message}` };
  }
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const env = getServerEnv();
  return tokenRequest(
    {
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleOAuthRedirectUri(),
      grant_type: "authorization_code",
    },
    { flow: "exchange" },
  );
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const env = getServerEnv();
  return tokenRequest(
    {
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    },
    { flow: "refresh" },
  );
}

export type GoogleUserInfo = {
  id: string;
  email: string;
  name?: string;
};

export async function getUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo | null> {
  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      logger.warn("google.userinfo_failed", { status: response.status });
      return null;
    }
    const data = (await response.json()) as {
      id?: string;
      email?: string;
      name?: string;
    };
    if (!data.id || !data.email) return null;
    return { id: data.id, email: data.email, name: data.name };
  } catch (error) {
    logger.error("google.userinfo_request_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export type GoogleDocListItem = {
  id: string;
  name: string;
  modifiedTime: string | null;
  webViewLink: string | null;
};

export type ListGoogleDocsResult =
  | {
      ok: true;
      files: GoogleDocListItem[];
      nextPageToken: string | null;
    }
  | { ok: false; error: string };

export async function listGoogleDocs(opts: {
  accessToken: string;
  pageToken?: string | null;
  query?: string | null;
  pageSize?: number;
}): Promise<ListGoogleDocsResult> {
  const qParts = ["mimeType = 'application/vnd.google-apps.document'", "trashed = false"];
  const trimmed = opts.query?.trim();
  if (trimmed) {
    // Escape single quotes for Drive query syntax.
    const safe = trimmed.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    qParts.push(`name contains '${safe}'`);
  }

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", qParts.join(" and "));
  url.searchParams.set("pageSize", String(opts.pageSize ?? 25));
  url.searchParams.set(
    "fields",
    "nextPageToken, files(id, name, modifiedTime, webViewLink)",
  );
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json()) as {
      files?: Array<{
        id?: string;
        name?: string;
        modifiedTime?: string;
        webViewLink?: string;
      }>;
      nextPageToken?: string;
      error?: { message?: string; code?: number };
    };
    if (!response.ok) {
      const error =
        data.error?.message ?? `http_${response.status}`;
      logger.warn("google.drive_list_failed", { error });
      return { ok: false, error };
    }
    const files: GoogleDocListItem[] = (data.files ?? [])
      .filter((f): f is { id: string; name: string; modifiedTime?: string; webViewLink?: string } =>
        Boolean(f.id && f.name),
      )
      .map((f) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime ?? null,
        webViewLink: f.webViewLink ?? null,
      }));
    return {
      ok: true,
      files,
      nextPageToken: data.nextPageToken ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("google.drive_list_request_failed", { error: message });
    return { ok: false, error: `request_failed: ${message}` };
  }
}

export type ExportResult =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; error: string };

/** Export a Google Doc as the HTML zip Drive returns for text/html / application/zip. */
export async function exportGoogleDocHtmlZip(opts: {
  accessToken: string;
  fileId: string;
}): Promise<ExportResult> {
  // Drive documents export HTML as application/zip (HTML + images).
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(opts.fileId)}/export`,
  );
  url.searchParams.set("mimeType", "application/zip");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      let error = `http_${response.status}`;
      try {
        const data = (await response.json()) as {
          error?: { message?: string };
        };
        if (data.error?.message) error = data.error.message;
      } catch {
        /* ignore */
      }
      logger.warn("google.drive_export_failed", {
        fileId: opts.fileId,
        error,
      });
      return { ok: false, error };
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      bytes: buffer,
      contentType: response.headers.get("content-type") ?? "application/zip",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("google.drive_export_request_failed", {
      fileId: opts.fileId,
      error: message,
    });
    return { ok: false, error: `request_failed: ${message}` };
  }
}

export async function getGoogleFileMeta(opts: {
  accessToken: string;
  fileId: string;
}): Promise<
  | { ok: true; id: string; name: string; webViewLink: string | null }
  | { ok: false; error: string }
> {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(opts.fileId)}`,
  );
  url.searchParams.set("fields", "id, name, webViewLink, mimeType");
  url.searchParams.set("supportsAllDrives", "true");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json()) as {
      id?: string;
      name?: string;
      webViewLink?: string;
      mimeType?: string;
      error?: { message?: string };
    };
    if (!response.ok || !data.id || !data.name) {
      return {
        ok: false,
        error: data.error?.message ?? `http_${response.status}`,
      };
    }
    if (data.mimeType && data.mimeType !== "application/vnd.google-apps.document") {
      return { ok: false, error: "NOT_A_GOOGLE_DOC" };
    }
    return {
      ok: true,
      id: data.id,
      name: data.name,
      webViewLink: data.webViewLink ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

import "server-only";
import { z } from "zod";
import { brand } from "@/config/brand";

/**
 * Server-only environment variables.
 * Never import this module from Client Components.
 *
 * Set SKIP_ENV_VALIDATION=1 for lint/typecheck without a full .env.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /** Pooled Neon connection string (use for app queries on Vercel) */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Direct / unpooled Neon connection (use for migrations) */
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  /** Better Auth secret — generate with `openssl rand -base64 32` */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be ≥32 chars"),
  /** Canonical application URL (no trailing slash) */
  BETTER_AUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  /** Resend (or compatible) transactional email */
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),

  /** Vercel Blob read/write token */
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),

  /** Protects Vercel Cron route handlers */
  CRON_SECRET: z.string().min(1).optional(),

  /** Optional: document Neon primary region */
  NEON_REGION: z.string().optional(),

  /* --- Slack integration (all optional; features disable gracefully) --- */
  /** Slack app client id (from api.slack.com → App credentials) */
  SLACK_CLIENT_ID: z.string().min(1).optional(),
  /** Slack app client secret */
  SLACK_CLIENT_SECRET: z.string().min(1).optional(),
  /** Slack app signing secret — verifies incoming Slack requests */
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  /** 32-byte base64 key for encrypting Slack tokens at rest.
   *  Generate with: openssl rand -base64 32 */
  SLACK_TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  /** Override the Slack API base URL (tests/mocks only) */
  SLACK_API_BASE: z.string().url().optional(),

  /* --- Google Docs import (all optional; features disable gracefully) --- */
  /** Google OAuth client id (Google Cloud Console → Credentials) */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  /** Google OAuth client secret */
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** 32-byte base64 key for encrypting Google tokens at rest.
   *  Falls back to SLACK_TOKEN_ENCRYPTION_KEY when unset. */
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),

  /* --- Optional LLM for the @backbeat-notes Slack assistant --- */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(
      (issue) =>
        `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    )
    .join("\n");
}

let cached: ServerEnv | null = null;

/**
 * Validates and returns server environment variables.
 * Fails fast with a clear message when required vars are missing.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const isNextBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.SKIP_ENV_VALIDATION === "1" || isNextBuild) {
    cached = {
      NODE_ENV:
        (process.env.NODE_ENV as ServerEnv["NODE_ENV"]) ?? "development",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://user:pass@localhost:5432/docloom",
      DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "dev-only-secret-skip-validation-32ch",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
      NEXT_PUBLIC_APP_URL:
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      EMAIL_FROM: process.env.EMAIL_FROM,
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
      CRON_SECRET: process.env.CRON_SECRET,
      NEON_REGION: process.env.NEON_REGION,
      SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
      SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
      SLACK_TOKEN_ENCRYPTION_KEY: process.env.SLACK_TOKEN_ENCRYPTION_KEY,
      SLACK_API_BASE: process.env.SLACK_API_BASE,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    };
    return cached;
  }

  const parsed = serverEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : undefined),
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    CRON_SECRET: process.env.CRON_SECRET,
    NEON_REGION: process.env.NEON_REGION,
    SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
    SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    SLACK_TOKEN_ENCRYPTION_KEY: process.env.SLACK_TOKEN_ENCRYPTION_KEY,
    SLACK_API_BASE: process.env.SLACK_API_BASE,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${formatZodError(parsed.error)}\n\nSee .env.example for the full list.`,
    );
  }

  cached = parsed.data;
  return cached;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * App base URL used for auth callbacks, invitations, and public links.
 *
 * On Vercel Production this is always `brand.siteUrl` (`https://backbeatnotes.com`)
 * so a mis-set `NEXT_PUBLIC_APP_URL` / `BETTER_AUTH_URL` (e.g. a `*.vercel.app`
 * alias) cannot leak into invitation or OAuth emails. Preview and local still
 * follow env / `VERCEL_URL` / localhost.
 */
export function getAppUrl(): string {
  if (process.env.VERCEL_ENV === "production") {
    return stripTrailingSlash(brand.siteUrl);
  }

  const configured =
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (configured) return stripTrailingSlash(configured);
  return "http://localhost:3000";
}

/**
 * Rewrite an absolute app URL onto the Production canonical host.
 * Used for Better Auth verification/reset links that were built from the
 * request host (which may be a `*.vercel.app` alias). No-op outside Production.
 */
export function canonicalizeAppUrl(url: string): string {
  if (process.env.VERCEL_ENV !== "production") return url;
  try {
    const parsed = new URL(url);
    const canonical = new URL(brand.siteUrl);
    parsed.protocol = canonical.protocol;
    parsed.host = canonical.host;
    return parsed.toString();
  } catch {
    return url;
  }
}

function hostFromUrlOrHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("://")) return new URL(trimmed).host;
  } catch {
    return null;
  }
  // Host or host:port (optionally with a trailing slash / path to strip).
  return trimmed.replace(/\/.*$/, "") || null;
}

/**
 * Hostnames Better Auth may accept for per-request base URL resolution.
 * Covers the canonical app URL, Vercel production/preview aliases, and any
 * extra entries from `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated hosts or
 * origins). Better Auth also mirrors these into `trustedOrigins`.
 */
export function getAuthAllowedHosts(): string[] {
  const hosts = new Set<string>();
  const add = (value: string | undefined | null) => {
    if (!value) return;
    const host = hostFromUrlOrHost(value);
    if (host) hosts.add(host);
  };

  add(process.env.BETTER_AUTH_URL);
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.VERCEL_URL);
  add(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  add(process.env.VERCEL_BRANCH_URL);

  const extra = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (extra) {
    for (const part of extra.split(",")) add(part);
  }

  if (process.env.VERCEL || process.env.VERCEL_URL) {
    hosts.add("*.vercel.app");
  }

  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost:3000");
    hosts.add("127.0.0.1:3000");
  }

  if (hosts.size === 0) {
    hosts.add("localhost:3000");
  }

  return [...hosts];
}

/** Connection string for migrations (prefer unpooled / direct). */
export function getMigrationDatabaseUrl(): string {
  const env = getServerEnv();
  return env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
}

/**
 * Production-safe logging helpers.
 * Avoids dumping secrets; structured for Vercel log drains.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "database_url",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "BETTER_AUTH_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "RESEND_API_KEY",
  "CRON_SECRET",
]);

function sanitize(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEYS.has(key) || /secret|password|token|key/i.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

function log(level: LogLevel, message: string, fields?: LogFields) {
  const payload = {
    ...sanitize(fields),
    level,
    message,
    time: new Date().toISOString(),
  };

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug" && process.env.NODE_ENV !== "production")
    console.debug(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => log("debug", message, fields),
  info: (message: string, fields?: LogFields) => log("info", message, fields),
  warn: (message: string, fields?: LogFields) => log("warn", message, fields),
  error: (message: string, fields?: LogFields) => log("error", message, fields),
};

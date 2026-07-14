import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Post-deployment health check — does not expose secrets or DB credentials.
 */
export async function GET() {
  const checks = {
    ok: true,
    service: "docloom",
    time: new Date().toISOString(),
    env: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasAuthSecret: Boolean(process.env.BETTER_AUTH_SECRET),
      hasAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      hasResend: Boolean(process.env.RESEND_API_KEY),
      hasEmailFrom: Boolean(process.env.EMAIL_FROM),
      /** "resend" = real delivery; "console" = emails only logged, not sent. */
      emailDelivery:
        process.env.RESEND_API_KEY && process.env.EMAIL_FROM
          ? "resend"
          : "console-only",
      vercelEnv: process.env.VERCEL_ENV ?? "unknown",
      region: process.env.VERCEL_REGION ?? process.env.NEON_REGION ?? "unknown",
    },
  };

  return NextResponse.json(checks);
}

"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client uses a relative `/api/auth` base (Better Auth default
 * when `baseURL` is omitted). That keeps sign-in same-origin on every host
 * that serves this app — custom domains and `*.vercel.app` aliases alike —
 * and avoids CORS failures when `NEXT_PUBLIC_APP_URL` points at a different
 * deployment hostname than the page the user is viewing.
 *
 * Canonical absolute URLs for emails/callbacks still come from `getAppUrl()`
 * on the server.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;

export async function requestPasswordReset(opts: {
  email: string;
  redirectTo?: string;
}) {
  return authClient.requestPasswordReset({
    email: opts.email,
    redirectTo: opts.redirectTo,
  });
}

export async function resetPassword(opts: {
  newPassword: string;
  token: string;
}) {
  return authClient.resetPassword({
    newPassword: opts.newPassword,
    token: opts.token,
  });
}

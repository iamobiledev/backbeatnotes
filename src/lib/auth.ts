import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { sql } from "drizzle-orm";
import { getDb, user, session, account, verification } from "@/db";
import {
  getAppUrl,
  getAuthAllowedHosts,
  getGoogleAuthConfig,
  getServerEnv,
} from "@/env/server";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email";
import { brand } from "@/config/brand";
import {
  invitationBelongsToEmail,
  INVITATION_SIGN_UP_HEADER,
} from "@/lib/invitations";
import { autoJoinWorkspacesForUser } from "@/lib/workspaces/auto-join";
import { logger } from "@/lib/logger";

/**
 * Better Auth configured with Neon (via Drizzle) as the persistent store.
 * Sessions use secure cookies. Auth runs only on the server.
 */
export function createAuth() {
  const env = getServerEnv();
  const db = getDb();
  const fallbackUrl = getAppUrl();
  const google = getGoogleAuthConfig();

  return betterAuth({
    appName: brand.name,
    // Resolve the request host against an allowlist so custom domains and
    // Vercel aliases (e.g. backbeatnotes.com + *.vercel.app) all work.
    // `fallback` covers direct `auth.api` calls without request headers.
    baseURL: {
      allowedHosts: getAuthAllowedHosts(),
      fallback: fallbackUrl,
      protocol: process.env.NODE_ENV === "development" ? "http" : "https",
    },
    secret: env.BETTER_AUTH_SECRET,
    rateLimit: {
      // Browser suites intentionally create many short-lived sessions from
      // one loopback IP. Production keeps Better Auth's default protection.
      enabled: process.env.E2E_DISABLE_AUTH_RATE_LIMIT !== "1",
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user,
        session,
        account,
        verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user: u, url }) => {
        await sendPasswordResetEmail({ to: u.email, url });
      },
    },
    // Google sign-in (optional — enabled by GOOGLE_CLIENT_ID/SECRET).
    // When `GOOGLE_HOSTED_DOMAIN` is set we pass it as Better Auth's `hd`
    // option. Better Auth (≥1.6.16) sends that value as Google's account-
    // picker hint *and* enforces it in `verifyIdToken` / `getUserInfo` via
    // `isGoogleHostedDomainAllowed` against the verified id-token `hd`
    // claim. Do not override `getUserInfo` here — a custom callback replaces
    // that built-in check.
    ...(google
      ? {
          socialProviders: {
            google: {
              clientId: google.clientId,
              clientSecret: google.clientSecret,
              prompt: "select_account" as const,
              ...(google.hostedDomain ? { hd: google.hostedDomain } : {}),
            },
          },
        }
      : {}),
    account: {
      accountLinking: {
        // A Google sign-in whose verified email matches an existing
        // (verified) email/password user links into that same user row —
        // teammates keep one account when they switch to Google.
        enabled: true,
        trustedProviders: ["google"],
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: u, url }, request) => {
        const invitationToken = request?.headers.get(
          INVITATION_SIGN_UP_HEADER,
        );
        if (
          invitationToken &&
          (await invitationBelongsToEmail(invitationToken, u.email))
        ) {
          // The pending invitation link already proves control of this exact
          // email address. The invitation action verifies the newly-created
          // account before signing in, so a second verification email would
          // only send the user out of the onboarding flow.
          return;
        }
        await sendVerificationEmail({
          to: u.email,
          url,
          name: u.name,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh daily
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    user: {
      additionalFields: {
        /** Platform user type: 'admin' | 'developer'. Never client-settable. */
        role: {
          type: "string",
          defaultValue: "developer",
          input: false,
        },
        /** Document-activity email opt-out. */
        emailNotifications: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Bootstrap: the very first account becomes a platform admin.
          before: async (newUser) => {
            const [{ count }] = (
              await db.execute(sql`SELECT count(*)::int AS count FROM "user"`)
            ).rows as Array<{ count: number }>;
            return {
              data: {
                ...newUser,
                role: Number(count) === 0 ? "admin" : "developer",
              },
            };
          },
        },
      },
      session: {
        create: {
          // Domain auto-join: whenever a session is created (email/password
          // sign-in, Google OAuth callback, post-verification auto sign-in),
          // idempotently add verified users to workspaces whose
          // `autoJoinDomain` matches their email domain. Failures are logged
          // and never block sign-in.
          after: async (newSession) => {
            try {
              const [u] = await db
                .select({
                  id: user.id,
                  email: user.email,
                  emailVerified: user.emailVerified,
                })
                .from(user)
                .where(sql`${user.id} = ${newSession.userId}`)
                .limit(1);
              if (u) {
                await autoJoinWorkspacesForUser({
                  userId: u.id,
                  email: u.email,
                  emailVerified: u.emailVerified,
                });
              }
            } catch (error) {
              logger.error("workspace.auto_join_failed", {
                userId: newSession.userId,
                error:
                  error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
      },
    },
    plugins: [nextCookies()],
    // allowedHosts (via dynamic baseURL) + BETTER_AUTH_TRUSTED_ORIGINS env
    // are merged into trustedOrigins by Better Auth automatically.
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __docloomAuth?: Auth };

/** Construct Better Auth once per warm runtime, not once per session read. */
export function getAuth(): Auth {
  if (!globalForAuth.__docloomAuth) {
    globalForAuth.__docloomAuth = createAuth();
  }
  return globalForAuth.__docloomAuth;
}

export const auth = {
  get api() {
    return getAuth().api;
  },
  get handler() {
    return getAuth().handler;
  },
};

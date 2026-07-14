import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { sql } from "drizzle-orm";
import { getDb, user, session, account, verification } from "@/db";
import { getAppUrl, getServerEnv } from "@/env/server";
import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email";
import { brand } from "@/config/brand";

/**
 * Better Auth configured with Neon (via Drizzle) as the persistent store.
 * Sessions use secure cookies. Auth runs only on the server.
 */
export function createAuth() {
  const env = getServerEnv();
  const db = getDb();

  return betterAuth({
    appName: brand.name,
    baseURL: getAppUrl(),
    secret: env.BETTER_AUTH_SECRET,
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
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: u, url }) => {
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
    },
    plugins: [nextCookies()],
    trustedOrigins: [getAppUrl()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __docloomAuth?: Auth };

export function getAuth(): Auth {
  if (process.env.NODE_ENV === "production") {
    return createAuth();
  }
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

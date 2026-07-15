"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb, user } from "@/db";
import { getAuth } from "@/lib/auth";
import {
  getInvitationAccount,
  getInvitationByToken,
  invitationMatchesEmail,
  INVITATION_SIGN_UP_HEADER,
  isInvitationActive,
} from "@/lib/invitations";
import { logger } from "@/lib/logger";

export type InvitationAuthResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "ACCOUNT_EXISTS"
        | "INVALID_CREDENTIALS"
        | "EMAIL_NOT_VERIFIED"
        | "INVITATION_INVALID"
        | "VALIDATION_ERROR"
        | "UNKNOWN";
      error: string;
    };

const tokenSchema = z.string().min(1).max(128);

const registrationSchema = z
  .object({
    token: tokenSchema,
    name: z
      .string()
      .trim()
      .min(1, "Enter your name.")
      .max(100, "Name must be 100 characters or fewer."),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password must be 128 characters or fewer."),
    confirmPassword: z.string(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

const signInSchema = z.object({
  token: tokenSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

function validationError(error: z.ZodError): InvitationAuthResult {
  return {
    ok: false,
    code: "VALIDATION_ERROR",
    error: error.issues[0]?.message ?? "Check your details and try again.",
  };
}

async function requireActiveInvitation(token: string) {
  const invitation = await getInvitationByToken(token);
  return invitation && isInvitationActive(invitation) ? invitation : null;
}

function authError(error: unknown): InvitationAuthResult {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "body" in error
      ? String(
          (error as { body?: { code?: unknown } }).body?.code ?? "",
        )
      : "";

  if (
    code === "INVALID_EMAIL_OR_PASSWORD" ||
    message.toLowerCase().includes("invalid email or password")
  ) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      error: "The password is incorrect. Try again.",
    };
  }
  if (
    code === "EMAIL_NOT_VERIFIED" ||
    message.toLowerCase().includes("email not verified")
  ) {
    return {
      ok: false,
      code: "EMAIL_NOT_VERIFIED",
      error:
        "Verify this account’s email before continuing, or use the password reset link if you need help signing in.",
    };
  }

  logger.error("invitation.auth_failed", { code: code || "UNKNOWN" });
  return {
    ok: false,
    code: "UNKNOWN",
    error: "We couldn’t continue with this invitation. Please try again.",
  };
}

export async function actionRegisterForInvitation(input: {
  token: string;
  name: string;
  password: string;
  confirmPassword: string;
}): Promise<InvitationAuthResult> {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const invitation = await requireActiveInvitation(parsed.data.token);
  if (!invitation) {
    return {
      ok: false,
      code: "INVITATION_INVALID",
      error: "This invitation is no longer valid.",
    };
  }

  if (await getInvitationAccount(invitation.email)) {
    return {
      ok: false,
      code: "ACCOUNT_EXISTS",
      error: "An account already exists for this email. Sign in instead.",
    };
  }

  try {
    const requestHeaders = new Headers(await headers());
    requestHeaders.set(INVITATION_SIGN_UP_HEADER, invitation.token);
    const auth = getAuth();
    const signUp = await auth.api.signUpEmail({
      body: {
        email: invitation.email,
        name: parsed.data.name,
        password: parsed.data.password,
        callbackURL: `/invitations/${encodeURIComponent(invitation.token)}`,
      },
      headers: requestHeaders,
    });

    // Re-check the bearer proof after Better Auth creates the credential
    // account. This also prevents a revoke racing the registration request.
    const currentInvitation = await requireActiveInvitation(invitation.token);
    if (
      !currentInvitation ||
      !invitationMatchesEmail(currentInvitation, signUp.user.email)
    ) {
      return {
        ok: false,
        code: "INVITATION_INVALID",
        error: "This invitation is no longer valid.",
      };
    }

    const db = getDb();
    const [verifiedUser] = await db
      .update(user)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(
        and(
          eq(user.id, signUp.user.id),
          eq(user.email, currentInvitation.email),
          eq(user.emailVerified, false),
        ),
      )
      .returning({ id: user.id });

    // Better Auth returns a synthetic user for a duplicate email while email
    // verification is required. Only its concrete newly-created id can pass
    // the guarded update above.
    if (!verifiedUser) {
      return {
        ok: false,
        code: "ACCOUNT_EXISTS",
        error: "An account already exists for this email. Sign in instead.",
      };
    }

    await auth.api.signInEmail({
      body: {
        email: currentInvitation.email,
        password: parsed.data.password,
      },
      headers: requestHeaders,
    });
    logger.info("invitation.account_created", { userId: verifiedUser.id });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

export async function actionSignInForInvitation(input: {
  token: string;
  password: string;
}): Promise<InvitationAuthResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);

  const invitation = await requireActiveInvitation(parsed.data.token);
  if (!invitation) {
    return {
      ok: false,
      code: "INVITATION_INVALID",
      error: "This invitation is no longer valid.",
    };
  }

  try {
    await getAuth().api.signInEmail({
      body: {
        email: invitation.email,
        password: parsed.data.password,
      },
      headers: await headers(),
    });
    return { ok: true };
  } catch (error) {
    return authError(error);
  }
}

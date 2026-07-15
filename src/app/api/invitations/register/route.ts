import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, user } from "@/db";
import { getAppUrl } from "@/env/server";
import { getAuth } from "@/lib/auth";
import {
  getInvitationAccount,
  getInvitationByToken,
  invitationMatchesEmail,
  INVITATION_SIGN_UP_HEADER,
  isInvitationActive,
} from "@/lib/invitations";
import { logger } from "@/lib/logger";

type RegistrationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "ACCOUNT_EXISTS"
        | "INVITATION_INVALID"
        | "VALIDATION_ERROR"
        | "UNKNOWN";
      error: string;
    };

const registrationSchema = z
  .object({
    token: z.string().min(1).max(128),
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

function json(result: RegistrationResult) {
  return Response.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Check your details and try again.",
    });
  }

  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return json({
      ok: false,
      code: "VALIDATION_ERROR",
      error:
        parsed.error.issues[0]?.message ??
        "Check your details and try again.",
    });
  }

  const invitation = await getInvitationByToken(parsed.data.token);
  if (!invitation || !isInvitationActive(invitation)) {
    return json({
      ok: false,
      code: "INVITATION_INVALID",
      error: "This invitation is no longer valid.",
    });
  }

  if (await getInvitationAccount(invitation.email)) {
    return json({
      ok: false,
      code: "ACCOUNT_EXISTS",
      error: "An account already exists for this email. Sign in instead.",
    });
  }

  try {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(INVITATION_SIGN_UP_HEADER, invitation.token);
    const signUpRequest = new Request(
      `${getAppUrl()}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: requestHeaders,
      },
    );
    const signUp = await getAuth().api.signUpEmail({
      body: {
        email: invitation.email,
        name: parsed.data.name,
        password: parsed.data.password,
        callbackURL: `/invitations/${encodeURIComponent(invitation.token)}`,
      },
      headers: requestHeaders,
      request: signUpRequest,
      asResponse: false,
    });

    const currentInvitation = await getInvitationByToken(invitation.token);
    if (
      !currentInvitation ||
      !isInvitationActive(currentInvitation) ||
      !invitationMatchesEmail(currentInvitation, signUp.user.email)
    ) {
      return json({
        ok: false,
        code: "INVITATION_INVALID",
        error: "This invitation is no longer valid.",
      });
    }

    const [verifiedUser] = await getDb()
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

    if (!verifiedUser) {
      return json({
        ok: false,
        code: "ACCOUNT_EXISTS",
        error: "An account already exists for this email. Sign in instead.",
      });
    }

    logger.info("invitation.account_created", { userId: verifiedUser.id });
    return json({ ok: true });
  } catch (error) {
    const code =
      error && typeof error === "object" && "body" in error
        ? String(
            (error as { body?: { code?: unknown } }).body?.code ?? "",
          )
        : "";
    logger.error("invitation.auth_failed", { code: code || "UNKNOWN" });
    return json({
      ok: false,
      code: "UNKNOWN",
      error: "We couldn’t continue with this invitation. Please try again.",
    });
  }
}

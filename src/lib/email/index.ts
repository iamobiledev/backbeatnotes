import "server-only";
import { brand } from "@/config/brand";
import { getAppUrl, getServerEnv } from "@/env/server";
import { ConsoleEmailProvider } from "./types";
import { ResendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";
import { renderEmail, p, strong } from "./template";
import { logger } from "@/lib/logger";

let cached: EmailProvider | null = null;

export type EmailDelivery = "resend" | "console-only";
export type EmailProviderName = "resend" | "console";

export type EmailDeliveryStatus = {
  provider: EmailProviderName;
  delivery: EmailDelivery;
  configured: boolean;
  missing: Array<"RESEND_API_KEY" | "EMAIL_FROM">;
};

/**
 * Resolve outbound email delivery from environment-like values without
 * exposing secrets. Shared by runtime code, health checks, and tests.
 */
export function resolveEmailDeliveryStatus(env: {
  RESEND_API_KEY?: string | null;
  EMAIL_FROM?: string | null;
}): EmailDeliveryStatus {
  const missing: EmailDeliveryStatus["missing"] = [];
  if (!env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  if (!env.EMAIL_FROM) missing.push("EMAIL_FROM");

  const configured = missing.length === 0;
  return {
    provider: configured ? "resend" : "console",
    delivery: configured ? "resend" : "console-only",
    configured,
    missing,
  };
}

/** Secret-free status for the current server runtime. */
export function getEmailDeliveryStatus(): EmailDeliveryStatus {
  const env = getServerEnv();
  return resolveEmailDeliveryStatus({
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_FROM: env.EMAIL_FROM,
  });
}

/** Which provider the current configuration resolves to (no secrets). */
export function getEmailProviderName(): EmailProviderName {
  return getEmailDeliveryStatus().provider;
}

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  const env = getServerEnv();
  const status = resolveEmailDeliveryStatus({
    RESEND_API_KEY: env.RESEND_API_KEY,
    EMAIL_FROM: env.EMAIL_FROM,
  });
  if (status.provider === "resend") {
    cached = new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM!);
  } else {
    // Local-friendly fallback: emails are logged, never delivered. Make
    // this loud in production so misconfiguration is easy to spot.
    if (process.env.NODE_ENV === "production") {
      logger.warn("email.not_configured", {
        hint: "Set RESEND_API_KEY and EMAIL_FROM — emails are only being logged to the console, not delivered.",
        missing: status.missing,
      });
    }
    cached = new ConsoleEmailProvider();
  }
  return cached;
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export async function sendVerificationEmail(opts: {
  to: string;
  url: string;
  name?: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `Verify your email for ${brand.name}`,
    html: renderEmail({
      preheader: `Confirm your email address to start using ${brand.name}.`,
      heading: "Verify your email",
      paragraphsHtml: [
        p`Hi${opts.name ? ` ${opts.name}` : ""},`,
        p`Please confirm your email address to finish setting up your ${brand.name} account.`,
      ],
      cta: { label: "Verify email", url: opts.url },
      noteHtml: p`If you didn't create an account, you can safely ignore this message.`,
    }),
    text: `Verify your email: ${opts.url}`,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  url: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `Reset your ${brand.name} password`,
    html: renderEmail({
      preheader: `Reset the password for your ${brand.name} account.`,
      heading: "Reset your password",
      paragraphsHtml: [
        p`We received a request to reset the password for your ${brand.name} account.`,
      ],
      cta: { label: "Reset password", url: opts.url },
      noteHtml: p`If you didn't request this, you can safely ignore this message — your password won't change.`,
    }),
    text: `Reset your password: ${opts.url}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Workspace membership                                                        */
/* -------------------------------------------------------------------------- */

export async function sendWorkspaceJoinedEmail(opts: {
  to: string;
  memberName: string;
  workspaceName: string;
  workspaceUrl: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `You now have access to ${opts.workspaceName} on ${brand.name}`,
    html: renderEmail({
      preheader: `Every page in ${opts.workspaceName} is now available to you.`,
      heading: `Welcome to ${opts.workspaceName}`,
      paragraphsHtml: [
        p`Hi ${opts.memberName},`,
        `You've joined ${strong(opts.workspaceName)} on ${brand.name}. Every page in the workspace is now available to you.`,
      ],
      cta: { label: `Open ${opts.workspaceName}`, url: opts.workspaceUrl },
    }),
    text: `You've joined ${opts.workspaceName} on ${brand.name}: ${opts.workspaceUrl}`,
  });
}

export async function sendInvitationAcceptedEmail(opts: {
  to: string;
  inviterName: string;
  memberName: string;
  memberEmail: string;
  workspaceName: string;
  workspaceUrl: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `${opts.memberName} joined ${opts.workspaceName}`,
    html: renderEmail({
      preheader: `${opts.memberName} accepted your invitation.`,
      heading: `${opts.memberName} joined ${opts.workspaceName}`,
      paragraphsHtml: [
        p`Hi ${opts.inviterName},`,
        `${strong(opts.memberName)} (${p`${opts.memberEmail}`}) accepted your invitation and joined ${strong(opts.workspaceName)}.`,
      ],
      cta: { label: `Open ${opts.workspaceName}`, url: opts.workspaceUrl },
      showCtaUrlFallback: false,
    }),
    text: `${opts.memberName} (${opts.memberEmail}) joined ${opts.workspaceName}: ${opts.workspaceUrl}`,
  });
}

export async function sendWorkspaceInvitationEmail(opts: {
  to: string;
  workspaceName: string;
  inviterName: string;
  token: string;
}) {
  const url = `${getAppUrl()}/invitations/${opts.token}`;
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `You're invited to ${opts.workspaceName} on ${brand.name}`,
    html: renderEmail({
      preheader: `${opts.inviterName} invited you to collaborate in ${opts.workspaceName}.`,
      heading: `Join ${opts.workspaceName}`,
      paragraphsHtml: [
        `${strong(opts.inviterName)} invited you to join ${strong(opts.workspaceName)} on ${brand.name} — ${p`${brand.tagline.toLowerCase()}`}`,
        p`Open the invitation to sign in, or set a password if you're new. You'll confirm the invitation before joining.`,
      ],
      cta: { label: "Accept invitation", url },
      noteHtml: p`This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.`,
    }),
    text: `Accept invitation: ${url}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export async function sendDocumentActivityEmail(opts: {
  to: string;
  recipientName: string;
  actorName: string;
  documentTitle: string;
  workspaceName: string;
  documentUrl: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `${opts.actorName} made changes to "${opts.documentTitle}"`,
    html: renderEmail({
      preheader: `${opts.actorName} edited ${opts.documentTitle} in ${opts.workspaceName}.`,
      heading: "A page you follow was updated",
      paragraphsHtml: [
        p`Hi ${opts.recipientName},`,
        `${strong(opts.actorName)} made changes to ${strong(opts.documentTitle)} in ${strong(opts.workspaceName)}. The page's History shows every edit.`,
      ],
      cta: { label: "Open the page", url: opts.documentUrl },
      showCtaUrlFallback: false,
      noteHtml: p`You get at most one email per page every few hours. Turn these off in Settings → Notifications.`,
    }),
    text: `${opts.actorName} made changes to "${opts.documentTitle}" in ${opts.workspaceName}: ${opts.documentUrl}`,
  });
}

export async function sendAccessRequestEmail(opts: {
  to: string | string[];
  requesterName: string;
  requesterEmail: string;
  documentTitle: string;
  workspaceName: string;
  settingsUrl: string;
}) {
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `${opts.requesterName} requested access to "${opts.documentTitle}"`,
    html: renderEmail({
      preheader: `${opts.requesterName} is asking for access in ${opts.workspaceName}.`,
      heading: "Access request",
      paragraphsHtml: [
        `${strong(opts.requesterName)} (${p`${opts.requesterEmail}`}) requested access to ${strong(opts.documentTitle)} in ${strong(opts.workspaceName)}.`,
        p`To give them access, invite them to the workspace or share the page with them directly.`,
      ],
      cta: { label: "Open workspace settings", url: opts.settingsUrl },
      showCtaUrlFallback: false,
    }),
    text: `${opts.requesterName} (${opts.requesterEmail}) requested access to "${opts.documentTitle}" in ${opts.workspaceName}. Invite them: ${opts.settingsUrl}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Page sharing                                                                */
/* -------------------------------------------------------------------------- */

const LEVEL_PHRASE: Record<string, string> = {
  full_access: "full access",
  edit: "edit access",
  view: "view access",
};

/** An existing user was given direct access to a page. */
export async function sendDocumentSharedEmail(opts: {
  to: string;
  recipientName: string;
  sharerName: string;
  documentTitle: string;
  level: "full_access" | "edit" | "view";
  documentUrl: string;
}) {
  const provider = getEmailProvider();
  const levelPhrase = LEVEL_PHRASE[opts.level] ?? "access";
  await provider.send({
    to: opts.to,
    subject: `${opts.sharerName} shared "${opts.documentTitle}" with you`,
    html: renderEmail({
      preheader: `${opts.sharerName} gave you ${levelPhrase} to ${opts.documentTitle}.`,
      heading: `${opts.sharerName} shared a page with you`,
      paragraphsHtml: [
        p`Hi ${opts.recipientName},`,
        `${strong(opts.sharerName)} shared ${strong(opts.documentTitle)} with you on ${brand.name} (${p`${levelPhrase}`}).`,
      ],
      cta: { label: "Open the page", url: opts.documentUrl },
    }),
    text: `${opts.sharerName} shared "${opts.documentTitle}" with you (${levelPhrase}): ${opts.documentUrl}`,
  });
}

/** A page was shared with an email that has no account yet. */
export async function sendDocumentInvitationEmail(opts: {
  to: string;
  sharerName: string;
  documentTitle: string;
  token: string;
}) {
  const url = `${getAppUrl()}/invitations/${opts.token}`;
  const provider = getEmailProvider();
  await provider.send({
    to: opts.to,
    subject: `${opts.sharerName} shared "${opts.documentTitle}" with you on ${brand.name}`,
    html: renderEmail({
      preheader: `Open your invitation to view ${opts.documentTitle}.`,
      heading: `${opts.sharerName} shared a page with you`,
      paragraphsHtml: [
        `${strong(opts.sharerName)} shared ${strong(opts.documentTitle)} with you on ${brand.name}.`,
        p`Open the invitation to sign in, or set a password if you're new. You'll confirm the invitation before opening the page.`,
      ],
      cta: { label: "Open the invitation", url },
      noteHtml: p`This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.`,
    }),
    text: `${opts.sharerName} shared "${opts.documentTitle}" with you. Open the invitation: ${url}`,
  });
}

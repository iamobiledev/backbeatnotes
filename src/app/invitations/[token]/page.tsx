import { redirect } from "next/navigation";
import Link from "next/link";
import { requireVerifiedSession } from "@/lib/session";
import {
  actionAcceptInvitation,
  actionAcceptDocumentInvitation,
} from "@/app/actions";
import { getDocumentInvitationByToken } from "@/lib/documents/sharing";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { getDb, workspaceInvitations, workspaces } from "@/db";
import { eq } from "drizzle-orm";

const LEVEL_LABEL: Record<string, string> = {
  full_access: "Full access",
  edit: "Can edit",
  view: "Can view",
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await requireVerifiedSession();

  const db = getDb();
  const [invitation] = await db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      status: workspaceInvitations.status,
      expiresAt: workspaceInvitations.expiresAt,
      workspaceName: workspaces.name,
    })
    .from(workspaceInvitations)
    .innerJoin(
      workspaces,
      eq(workspaces.id, workspaceInvitations.workspaceId),
    )
    .where(eq(workspaceInvitations.token, token))
    .limit(1);

  if (!invitation) {
    // Not a workspace invitation — maybe a shared-page invitation.
    const docInvitation = await getDocumentInvitationByToken(token);
    if (docInvitation) {
      return (
        <DocumentInvitationScreen
          token={token}
          invitation={docInvitation}
          sessionEmail={session.user.email}
        />
      );
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">Invitation not found</h1>
        <Button asChild className="mt-6">
          <Link href="/app">Go to app</Link>
        </Button>
      </main>
    );
  }

  async function accept() {
    "use server";
    const workspaceId = await actionAcceptInvitation(token);
    redirect(`/app/${workspaceId}`);
  }

  const emailMismatch =
    invitation.email.toLowerCase() !== session.user.email.toLowerCase();
  const expired = invitation.expiresAt.getTime() < new Date().getTime();
  const inactive = invitation.status !== "pending";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--primary)]">
        {brand.name}
      </p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        Join {invitation.workspaceName}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Invited as {invitation.email}
      </p>

      {emailMismatch && (
        <p className="mt-4 text-sm text-[var(--destructive)]">
          Sign in as {invitation.email} to accept this invitation.
        </p>
      )}
      {(expired || inactive) && (
        <p className="mt-4 text-sm text-[var(--destructive)]">
          This invitation is no longer valid.
        </p>
      )}

      {!emailMismatch && !expired && !inactive && (
        <form action={accept} className="mt-8">
          <Button type="submit">Accept invitation</Button>
        </form>
      )}
    </main>
  );
}

function DocumentInvitationScreen({
  token,
  invitation,
  sessionEmail,
}: {
  token: string;
  invitation: NonNullable<
    Awaited<ReturnType<typeof getDocumentInvitationByToken>>
  >;
  sessionEmail: string;
}) {
  async function accept() {
    "use server";
    const { documentId, workspaceId } =
      await actionAcceptDocumentInvitation(token);
    redirect(`/app/${workspaceId}/docs/${documentId}`);
  }

  const emailMismatch =
    invitation.email.toLowerCase() !== sessionEmail.toLowerCase();
  const expired = invitation.expiresAt.getTime() < new Date().getTime();
  const inactive = invitation.status !== "pending";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--primary)]">
        {brand.name}
      </p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {invitation.inviterName ?? "A teammate"} shared “
        {invitation.documentTitle || "Untitled"}” with you
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Invited as {invitation.email} ·{" "}
        {LEVEL_LABEL[invitation.level] ?? invitation.level}
      </p>

      {emailMismatch && (
        <p className="mt-4 text-sm text-[var(--destructive)]">
          Sign in as {invitation.email} to open this page.
        </p>
      )}
      {(expired || inactive) && (
        <p className="mt-4 text-sm text-[var(--destructive)]">
          This invitation is no longer valid.
        </p>
      )}

      {!emailMismatch && !expired && !inactive && (
        <form action={accept} className="mt-8">
          <Button type="submit">Open the page</Button>
        </form>
      )}
    </main>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  actionAcceptInvitation,
  actionAcceptDocumentInvitation,
} from "@/app/actions";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import {
  getInvitationAccount,
  getInvitationByToken,
  invitationMatchesEmail,
  isInvitationActive,
  type InvitationDetails,
} from "@/lib/invitations";
import { InvitationAuthForm } from "./invitation-auth-form";
import { getWorkspaceById } from "@/lib/workspaces/service";
import {
  workspaceDocumentPath,
  workspacePath,
} from "@/lib/workspaces/paths";

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
  const [session, invitation] = await Promise.all([
    getSession(),
    getInvitationByToken(token),
  ]);

  if (!invitation) {
    return (
      <InvitationShell>
        <h1 className="text-2xl font-semibold">Invitation not found</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Check the link in your invitation email or ask the sender for a new
          invitation.
        </p>
        <InvitationExit signedIn={Boolean(session?.user)} />
      </InvitationShell>
    );
  }

  if (!isInvitationActive(invitation)) {
    return (
      <InvitationShell>
        <InvitationHeading invitation={invitation} />
        <p className="mt-4 text-sm text-[var(--destructive)]">
          This invitation is no longer valid.
        </p>
        <InvitationExit signedIn={Boolean(session?.user)} />
      </InvitationShell>
    );
  }

  const matchingVerifiedSession = Boolean(
    session?.user.emailVerified &&
      invitationMatchesEmail(invitation, session.user.email),
  );

  if (!matchingVerifiedSession) {
    const account = await getInvitationAccount(invitation.email);
    return (
      <InvitationShell>
        <InvitationHeading invitation={invitation} />
        <InvitationAuthForm
          token={invitation.token}
          email={invitation.email}
          initialMode={account ? "sign-in" : "register"}
          currentSessionEmail={session?.user.email}
          accountVerified={account?.emailVerified}
        />
      </InvitationShell>
    );
  }

  return (
    <InvitationShell>
      <InvitationHeading invitation={invitation} />
      <p className="mt-6 rounded-md bg-[var(--muted)] px-3 py-2 text-sm">
        Signed in as {session!.user.email}
      </p>
      <AcceptanceForm invitation={invitation} />
    </InvitationShell>
  );
}

function InvitationShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <BrandLogo
        markClassName="h-8 w-8"
        wordmarkClassName="text-xl"
      />
      <div className="mt-4">{children}</div>
    </main>
  );
}

function InvitationHeading({
  invitation,
}: {
  invitation: InvitationDetails;
}) {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        {invitation.kind === "workspace"
          ? `Join ${invitation.workspaceName}`
          : `${invitation.inviterName ?? "A teammate"} shared “${
              invitation.documentTitle || "Untitled"
            }” with you`}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Invited as {invitation.email}
        {invitation.kind === "document" &&
          ` · ${LEVEL_LABEL[invitation.level] ?? invitation.level}`}
      </p>
    </>
  );
}

function AcceptanceForm({
  invitation,
}: {
  invitation: InvitationDetails;
}) {
  async function accept() {
    "use server";
    if (invitation.kind === "workspace") {
      const workspaceId = await actionAcceptInvitation(invitation.token);
      const workspace = await getWorkspaceById(workspaceId);
      redirect(workspace ? workspacePath(workspace) : "/app");
    }

    const { documentId, workspaceId } =
      await actionAcceptDocumentInvitation(invitation.token);
    const workspace = await getWorkspaceById(workspaceId);
    redirect(
      workspace
        ? workspaceDocumentPath(workspace, documentId)
        : `/app/${workspaceId}/docs/${documentId}`,
    );
  }

  return (
    <form action={accept} className="mt-6">
      <Button type="submit" className="w-full">
        {invitation.kind === "workspace"
          ? "Accept invitation"
          : "Open the page"}
      </Button>
    </form>
  );
}

function InvitationExit({ signedIn }: { signedIn: boolean }) {
  return (
    <Button asChild className="mt-6">
      <Link href={signedIn ? "/app" : "/sign-in"}>
        {signedIn ? "Go to app" : "Go to sign in"}
      </Link>
    </Button>
  );
}

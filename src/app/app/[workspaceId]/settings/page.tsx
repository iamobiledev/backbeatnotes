import { AlertTriangle, BookLock } from "lucide-react";
import { requireWorkspaceAccess } from "@/lib/workspaces/current";
import {
  listWorkspaceMembers,
  listPendingInvitations,
  getWorkspaceById,
} from "@/lib/workspaces/service";
import { getSlackStatus } from "@/lib/slack/status";
import {
  getConnectionForWorkspace,
  getUserSlackLinks,
} from "@/lib/slack/service";
import { getEmailDeliveryStatus } from "@/lib/email";
import { MembersSection } from "./members-section";
import { WorkspaceNameSection } from "./workspace-name-section";
import { DomainAccessSection } from "./domain-access-section";
import { NotificationsSection } from "./notifications-section";
import { SlackSection } from "./slack-section";

export const metadata = { title: "Settings" };

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { session, workspace } = await requireWorkspaceAccess(workspaceId);

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const emailDelivery = getEmailDeliveryStatus();

  const [members, invitations, slack, workspaceRow] = await Promise.all([
    workspace.isPersonal
      ? Promise.resolve([])
      : listWorkspaceMembers({ userId: session.user.id, workspaceId }),
    !workspace.isPersonal && isAdmin
      ? listPendingInvitations({ userId: session.user.id, workspaceId })
      : Promise.resolve([]),
    getSlackStatus(workspaceId),
    !workspace.isPersonal && isAdmin
      ? getWorkspaceById(workspaceId)
      : Promise.resolve(null),
  ]);

  const emailNotificationsEnabled = session.user.emailNotifications ?? true;

  // Is the current user's Slack identity linked to the connected team?
  let userLinked = false;
  if (slack.connected) {
    const [connection, links] = await Promise.all([
      getConnectionForWorkspace(workspaceId),
      getUserSlackLinks(session.user.id),
    ]);
    userLinked = Boolean(
      connection &&
        links.some((link) => link.slackTeamId === connection.slackTeamId),
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {workspace.name}
        </p>
      </div>

      {isAdmin && emailDelivery.delivery === "console-only" && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Email delivery is not configured
          </h2>
          <p className="mt-1 text-sm leading-6">
            Invitations and page-share notifications are being logged only, not
            sent to inboxes. Add RESEND_API_KEY and EMAIL_FROM in Vercel, then
            redeploy to enable Resend delivery.
          </p>
        </section>
      )}

      {workspace.isPersonal ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <BookLock className="h-4 w-4 text-[var(--primary)]" />
            Personal notebook
          </h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            This is your private space — only you can see its pages. It can’t
            be renamed, shared, or joined by anyone else. Create a shared
            workspace to collaborate with your team.
          </p>
        </section>
      ) : (
        <>
          <WorkspaceNameSection
            workspaceId={workspaceId}
            name={workspace.name}
            canEdit={isAdmin}
          />
          <DomainAccessSection
            workspaceId={workspaceId}
            autoJoinDomain={workspaceRow?.autoJoinDomain ?? null}
            canEdit={isAdmin}
          />
          <MembersSection
            workspaceId={workspaceId}
            currentUserId={session.user.id}
            isAdmin={isAdmin}
            members={members.map((m) => ({
              userId: m.userId,
              name: m.name,
              email: m.email,
              image: m.image,
              role: m.role,
            }))}
            invitations={invitations.map((invitation) => ({
              id: invitation.id,
              email: invitation.email,
              role: invitation.role,
              expiresAt: invitation.expiresAt.toISOString(),
              lastSentAt: invitation.lastSentAt.toISOString(),
            }))}
          />
        </>
      )}

      <NotificationsSection enabled={emailNotificationsEnabled} />

      <SlackSection
        workspaceId={workspaceId}
        isPersonal={workspace.isPersonal}
        isAdmin={isAdmin}
        slack={slack}
        userLinked={userLinked}
      />
    </div>
  );
}

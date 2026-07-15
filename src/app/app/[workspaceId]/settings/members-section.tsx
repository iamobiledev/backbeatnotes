"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import {
  actionInviteMember,
  actionUpdateMemberRole,
  actionRemoveMember,
  actionRevokeInvitation,
  actionResendInvitation,
} from "@/app/actions";
import { formatDistanceToNow } from "date-fns";

type Member = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  lastSentAt: string;
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Admin — manage members and settings",
  member: "Editor — create and edit pages",
  guest: "Viewer — read-only access",
};

export function MembersSection({
  workspaceId,
  currentUserId,
  isAdmin,
  members,
  invitations,
}: {
  workspaceId: string;
  currentUserId: string;
  isAdmin: boolean;
  members: Member[];
  invitations: Invitation[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member" | "guest">("member");
  const [pending, startTransition] = useTransition();

  const invite = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await actionInviteMember({
        workspaceId,
        email: trimmed,
        role,
      });
      if (result.ok) {
        toast.success(`Invitation sent to ${trimmed}`);
        setEmail("");
      } else {
        toast.error(result.error);
      }
    });
  };

  const changeRole = (targetUserId: string, nextRole: string) => {
    startTransition(async () => {
      const result = await actionUpdateMemberRole({
        workspaceId,
        targetUserId,
        role: nextRole as "admin" | "member" | "guest",
      });
      if (result.ok) {
        toast.success("Role updated");
      } else {
        toast.error(result.error);
      }
    });
  };

  const remove = (targetUserId: string, name: string) => {
    startTransition(async () => {
      const result = await actionRemoveMember({ workspaceId, targetUserId });
      if (result.ok) {
        toast.success(`${name} removed from the workspace`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const revoke = (invitationId: string, invitationEmail: string) => {
    startTransition(async () => {
      const result = await actionRevokeInvitation({
        workspaceId,
        invitationId,
      });
      if (result.ok) {
        toast.success(`Invitation to ${invitationEmail} revoked`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const resend = (invitationId: string, invitationEmail: string) => {
    startTransition(async () => {
      const result = await actionResendInvitation({
        workspaceId,
        invitationId,
      });
      if (result.ok) {
        toast.success(`Invitation re-sent to ${invitationEmail}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading" className="text-lg font-medium">
        Members
      </h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Everyone here can see every page in this workspace. Editors can write,
        viewers are read-only.
      </p>

      <ul className="mt-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={member.name} image={member.image} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {member.name}
                {member.userId === currentUserId && (
                  <span className="ml-1.5 text-xs font-normal text-[var(--muted-foreground)]">
                    (you)
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-[var(--muted-foreground)]">
                {member.email}
              </span>
            </span>
            {member.role === "owner" ? (
              <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs font-medium">
                Owner
              </span>
            ) : isAdmin ? (
              <div className="flex items-center gap-1">
                <Select
                  aria-label={`Role for ${member.name}`}
                  className="w-28 [&_select]:h-8 [&_select]:text-xs"
                  value={member.role}
                  onChange={(event) =>
                    changeRole(member.userId, event.target.value)
                  }
                  disabled={pending}
                >
                  <option value="admin">Admin</option>
                  <option value="member">Editor</option>
                  <option value="guest">Viewer</option>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                  aria-label={`Remove ${member.name}`}
                  onClick={() => remove(member.userId, member.name)}
                  disabled={pending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <span className="rounded-full bg-[var(--muted)] px-2.5 py-1 text-xs">
                {member.role === "member"
                  ? "Editor"
                  : member.role === "guest"
                    ? "Viewer"
                    : "Admin"}
              </span>
            )}
          </li>
        ))}
      </ul>

      {invitations.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-[var(--muted-foreground)]">
            Pending invitations
          </h3>
          <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-dashed border-[var(--border)]">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {invitation.email}
                  </span>
                  <span className="block text-xs text-[var(--muted-foreground)]">
                    Invited as{" "}
                    {invitation.role === "member"
                      ? "editor"
                      : invitation.role === "guest"
                        ? "viewer"
                        : invitation.role}{" "}
                    · email sent{" "}
                    {formatDistanceToNow(new Date(invitation.lastSentAt), {
                      addSuffix: true,
                    })}
                  </span>
                </span>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => resend(invitation.id, invitation.email)}
                      disabled={pending}
                    >
                      Resend
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                      onClick={() => revoke(invitation.id, invitation.email)}
                      disabled={pending}
                    >
                      Revoke
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && (
        <form
          className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            invite();
          }}
        >
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <UserPlus className="h-4 w-4 text-[var(--muted-foreground)]" />
            Invite a teammate
          </h3>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Label htmlFor="invite-email" className="sr-only">
                Email
              </Label>
              <Input
                id="invite-email"
                type="email"
                required
                placeholder="teammate@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="w-full sm:w-40">
              <Label htmlFor="invite-role" className="sr-only">
                Role
              </Label>
              <Select
                id="invite-role"
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as "admin" | "member" | "guest")
                }
              >
                <option value="member">Editor</option>
                <option value="guest">Viewer</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <Button type="submit" disabled={pending || !email.trim()}>
              {pending ? "Sending…" : "Send invite"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
            {ROLE_DESCRIPTIONS[role]}
          </p>
        </form>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  actionShareDocument,
  actionUpdateDocumentPermission,
  actionRemoveDocumentPermission,
  actionRevokeDocumentInvitation,
  actionSetGeneralAccess,
} from "@/app/actions";
import type {
  DocumentSharing,
  DocumentPermissionLevel,
  GeneralAccess,
  SharePerson,
  SharePendingInvitation,
} from "@/lib/documents/types";
import { parseEmailList } from "@/lib/utils";
import { ShareToSlackSection } from "./share-to-slack";

const LEVEL_LABEL: Record<DocumentPermissionLevel, string> = {
  full_access: "Full access",
  edit: "Can edit",
  view: "Can view",
};

const LEVEL_DESCRIPTION: Record<DocumentPermissionLevel, string> = {
  full_access: "Edit, and share with others",
  edit: "Make changes to the page",
  view: "Read only",
};

const LEVELS: DocumentPermissionLevel[] = ["full_access", "edit", "view"];

export function ShareTab({
  doc,
  workspace,
  sharing,
  onChanged,
  slack,
}: {
  doc: { id: string; workspaceId: string; title: string };
  workspace: {
    id: string;
    name: string;
    isPersonal: boolean;
    role: "owner" | "admin" | "member" | "guest";
  };
  sharing: DocumentSharing | null;
  onChanged: () => Promise<void>;
  slack: { configured: boolean; connected: boolean; teamName: string | null };
}) {
  const router = useRouter();
  const [inviteInput, setInviteInput] = useState("");
  const [inviteLevel, setInviteLevel] =
    useState<DocumentPermissionLevel>("full_access");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, startInviting] = useTransition();

  const canShare = sharing?.canShare ?? false;
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";

  const invite = () => {
    const { valid, invalid } = parseEmailList(inviteInput);
    if (invalid.length > 0) {
      setInviteError(
        `Not a valid email: ${invalid.join(", ")}. Separate addresses with commas.`,
      );
      return;
    }
    if (valid.length === 0) return;
    setInviteError(null);
    startInviting(async () => {
      const result = await actionShareDocument({
        documentId: doc.id,
        emails: valid,
        level: inviteLevel,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const shared = result.data.filter((r) => r.outcome === "shared").length;
      const invited = result.data.filter((r) => r.outcome === "invited");
      const already = result.data.filter((r) => r.outcome === "already");
      const self = result.data.filter((r) => r.outcome === "self");
      const parts: string[] = [];
      if (shared > 0) parts.push(`shared with ${shared} ${shared === 1 ? "person" : "people"}`);
      if (invited.length > 0) parts.push(`invitation sent to ${invited.map((r) => r.email).join(", ")}`);
      if (parts.length > 0) {
        toast.success(`Page ${parts.join(" and ")}`);
      }
      for (const entry of already) {
        toast.info(`${entry.email} already has access`);
      }
      for (const entry of self) {
        toast.info(`That's you — no need to invite ${entry.email}`);
      }
      setInviteInput("");
      await onChanged();
      router.refresh();
    });
  };

  return (
    <div className="px-3 pb-3 pt-3">
      {/* Invite by email */}
      {canShare && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            invite();
          }}
        >
          <label htmlFor="share-invite-emails" className="sr-only">
            Invite by email
          </label>
          <div className="relative flex h-9 flex-1 items-center">
            <Input
              id="share-invite-emails"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Email or group, separated by commas"
              value={inviteInput}
              onChange={(event) => {
                setInviteInput(event.target.value);
                if (inviteError) setInviteError(null);
              }}
              className={`h-9 flex-1 pr-[4.6rem] text-sm ${
                inviteError ? "border-[var(--destructive)]" : ""
              }`}
            />
            {inviteInput.trim() && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Access level for invitees"
                    className="absolute right-1.5 flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    {LEVEL_LABEL[inviteLevel]}
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {LEVELS.map((level) => (
                    <DropdownMenuItem
                      key={level}
                      onSelect={() => setInviteLevel(level)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span>{LEVEL_LABEL[level]}</span>
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {LEVEL_DESCRIPTION[level]}
                        </span>
                      </span>
                      {inviteLevel === level && (
                        <Check className="h-4 w-4 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <Button
            type="submit"
            size="sm"
            className="h-9"
            disabled={inviting || !inviteInput.trim()}
          >
            {inviting ? "…" : "Invite"}
          </Button>
        </form>
      )}
      {inviteError && (
        <p className="mt-1.5 text-xs text-[var(--destructive)]">{inviteError}</p>
      )}

      {/* People with access */}
      <div className="mt-3 max-h-56 space-y-0.5 overflow-y-auto">
        {sharing === null && (
          <div className="space-y-2 py-1">
            {[...Array(2)].map((_, index) => (
              <div
                key={index}
                className="h-9 animate-pulse rounded bg-[var(--muted)]"
              />
            ))}
          </div>
        )}
        {sharing?.people.map((person) => (
          <PersonRow
            key={person.userId}
            person={person}
            documentId={doc.id}
            canManage={canShare && !person.isCreator}
            onChanged={onChanged}
          />
        ))}
        {sharing?.invitations.map((invitation) => (
          <InvitationRow
            key={invitation.invitationId}
            invitation={invitation}
            documentId={doc.id}
            canManage={canShare}
            onChanged={onChanged}
          />
        ))}
      </div>

      {/* General access */}
      {sharing && (
        <div className="mt-3">
          <p className="mb-1 px-0.5 text-xs font-medium text-[var(--muted-foreground)]">
            General access
          </p>
          <GeneralAccessRow
            documentId={doc.id}
            generalAccess={sharing.generalAccess}
            workspaceName={sharing.workspaceName}
            isPersonal={sharing.isPersonal}
            canManage={canShare}
            onChanged={onChanged}
          />
        </div>
      )}

      {/* Share to Slack */}
      <div className="mt-3">
        <ShareToSlackSection
          doc={{ id: doc.id, workspaceId: doc.workspaceId }}
          workspace={{ id: workspace.id, isPersonal: workspace.isPersonal }}
          slack={slack}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}

/* ------------------------------- Person row ------------------------------ */

function PersonRow({
  person,
  documentId,
  canManage,
  onChanged,
}: {
  person: SharePerson;
  documentId: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setLevel = (level: DocumentPermissionLevel) => {
    if (level === person.level) return;
    startTransition(async () => {
      const result = await actionUpdateDocumentPermission({
        documentId,
        targetUserId: person.userId,
        level,
      });
      if (!result.ok) toast.error(result.error);
      await onChanged();
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await actionRemoveDocumentPermission({
        documentId,
        targetUserId: person.userId,
      });
      if (result.ok) toast.success(`Removed ${person.name}'s access`);
      else toast.error(result.error);
      await onChanged();
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-[var(--muted)]">
      <Avatar name={person.name} image={person.image} className="h-7 w-7 text-xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {person.name}
          {person.isYou && (
            <span className="text-[var(--muted-foreground)]"> (You)</span>
          )}
        </span>
        <span className="block truncate text-xs text-[var(--muted-foreground)]">
          {person.email}
        </span>
      </span>
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              aria-label={`Change ${person.name}'s access`}
              className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
            >
              {LEVEL_LABEL[person.level]}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {LEVELS.map((level) => (
              <DropdownMenuItem key={level} onSelect={() => setLevel(level)}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{LEVEL_LABEL[level]}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {LEVEL_DESCRIPTION[level]}
                  </span>
                </span>
                {person.level === level && <Check className="h-4 w-4 shrink-0" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={remove}>
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="shrink-0 px-1.5 text-xs text-[var(--muted-foreground)]">
          {LEVEL_LABEL[person.level]}
        </span>
      )}
    </div>
  );
}

/* ---------------------------- Pending invitation ------------------------- */

function InvitationRow({
  invitation,
  documentId,
  canManage,
  onChanged,
}: {
  invitation: SharePendingInvitation;
  documentId: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  const revoke = () => {
    startTransition(async () => {
      const result = await actionRevokeDocumentInvitation({
        documentId,
        invitationId: invitation.invitationId,
      });
      if (result.ok) toast.success("Invitation revoked");
      else toast.error(result.error);
      await onChanged();
    });
  };

  return (
    <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-[var(--muted)]">
      <Avatar name={invitation.email} className="h-7 w-7 text-xs opacity-60" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--muted-foreground)]">
          {invitation.email}
        </span>
        <span className="block text-xs text-[var(--muted-foreground)]">
          Pending invitation
        </span>
      </span>
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending}
              aria-label={`Manage invitation for ${invitation.email}`}
              className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
            >
              {LEVEL_LABEL[invitation.level]}
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem destructive onSelect={revoke}>
              Revoke invitation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="shrink-0 px-1.5 text-xs text-[var(--muted-foreground)]">
          {LEVEL_LABEL[invitation.level]}
        </span>
      )}
    </div>
  );
}

/* ------------------------------ General access --------------------------- */

function GeneralAccessRow({
  documentId,
  generalAccess,
  workspaceName,
  isPersonal,
  canManage,
  onChanged,
}: {
  documentId: string;
  generalAccess: GeneralAccess;
  workspaceName: string;
  isPersonal: boolean;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setAccess = (access: GeneralAccess) => {
    if (access === generalAccess) return;
    startTransition(async () => {
      const result = await actionSetGeneralAccess({ documentId, access });
      if (result.ok) {
        toast.success(
          access === "invited"
            ? "Only invited people can open this page now"
            : `Everyone at ${workspaceName} can open this page now`,
        );
      } else {
        toast.error(result.error);
      }
      await onChanged();
      router.refresh();
    });
  };

  const current = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--muted)]">
        {generalAccess === "invited" ? (
          <Lock className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        ) : (
          <Users className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        )}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm">
          {generalAccess === "invited"
            ? "Only people invited"
            : `Everyone at ${workspaceName}`}
        </span>
        <span className="block truncate text-xs text-[var(--muted-foreground)]">
          {generalAccess === "invited"
            ? "Only people with direct access can open this page"
            : "Anyone in the workspace can open this page"}
        </span>
      </span>
    </span>
  );

  // Personal notebooks are always invite-only; viewers can't change access.
  if (isPersonal || !canManage) {
    return (
      <div className="flex items-center rounded-md px-1.5 py-1.5">{current}</div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Change general access"
          className="flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
        >
          {current}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuItem onSelect={() => setAccess("invited")}>
          <Lock className="h-4 w-4 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span>Only people invited</span>
            <span className="text-xs text-[var(--muted-foreground)]">
              Only people with direct access can open this page
            </span>
          </span>
          {generalAccess === "invited" && <Check className="h-4 w-4 shrink-0" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAccess("workspace")}>
          <Users className="h-4 w-4 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span>Everyone at {workspaceName}</span>
            <span className="text-xs text-[var(--muted-foreground)]">
              Anyone in the workspace can open this page
            </span>
          </span>
          {generalAccess === "workspace" && (
            <Check className="h-4 w-4 shrink-0" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

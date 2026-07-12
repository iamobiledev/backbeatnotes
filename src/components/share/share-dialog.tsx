"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookLock, Check, Copy, Globe, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  actionListWorkspaceMembers,
  actionInviteMember,
  actionPublishDocument,
} from "@/app/actions";
import { ShareToSlackSection } from "./share-to-slack";

type Member = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
};

export type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: {
    id: string;
    workspaceId: string;
    title: string;
    visibility: "private" | "workspace" | "public";
    publicSlug: string | null;
  };
  workspace: {
    id: string;
    name: string;
    isPersonal: boolean;
    role: "owner" | "admin" | "member" | "guest";
  };
  canEdit: boolean;
  slack: {
    configured: boolean;
    connected: boolean;
    teamName: string | null;
  };
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Editor",
  guest: "Viewer",
};

export function ShareDialog({
  open,
  onOpenChange,
  doc,
  workspace,
  canEdit,
  slack,
}: ShareDialogProps) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "guest" | "admin">(
    "member",
  );
  const [visibility, setVisibility] = useState(doc.visibility);
  const [publicSlug, setPublicSlug] = useState(doc.publicSlug);
  const [inviting, startInviting] = useTransition();
  const [publishing, startPublishing] = useTransition();
  const [copiedInternal, setCopiedInternal] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);

  const isAdmin = workspace.role === "owner" || workspace.role === "admin";

  useEffect(() => {
    if (!open || workspace.isPersonal || members) return;
    void actionListWorkspaceMembers({ workspaceId: workspace.id }).then(
      (result) => {
        if (result.ok) setMembers(result.data as Member[]);
        else setMembers([]);
      },
    );
  }, [open, workspace.id, workspace.isPersonal, members]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const internalUrl = `${origin}/app/${doc.workspaceId}/docs/${doc.id}`;
  const publicUrl = publicSlug ? `${origin}/p/${publicSlug}` : null;

  const copy = async (value: string, which: "internal" | "public") => {
    await navigator.clipboard.writeText(value);
    if (which === "internal") {
      setCopiedInternal(true);
      setTimeout(() => setCopiedInternal(false), 1500);
    } else {
      setCopiedPublic(true);
      setTimeout(() => setCopiedPublic(false), 1500);
    }
    toast.success("Link copied");
  };

  const invite = () => {
    const email = inviteEmail.trim();
    if (!email) return;
    startInviting(async () => {
      const result = await actionInviteMember({
        workspaceId: workspace.id,
        email,
        role: inviteRole,
      });
      if (result.ok) {
        toast.success(`Invitation sent to ${email}`);
        setInviteEmail("");
      } else {
        toast.error(result.error);
      }
    });
  };

  const togglePublish = () => {
    const publish = visibility !== "public";
    startPublishing(async () => {
      const result = await actionPublishDocument({
        documentId: doc.id,
        publish,
      });
      if (result.ok) {
        setVisibility(publish ? "public" : "workspace");
        setPublicSlug(result.data.publicSlug);
        toast.success(
          publish
            ? "Published — anyone with the link can view"
            : "Unpublished — back to workspace-only",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{doc.title || "Untitled"}”</DialogTitle>
          <DialogDescription>
            {workspace.isPersonal
              ? "This page lives in your personal notebook."
              : `Everyone in ${workspace.name} can open this page.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Who has access */}
          <section aria-label="Who has access">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
              {workspace.isPersonal ? (
                <BookLock className="h-3.5 w-3.5" />
              ) : (
                <Users className="h-3.5 w-3.5" />
              )}
              Who has access
            </h3>
            {workspace.isPersonal ? (
              <p className="rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 text-sm">
                Only you. Personal notebook pages can’t be shared with
                teammates — move the page to a shared workspace to collaborate.
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                {members === null && (
                  <div className="space-y-2 p-1">
                    {[...Array(2)].map((_, index) => (
                      <div
                        key={index}
                        className="h-8 animate-pulse rounded bg-[var(--muted)]"
                      />
                    ))}
                  </div>
                )}
                {members?.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center gap-2.5 rounded px-1.5 py-1"
                  >
                    <Avatar name={member.name} image={member.image} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {member.name}
                      </span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">
                        {member.email}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                      {ROLE_LABEL[member.role] ?? member.role}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!workspace.isPersonal && isAdmin && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  invite();
                }}
              >
                <label htmlFor="share-invite-email" className="sr-only">
                  Invite by email
                </label>
                <Input
                  id="share-invite-email"
                  type="email"
                  placeholder="teammate@company.com"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  className="h-9 flex-1"
                />
                <Select
                  aria-label="Invite role"
                  className="w-28 [&_select]:h-9"
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(
                      event.target.value as "member" | "guest" | "admin",
                    )
                  }
                >
                  <option value="member">Editor</option>
                  <option value="guest">Viewer</option>
                  <option value="admin">Admin</option>
                </Select>
                <Button
                  type="submit"
                  size="sm"
                  className="h-9"
                  disabled={inviting || !inviteEmail.trim()}
                >
                  {inviting ? "…" : "Invite"}
                </Button>
              </form>
            )}
          </section>

          {/* Copy link */}
          <section aria-label="Page link">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={internalUrl}
                aria-label="Page link"
                className="h-9 flex-1 text-xs"
                onFocus={(event) => event.target.select()}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => void copy(internalUrl, "internal")}
              >
                {copiedInternal ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copy
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              People without access will see a request-access screen.
            </p>
          </section>

          {/* Publish to web */}
          {canEdit && (
            <section
              aria-label="Publish to web"
              className="rounded-md border border-[var(--border)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-1.5 text-sm font-medium">
                    <Globe className="h-4 w-4 text-[var(--muted-foreground)]" />
                    Publish to web
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {visibility === "public"
                      ? "Anyone with the public link can view this page."
                      : "Create a read-only public page anyone can view."}
                  </p>
                </div>
                <Button
                  variant={visibility === "public" ? "secondary" : "outline"}
                  size="sm"
                  onClick={togglePublish}
                  disabled={publishing}
                >
                  {publishing
                    ? "…"
                    : visibility === "public"
                      ? "Unpublish"
                      : "Publish"}
                </Button>
              </div>
              {visibility === "public" && publicUrl && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    readOnly
                    value={publicUrl}
                    aria-label="Public link"
                    className="h-9 flex-1 text-xs"
                    onFocus={(event) => event.target.select()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => void copy(publicUrl, "public")}
                  >
                    {copiedPublic ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Copy
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Share to Slack */}
          <ShareToSlackSection
            doc={{ id: doc.id, workspaceId: doc.workspaceId }}
            workspace={workspace}
            slack={slack}
            isAdmin={isAdmin}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

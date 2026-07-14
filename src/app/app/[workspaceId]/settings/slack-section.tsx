"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, MessageSquare, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  actionDisconnectSlack,
  actionUnlinkSlackIdentity,
} from "@/app/slack-actions";

export type SlackSectionProps = {
  workspaceId: string;
  isPersonal: boolean;
  isAdmin: boolean;
  slack: {
    configured: boolean;
    connected: boolean;
    teamName: string | null;
  };
  userLinked: boolean;
};

export function SlackSection({
  workspaceId,
  isPersonal,
  isAdmin,
  slack,
  userLinked,
}: SlackSectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const toastShown = useRef(false);

  // Feedback after returning from the Slack OAuth flows.
  useEffect(() => {
    if (toastShown.current) return;
    const slackStatus = searchParams.get("slack");
    const linkStatus = searchParams.get("slackLink");
    if (!slackStatus && !linkStatus) return;
    toastShown.current = true;

    if (slackStatus === "connected") toast.success("Slack connected 🎉");
    else if (slackStatus === "error")
      toast.error("Connecting Slack failed. Please try again.");
    else if (slackStatus === "cancelled") toast.info("Slack connection cancelled.");
    if (linkStatus === "linked") toast.success("Slack account linked");
    else if (linkStatus === "error")
      toast.error("Linking your Slack account failed. Please try again.");

    router.replace(`/app/${workspaceId}/settings#slack`, { scroll: false });
  }, [searchParams, router, workspaceId]);

  if (isPersonal) return null;

  const disconnect = () => {
    startTransition(async () => {
      const result = await actionDisconnectSlack({ workspaceId });
      if (result.ok) {
        toast.success("Slack disconnected");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const unlink = () => {
    startTransition(async () => {
      const result = await actionUnlinkSlackIdentity({ workspaceId });
      if (result.ok) {
        toast.success("Slack account unlinked");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <section aria-labelledby="slack-heading" id="slack">
      <h2
        id="slack-heading"
        className="flex items-center gap-2 text-lg font-medium"
      >
        <MessageSquare className="h-4 w-4 text-[var(--muted-foreground)]" />
        Slack
      </h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Preview document links in Slack, search with <code>/docs</code> or by
        mentioning the bot, find related paragraphs from a description, and
        share pages into channels.
      </p>

      <div className="mt-3 space-y-3">
        {/* Workspace connection */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          {!slack.configured ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Slack isn’t configured for this deployment yet. Add the Slack app
              credentials to the environment (see the README) to enable the
              integration.
            </p>
          ) : slack.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Check className="h-4 w-4 text-[var(--primary)]" />
                  Connected to {slack.teamName ?? "Slack"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  Document links unfurl in Slack and pages can be shared into
                  channels. Bot mentions reply in-thread with matched document
                  cards.
                </p>
              </div>
              {isAdmin && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disconnect}
                  disabled={pending}
                >
                  Disconnect
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Not connected</p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {isAdmin
                    ? "Connect your Slack workspace to enable link previews, /docs search, and sharing."
                    : "Ask a workspace admin to connect Slack."}
                </p>
              </div>
              {isAdmin && (
                <Button size="sm" asChild>
                  {/* Full page navigation into the OAuth flow */}
                  <a href={`/api/slack/install?workspaceId=${workspaceId}`}>
                    Connect Slack
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Personal identity link */}
        {slack.configured && slack.connected && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <User className="h-4 w-4 text-[var(--muted-foreground)]" />
                  Your Slack account
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {userLinked
                    ? "Linked — /docs search and mentions respect your document permissions."
                    : "Link your Slack identity so /docs search and @mentions can find your documents."}
                </p>
              </div>
              {userLinked ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={unlink}
                  disabled={pending}
                >
                  Unlink
                </Button>
              ) : (
                <Button size="sm" variant="secondary" asChild>
                  <a href={`/api/slack/link?workspaceId=${workspaceId}`}>
                    Link my account
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

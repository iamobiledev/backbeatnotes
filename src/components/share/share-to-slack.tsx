"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  actionListSlackChannels,
  actionShareDocToSlack,
} from "@/app/slack-actions";

/**
 * "Share to Slack" section of the share dialog.
 * Shows honest states when Slack isn't configured/connected, and a channel
 * picker + optional message when it is.
 */
export function ShareToSlackSection({
  doc,
  workspace,
  slack,
  isAdmin,
}: {
  doc: { id: string; workspaceId: string };
  workspace: { id: string; slug: string; isPersonal: boolean };
  slack: { configured: boolean; connected: boolean; teamName: string | null };
  isAdmin: boolean;
}) {
  const [channels, setChannels] = useState<
    Array<{ id: string; name: string }> | null
  >(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState("");
  const [message, setMessage] = useState("");
  const [sharing, startSharing] = useTransition();

  const shouldLoad =
    !workspace.isPersonal && slack.configured && slack.connected;

  useEffect(() => {
    if (!shouldLoad || channels) return;
    let cancelled = false;
    void actionListSlackChannels({ workspaceId: workspace.id }).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) {
          setChannels(result.data);
          if (result.data.length > 0) setChannelId(result.data[0].id);
        } else {
          setChannels([]);
          setChannelError(result.error);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [shouldLoad, channels, workspace.id]);

  if (workspace.isPersonal) return null;

  if (!slack.configured) {
    return (
      <section
        aria-label="Share to Slack"
        className="rounded-md border border-dashed border-[var(--border)] p-3"
      >
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)]">
          <MessageSquare className="h-4 w-4" />
          Share to Slack
        </h3>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          Slack isn’t configured for this deployment. See the README to set up
          the Slack app.
        </p>
      </section>
    );
  }

  if (!slack.connected) {
    return (
      <section
        aria-label="Share to Slack"
        className="rounded-md border border-[var(--border)] p-3"
      >
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquare className="h-4 w-4 text-[var(--muted-foreground)]" />
          Share to Slack
        </h3>
        <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
          {isAdmin ? (
            <>
              Connect your Slack workspace to share pages directly into
              channels.{" "}
              <Link
                href={`/app/${workspace.slug}/settings#slack`}
                className="font-medium text-[var(--primary)] hover:underline"
              >
                Connect Slack →
              </Link>
            </>
          ) : (
            "Ask a workspace admin to connect Slack in settings to share pages into channels."
          )}
        </p>
      </section>
    );
  }

  const share = () => {
    if (!channelId) return;
    startSharing(async () => {
      const result = await actionShareDocToSlack({
        documentId: doc.id,
        channelId,
        message: message.trim() || undefined,
      });
      if (result.ok) {
        const channelName = channels?.find((c) => c.id === channelId)?.name;
        toast.success(
          channelName ? `Shared to #${channelName}` : "Shared to Slack",
        );
        setMessage("");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <section
      aria-label="Share to Slack"
      className="rounded-md border border-[var(--border)] p-3"
    >
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <MessageSquare className="h-4 w-4 text-[var(--muted-foreground)]" />
        Share to Slack
        {slack.teamName && (
          <span className="font-normal text-xs text-[var(--muted-foreground)]">
            · {slack.teamName}
          </span>
        )}
      </h3>

      {channels === null && !channelError && (
        <div className="mt-2 h-9 animate-pulse rounded-md bg-[var(--muted)]" />
      )}
      {channelError && (
        <p className="mt-2 text-xs text-[var(--destructive)]">{channelError}</p>
      )}
      {channels !== null && channels.length === 0 && !channelError && (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          No public channels found in the connected Slack workspace.
        </p>
      )}

      {channels !== null && channels.length > 0 && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            share();
          }}
        >
          <label htmlFor="slack-channel" className="sr-only">
            Slack channel
          </label>
          <Select
            id="slack-channel"
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            className="[&_select]:h-9"
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <label htmlFor="slack-message" className="sr-only">
              Optional message
            </label>
            <Input
              id="slack-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add a message (optional)"
              maxLength={500}
              className="h-9 flex-1 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              className="h-9 gap-1.5"
              disabled={sharing || !channelId}
            >
              <Send className="h-3.5 w-3.5" />
              {sharing ? "Sharing…" : "Share"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

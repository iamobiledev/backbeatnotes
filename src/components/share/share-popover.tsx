"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Info, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { actionGetDocumentSharing } from "@/app/actions";
import type { DocumentSharing } from "@/lib/documents/types";
import { ShareTab } from "./share-tab";
import { PublishTab } from "./publish-tab";

export type SharePopoverProps = {
  doc: {
    id: string;
    workspaceId: string;
    title: string;
    published: boolean;
    publicSlug: string | null;
  };
  workspace: {
    id: string;
    slug: string;
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
  emailDelivery: "resend" | "console-only";
};

/**
 * Notion-style Share popover anchored to the Share button:
 * Share | Publish tabs, invite-by-email with per-person access levels,
 * General access, and a Copy link footer.
 */
export function SharePopover({
  doc,
  workspace,
  canEdit,
  slack,
  emailDelivery,
}: SharePopoverProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"share" | "publish">("share");
  const [sharing, setSharing] = useState<DocumentSharing | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const result = await actionGetDocumentSharing({ documentId: doc.id });
    if (result.ok) setSharing(result.data);
    else toast.error(result.error);
  }, [doc.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void actionGetDocumentSharing({ documentId: doc.id }).then((result) => {
      if (cancelled) return;
      if (result.ok) setSharing(result.data);
      else toast.error(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, doc.id]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const internalUrl = `${origin}/app/${workspace.slug}/docs/${doc.id}`;

  const copyLink = async () => {
    await navigator.clipboard.writeText(internalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("Link copied");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setTab("share");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-sm font-normal"
          aria-label={`Share “${doc.title || "Untitled"}”`}
        >
          <Share2 className="h-3.5 w-3.5" />
          Share
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[365px] max-w-[calc(100vw-1.5rem)] p-0"
      >
        {/* Tabs header */}
        <div
          role="tablist"
          aria-label="Share options"
          className="flex items-center gap-4 px-4 pt-3"
        >
          <TabButton active={tab === "share"} onClick={() => setTab("share")}>
            Share
          </TabButton>
          {canEdit && (
            <TabButton
              active={tab === "publish"}
              onClick={() => setTab("publish")}
            >
              Publish
            </TabButton>
          )}
        </div>

        {tab === "share" ? (
          <>
            <ShareTab
              doc={doc}
              workspace={workspace}
              sharing={sharing}
              onChanged={refresh}
              slack={slack}
              emailDelivery={emailDelivery}
            />

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <Info className="h-3.5 w-3.5" />
                    Learn about sharing
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64">
                  Full access can edit and share, Can edit can change content,
                  Can view is read-only. “Only people invited” hides the page
                  from everyone else in the workspace.
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void copyLink()}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Copy link
              </Button>
            </div>
          </>
        ) : (
          <PublishTab doc={doc} />
        )}
      </PopoverContent>
    </Popover>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative pb-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
        active
          ? "text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--foreground)]"
          : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

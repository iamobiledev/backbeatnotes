"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronRight,
  History,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  actionToggleFavorite,
  actionTrashDocument,
  actionSetDocumentLock,
} from "@/app/actions";
import { SharePopover } from "@/components/share/share-popover";

const HistoryPanel = dynamic(() =>
  import("./history-panel").then((module) => module.HistoryPanel),
);

export type DocHeaderProps = {
  doc: {
    id: string;
    workspaceId: string;
    title: string;
    published: boolean;
    publicSlug: string | null;
    docType: "doc" | "wiki";
    locked: boolean;
  };
  /** Whether the current user is a member of the page's workspace. */
  isWorkspaceMember: boolean;
  /** Current user may lock/unlock this wiki. */
  canManageLock: boolean;
  workspace: {
    id: string;
    name: string;
    isPersonal: boolean;
    role: "owner" | "admin" | "member" | "guest";
  };
  ancestors: Array<{ id: string; title: string }>;
  favorited: boolean;
  canEdit: boolean;
  slack: {
    configured: boolean;
    connected: boolean;
    teamName: string | null;
  };
  emailDelivery: "resend" | "console-only";
};

export function DocHeader({
  doc,
  isWorkspaceMember,
  canManageLock,
  workspace,
  ancestors,
  favorited,
  canEdit,
  slack,
  emailDelivery,
}: DocHeaderProps) {
  const router = useRouter();
  const [isFavorited, setIsFavorited] = useState(favorited);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [, startTransition] = useTransition();

  const toggleLock = () => {
    startTransition(async () => {
      const result = await actionSetDocumentLock({
        documentId: doc.id,
        locked: !doc.locked,
      });
      if (result.ok) {
        toast.success(
          result.data.locked
            ? "Wiki locked — only admins can edit"
            : "Wiki unlocked — editors can edit again",
        );
      } else {
        toast.error(result.error);
      }
    });
  };

  const docUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/app/${doc.workspaceId}/docs/${doc.id}`;

  const toggleFavorite = () => {
    const next = !isFavorited;
    setIsFavorited(next);
    startTransition(async () => {
      const result = await actionToggleFavorite({ documentId: doc.id });
      if (!result.ok) {
        setIsFavorited(!next);
        toast.error(result.error);
      } else {
        router.refresh();
      }
    });
  };

  const moveToTrash = () => {
    startTransition(async () => {
      const result = await actionTrashDocument({ documentId: doc.id });
      if (result.ok) {
        toast.success("Moved to trash", {
          action: {
            label: "View trash",
            onClick: () => router.push(`/app/${doc.workspaceId}/trash`),
          },
        });
        router.push(`/app/${doc.workspaceId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(docUrl);
    toast.success("Link copied to clipboard");
  };

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex items-center gap-1 text-sm text-[var(--muted-foreground)]">
          <li className="shrink-0">
            {isWorkspaceMember ? (
              <Link
                href={`/app/${workspace.id}`}
                className="hover:text-[var(--foreground)]"
              >
                {workspace.name}
              </Link>
            ) : (
              <span>{workspace.name}</span>
            )}
          </li>
          {ancestors.map((ancestor) => (
            <li key={ancestor.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              {isWorkspaceMember ? (
                <Link
                  href={`/app/${workspace.id}/docs/${ancestor.id}`}
                  className="truncate hover:text-[var(--foreground)]"
                >
                  {ancestor.title || "Untitled"}
                </Link>
              ) : (
                <span className="truncate">{ancestor.title || "Untitled"}</span>
              )}
            </li>
          ))}
          <li className="flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <span
              aria-current="page"
              className="flex min-w-0 items-center gap-1.5 truncate font-medium text-[var(--foreground)]"
            >
              {doc.docType === "wiki" && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--hero-wash)] px-2 py-0.5 text-[11px] font-semibold text-[var(--primary)]">
                  <BookOpen className="h-3 w-3" />
                  Wiki
                  {doc.locked && <Lock className="h-3 w-3" />}
                </span>
              )}
              <span className="truncate">{doc.title || "Untitled"}</span>
            </span>
          </li>
        </ol>
      </nav>

      <div className="flex items-center gap-1.5">
        <SharePopover
          doc={{
            id: doc.id,
            workspaceId: doc.workspaceId,
            title: doc.title,
            published: doc.published,
            publicSlug: doc.publicSlug,
          }}
          workspace={workspace}
          canEdit={canEdit}
          slack={slack}
          emailDelivery={emailDelivery}
        />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFavorited}
          onClick={toggleFavorite}
        >
          <Star
            className={`h-4 w-4 ${
              isFavorited
                ? "fill-amber-400 text-amber-400"
                : "text-[var(--muted-foreground)]"
            }`}
          />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
              <History className="h-4 w-4" />
              Version history
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyLink()}>
              <Link2 className="h-4 w-4" />
              Copy link
            </DropdownMenuItem>
            {doc.docType === "wiki" && canManageLock && (
              <DropdownMenuItem onSelect={toggleLock}>
                {doc.locked ? (
                  <>
                    <LockOpen className="h-4 w-4" />
                    Unlock wiki
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Lock wiki
                  </>
                )}
              </DropdownMenuItem>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={moveToTrash}>
                  <Trash2 className="h-4 w-4" />
                  Move to trash
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {historyOpen && (
        <HistoryPanel
          open
          onOpenChange={setHistoryOpen}
          documentId={doc.id}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  actionListDocumentVersions,
  actionGetDocumentVersion,
  actionRestoreDocumentVersion,
  actionListDocumentActivity,
} from "@/app/actions";
import { ReadOnlyDoc } from "./read-only-doc";

type VersionSummary = {
  id: string;
  version: number;
  title: string;
  createdAt: string;
  createdByName: string | null;
};

type VersionDetail = {
  id: string;
  version: number;
  title: string;
  contentJson: Record<string, unknown>;
  createdAt: string;
};

type ActivityEntry = {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  at: string;
  userName: string | null;
  userImage: string | null;
};

function activitySentence(entry: ActivityEntry): string {
  const meta = entry.metadata as {
    from?: string;
    to?: string;
    charDelta?: number;
    version?: number;
    docType?: string;
    emails?: string[];
    access?: string;
  };
  switch (entry.action) {
    case "created":
      return meta.docType === "wiki" ? "created this wiki" : "created this page";
    case "edited": {
      const delta = Number(meta.charDelta ?? 0);
      const detail =
        delta > 0
          ? ` (+${delta} characters)`
          : delta < 0
            ? ` (${delta} characters)`
            : "";
      return `made changes${detail}`;
    }
    case "renamed":
      return meta.from && meta.to
        ? `renamed “${meta.from}” to “${meta.to}”`
        : "renamed this page";
    case "moved":
      return "moved this page";
    case "trashed":
      return "moved this page to the trash";
    case "restored":
      return "restored this page from the trash";
    case "published":
      return "published this page to the web";
    case "unpublished":
      return "unpublished this page";
    case "version_restored":
      return meta.version
        ? `restored version ${meta.version}`
        : "restored a previous version";
    case "locked":
      return "locked this wiki";
    case "unlocked":
      return "unlocked this wiki";
    case "shared":
      return Array.isArray(meta.emails) && meta.emails.length > 0
        ? `shared this page with ${meta.emails.join(", ")}`
        : "shared this page";
    case "unshared":
      return "removed someone's access to this page";
    case "general_access_changed":
      return meta.access === "invited"
        ? "restricted this page to invited people"
        : "opened this page to everyone in the workspace";
    default:
      return entry.action;
  }
}

export function HistoryPanel({
  open,
  onOpenChange,
  documentId,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"activity" | "versions">("activity");
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [selected, setSelected] = useState<VersionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [restoring, startRestoring] = useTransition();

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setActivity(null);
        setVersions(null);
        setSelected(null);
        setTab("activity");
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void actionListDocumentActivity({ documentId }).then((result) => {
      if (cancelled) return;
      if (result.ok) setActivity(result.data);
      else setActivity([]);
    });
    void actionListDocumentVersions({ documentId }).then((result) => {
      if (cancelled) return;
      if (result.ok) setVersions(result.data);
      else {
        toast.error(result.error);
        setVersions([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  const selectVersion = useCallback(
    async (versionId: string) => {
      setLoadingDetail(true);
      const result = await actionGetDocumentVersion({ documentId, versionId });
      setLoadingDetail(false);
      if (result.ok && result.data) setSelected(result.data);
      else toast.error(result.ok ? "Version not found." : result.error);
    },
    [documentId],
  );

  const restore = () => {
    if (!selected) return;
    startRestoring(async () => {
      const result = await actionRestoreDocumentVersion({
        documentId,
        versionId: selected.id,
      });
      if (result.ok) {
        toast.success(`Restored version ${selected.version}`);
        handleOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            History
          </DialogTitle>
          <DialogDescription>
            Every change is logged. Snapshots are taken automatically on
            significant edits; restoring keeps a snapshot of the current
            version, so nothing is ever lost.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="History sections"
          className="flex gap-1 border-b border-[var(--border)]"
        >
          {(["activity", "versions"] as const).map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className={`rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === name
                  ? "border border-b-0 border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {name === "activity" ? "Activity" : "Versions"}
            </button>
          ))}
        </div>

        {tab === "activity" ? (
          <div className="max-h-[55vh] overflow-y-auto">
            {activity === null && (
              <div className="space-y-2 py-2">
                {[...Array(4)].map((_, index) => (
                  <div
                    key={index}
                    className="h-10 animate-pulse rounded bg-[var(--muted)]"
                  />
                ))}
              </div>
            )}
            {activity?.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                No activity recorded yet.
              </p>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {activity?.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-2.5">
                  <Avatar
                    name={entry.userName ?? "?"}
                    image={entry.userImage}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      <span className="font-medium">
                        {entry.userName ?? "Someone"}
                      </span>{" "}
                      {activitySentence(entry)}
                    </span>
                    <span
                      className="block text-xs text-[var(--muted-foreground)]"
                      title={format(new Date(entry.at), "PPpp")}
                    >
                      {formatDistanceToNow(new Date(entry.at), {
                        addSuffix: true,
                      })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid max-h-[55vh] grid-cols-1 gap-4 overflow-hidden sm:grid-cols-[220px_1fr]">
            <div className="overflow-y-auto rounded-md border border-[var(--border)]">
              {versions === null && (
                <div className="space-y-2 p-3">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="h-10 animate-pulse rounded bg-[var(--muted)]"
                    />
                  ))}
                </div>
              )}
              {versions?.length === 0 && (
                <p className="p-4 text-sm text-[var(--muted-foreground)]">
                  No snapshots yet. Keep editing — versions appear here after
                  significant changes.
                </p>
              )}
              <ul>
                {versions?.map((version) => (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={() => void selectVersion(version.id)}
                      className={`w-full px-3 py-2 text-left transition-colors hover:bg-[var(--muted)] ${
                        selected?.id === version.id ? "bg-[var(--muted)]" : ""
                      }`}
                    >
                      <span className="block text-sm font-medium">
                        v{version.version} · {version.title || "Untitled"}
                      </span>
                      <span className="block text-xs text-[var(--muted-foreground)]">
                        {format(
                          new Date(version.createdAt),
                          "MMM d, yyyy h:mm a",
                        )}
                        {version.createdByName &&
                          ` · ${version.createdByName}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="overflow-y-auto rounded-md border border-[var(--border)] p-4">
              {loadingDetail && (
                <div className="flex h-full items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
                </div>
              )}
              {!loadingDetail && !selected && (
                <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">
                  Select a version to preview it.
                </p>
              )}
              {!loadingDetail && selected && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                      {selected.title || "Untitled"}
                    </h3>
                    {canEdit && (
                      <Button size="sm" onClick={restore} disabled={restoring}>
                        {restoring ? "Restoring…" : "Restore this version"}
                      </Button>
                    )}
                  </div>
                  <ReadOnlyDoc contentJson={selected.contentJson} />
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

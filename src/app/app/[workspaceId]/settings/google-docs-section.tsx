"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  FileDown,
  Loader2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  actionDisconnectGoogle,
  actionImportGoogleDoc,
  actionListGoogleDocs,
} from "@/app/google-actions";

export type GoogleDocsSectionProps = {
  workspaceId: string;
  canImport: boolean;
  google: {
    configured: boolean;
    connected: boolean;
    email: string | null;
  };
};

type GoogleFile = {
  id: string;
  name: string;
  modifiedTime: string | null;
  webViewLink: string | null;
};

type ImportRowStatus =
  | { state: "pending" }
  | { state: "importing" }
  | { state: "done"; skipped: boolean; imagesSkipped: number }
  | { state: "error"; error: string };

export function GoogleDocsSection({
  workspaceId,
  canImport,
  google,
}: GoogleDocsSectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const toastShown = useRef(false);

  const [files, setFiles] = useState<GoogleFile[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<
    Record<string, ImportRowStatus>
  >({});

  useEffect(() => {
    if (toastShown.current) return;
    const status = searchParams.get("google");
    if (!status) return;
    toastShown.current = true;
    if (status === "connected") toast.success("Google account connected");
    else if (status === "error")
      toast.error("Connecting Google failed. Please try again.");
    else if (status === "cancelled")
      toast.info("Google connection cancelled.");
    router.replace(`/app/${workspaceId}/settings#google-docs`, {
      scroll: false,
    });
  }, [searchParams, router, workspaceId]);

  const loadFiles = useCallback(
    async (opts?: { pageToken?: string | null; append?: boolean; q?: string }) => {
      setListLoading(true);
      setListError(null);
      const result = await actionListGoogleDocs({
        workspaceId,
        pageToken: opts?.pageToken,
        query: opts?.q ?? query,
      });
      setListLoading(false);
      if (!result.ok) {
        setListError(result.error);
        return;
      }
      setFiles((prev) =>
        opts?.append ? [...prev, ...result.data.files] : result.data.files,
      );
      setNextPageToken(result.data.nextPageToken);
    },
    [workspaceId, query],
  );

  useEffect(() => {
    if (!google.configured || !google.connected || !canImport) return;
    let cancelled = false;
    // Defer so we don't setState synchronously inside the effect body.
    const timer = window.setTimeout(() => {
      if (!cancelled) void loadFiles({ q: "" });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Initial load only when connection becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google.configured, google.connected, canImport, workspaceId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = useMemo(
    () => files.length > 0 && files.every((f) => selected.has(f.id)),
    [files, selected],
  );

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const f of files) next.delete(f.id);
      } else {
        for (const f of files) next.add(f.id);
      }
      return next;
    });
  };

  const disconnect = () => {
    startTransition(async () => {
      const result = await actionDisconnectGoogle({ workspaceId });
      if (result.ok) {
        toast.success("Google account disconnected");
        setFiles([]);
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const runImport = async () => {
    const ids = [...selected];
    if (ids.length === 0 || importing) return;
    setImporting(true);
    const initial: Record<string, ImportRowStatus> = {};
    for (const id of ids) initial[id] = { state: "pending" };
    setImportStatus(initial);

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const id of ids) {
      setImportStatus((prev) => ({ ...prev, [id]: { state: "importing" } }));
      const result = await actionImportGoogleDoc({
        workspaceId,
        googleFileId: id,
      });
      if (!result.ok) {
        failed += 1;
        setImportStatus((prev) => ({
          ...prev,
          [id]: { state: "error", error: result.error },
        }));
        continue;
      }
      if (result.data.skipped) {
        skipped += 1;
        setImportStatus((prev) => ({
          ...prev,
          [id]: { state: "done", skipped: true, imagesSkipped: 0 },
        }));
      } else {
        imported += 1;
        setImportStatus((prev) => ({
          ...prev,
          [id]: {
            state: "done",
            skipped: false,
            imagesSkipped: result.data.imagesSkipped,
          },
        }));
      }
    }

    setImporting(false);
    setSelected(new Set());
    router.refresh();

    if (imported > 0) {
      toast.success(
        `Imported ${imported} ${imported === 1 ? "doc" : "docs"}`,
      );
    }
    if (skipped > 0) {
      toast.info(
        `${skipped} already imported ${skipped === 1 ? "doc was" : "docs were"} skipped`,
      );
    }
    if (failed > 0) {
      toast.error(
        `${failed} ${failed === 1 ? "import" : "imports"} failed`,
      );
    }
  };

  return (
    <section aria-labelledby="google-docs-heading" id="google-docs">
      <h2
        id="google-docs-heading"
        className="flex items-center gap-2 text-lg font-medium"
      >
        <FileDown className="h-4 w-4 text-[var(--muted-foreground)]" />
        Google Docs
      </h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Import Google Docs into this workspace as top-level pages. Folder
        structure and cross-doc links can be cleaned up afterward.
      </p>

      <div className="mt-3 space-y-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          {!google.configured ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Google Docs import isn’t configured for this deployment yet. Add
              GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (and a token encryption
              key) to the environment — see the README.
            </p>
          ) : google.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Check className="h-4 w-4 text-[var(--primary)]" />
                  Connected as {google.email ?? "Google account"}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  Docs you can open in Drive can be imported here. Imports are
                  one-way snapshots.
                </p>
              </div>
              {canImport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={disconnect}
                  disabled={pending || importing}
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
                  {canImport
                    ? "Connect Google to browse and import Docs you have access to."
                    : "Ask a workspace member to import docs, or get edit access."}
                </p>
              </div>
              {canImport && (
                <Button size="sm" asChild>
                  <a
                    href={`/api/google/oauth/start?workspaceId=${workspaceId}`}
                  >
                    Connect Google
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>

        {google.configured && google.connected && canImport && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void loadFiles({ q: query });
              }}
            >
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search Docs by name"
                  className="pl-8"
                  disabled={listLoading || importing}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={listLoading || importing}
              >
                {listLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Search"
                )}
              </Button>
            </form>

            {listError && (
              <p className="mt-3 text-sm text-[var(--destructive)]">
                {listError}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={files.length === 0 || importing}
                />
                Select visible
              </label>
              <Button
                size="sm"
                onClick={() => void runImport()}
                disabled={selected.size === 0 || importing}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  `Import ${selected.size || ""}`.trim()
                )}
              </Button>
            </div>

            <ul className="mt-3 max-h-80 divide-y divide-[var(--border)] overflow-y-auto rounded-md border border-[var(--border)]">
              {files.length === 0 && !listLoading ? (
                <li className="px-3 py-6 text-center text-sm text-[var(--muted-foreground)]">
                  No Google Docs found.
                </li>
              ) : (
                files.map((file) => {
                  const status = importStatus[file.id];
                  return (
                    <li
                      key={file.id}
                      className="flex items-start gap-3 px-3 py-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected.has(file.id)}
                        onChange={() => toggle(file.id)}
                        disabled={importing}
                        aria-label={`Select ${file.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{file.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {file.modifiedTime
                            ? `Modified ${new Date(file.modifiedTime).toLocaleString()}`
                            : "Google Doc"}
                          {status?.state === "importing" && " · Importing…"}
                          {status?.state === "done" &&
                            (status.skipped
                              ? " · Already imported"
                              : " · Imported")}
                          {status?.state === "error" && ` · ${status.error}`}
                        </p>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>

            {nextPageToken && (
              <div className="mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={listLoading || importing}
                  onClick={() =>
                    void loadFiles({ pageToken: nextPageToken, append: true })
                  }
                >
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

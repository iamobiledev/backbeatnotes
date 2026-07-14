"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { actionListWorkspaceMembers } from "@/app/actions";
import {
  HIGHLIGHT_START,
  HIGHLIGHT_END,
  type SearchHit,
} from "@/lib/search/types";

type Member = { userId: string; name: string };

const DATE_FILTERS = [
  { value: "", label: "Any time" },
  { value: "1", label: "Past 24 hours" },
  { value: "7", label: "Past week" },
  { value: "30", label: "Past month" },
] as const;

/**
 * Global Cmd/Ctrl+K search palette with owner/date filters, highlighted
 * snippets, and keyboard navigation.
 */
export function CommandPalette({ workspaceId }: { workspaceId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [ownerId, setOwnerId] = useState("");
  const [days, setDays] = useState("");
  const [scope, setScope] = useState<"workspace" | "all">(
    workspaceId ? "workspace" : "all",
  );
  const [members, setMembers] = useState<Member[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestSeq = useRef(0);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setHits([]);
      setSearched(false);
      setError(null);
      setSelectedIndex(0);
    }
  }, []);

  // Open on Cmd/Ctrl+K or the custom event fired by the sidebar button.
  // (Escape/overlay close through Radix, which resets via handleOpenChange.)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("docloom:open-search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("docloom:open-search", onOpen);
    };
  }, []);

  // Load workspace members once for the owner filter.
  useEffect(() => {
    if (!open || !workspaceId || members.length > 0) return;
    void actionListWorkspaceMembers({ workspaceId }).then((result) => {
      if (result.ok) {
        setMembers(
          result.data.map((m) => ({ userId: m.userId, name: m.name })),
        );
      }
    });
  }, [open, workspaceId, members.length]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearched(false);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q });
      if (scope === "workspace" && workspaceId) {
        params.set("workspaceId", workspaceId);
      }
      if (ownerId) params.set("ownerId", ownerId);
      if (days) {
        const after = new Date(Date.now() - Number(days) * 86_400_000);
        params.set("updatedAfter", after.toISOString());
      }
      const res = await fetch(`/api/search?${params.toString()}`);
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Searching too fast — give it a second."
            : "Search is unavailable right now.",
        );
        setHits([]);
        return;
      }
      const data = (await res.json()) as { hits: SearchHit[] };
      if (seq !== requestSeq.current) return;
      setHits(data.hits);
      setSearched(true);
      setSelectedIndex(0);
    } catch {
      if (seq === requestSeq.current) {
        setError("Search is unavailable right now.");
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [query, scope, workspaceId, ownerId, days]);

  useEffect(() => {
    const handle = setTimeout(() => void runSearch(), 200);
    return () => clearTimeout(handle);
  }, [runSearch]);

  const openHit = useCallback(
    (hit: SearchHit) => {
      handleOpenChange(false);
      router.push(`/app/${hit.workspaceId}/docs/${hit.documentId}`);
    },
    [router, handleOpenChange],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter" && hits[selectedIndex]) {
      event.preventDefault();
      openHit(hits[selectedIndex]);
    }
  };

  // Keep the selected row visible.
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="top-[16%] max-w-2xl translate-y-0 gap-0 overflow-hidden rounded-xl p-0 shadow-[0_24px_60px_rgba(15,15,15,0.25)]"
        hideClose
        aria-describedby={undefined}
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">Search documents</DialogTitle>
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
          {loading ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--muted-foreground)]" />
          ) : (
            <Search className="h-5 w-5 shrink-0 text-[var(--muted-foreground)]" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search or ask a question…"
            aria-label="Search pages and content"
            className="h-13 w-full bg-transparent text-lg outline-none placeholder:text-[var(--placeholder)]"
          />
          <kbd className="shrink-0 rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
            esc
          </kbd>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          {workspaceId && (
            <Select
              aria-label="Search scope"
              className="w-36 text-xs [&_select]:h-7 [&_select]:py-0 [&_select]:text-xs"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as "workspace" | "all")
              }
            >
              <option value="workspace">This workspace</option>
              <option value="all">All workspaces</option>
            </Select>
          )}
          {members.length > 1 && (
            <Select
              aria-label="Filter by owner"
              className="w-36 text-xs [&_select]:h-7 [&_select]:py-0 [&_select]:text-xs"
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
            >
              <option value="">Any owner</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </Select>
          )}
          <Select
            aria-label="Filter by date"
            className="w-36 text-xs [&_select]:h-7 [&_select]:py-0 [&_select]:text-xs"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          >
            {DATE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {error && (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
              {error}
            </p>
          )}
          {!error && !query.trim() && (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
              Type to search titles and content. Use the filters to narrow by
              owner or date.
            </p>
          )}
          {!error && query.trim() && searched && hits.length === 0 && !loading && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium">No matches</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Try different keywords or clear the filters.
              </p>
            </div>
          )}
          <ul ref={listRef} role="listbox" aria-label="Search results" className="p-1">
            {hits.map((hit, index) => (
              <li key={hit.documentId} role="option" aria-selected={index === selectedIndex}>
                <button
                  type="button"
                  onClick={() => openHit(hit)}
                  onMouseMove={() => setSelectedIndex(index)}
                  className={`flex w-full items-start gap-3 rounded-md px-4 py-2.5 text-left transition-colors ${
                    index === selectedIndex ? "bg-[var(--sidebar-hover)]" : ""
                  }`}
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {hit.title || "Untitled"}
                    </span>
                    {hit.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--muted-foreground)]">
                        <HighlightedSnippet text={hit.snippet} />
                      </span>
                    )}
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--muted-foreground)]">
                      {[
                        hit.breadcrumbPath || hit.workspaceName,
                        hit.creatorName,
                        formatDistanceToNow(new Date(hit.updatedAt), {
                          addSuffix: true,
                        }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Render a snippet with ⟪…⟫ match markers as <mark> elements.
 * Text is never injected as HTML.
 */
export function HighlightedSnippet({ text }: { text: string }) {
  const parts = useMemo(() => {
    const segments: Array<{ text: string; match: boolean }> = [];
    let rest = text;
    while (rest.length > 0) {
      const start = rest.indexOf(HIGHLIGHT_START);
      if (start === -1) {
        segments.push({ text: rest, match: false });
        break;
      }
      if (start > 0) segments.push({ text: rest.slice(0, start), match: false });
      const end = rest.indexOf(HIGHLIGHT_END, start);
      if (end === -1) {
        segments.push({ text: rest.slice(start + 1), match: false });
        break;
      }
      segments.push({ text: rest.slice(start + 1, end), match: true });
      rest = rest.slice(end + 1);
    }
    return segments;
  }, [text]);

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part.match ? (
            <mark className="rounded-sm bg-[var(--hero-glow)] px-0.5 font-medium text-[var(--foreground)]">
              {part.text}
            </mark>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </>
  );
}

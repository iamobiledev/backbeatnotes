"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { BookOpen, CornerUpLeft, FileText, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { actionMoveDocument } from "@/app/actions";
import type { DocumentTreeNode } from "@/lib/documents/types";
import { collectSubtreeIds } from "./tree-dnd";

type Destination = {
  id: string;
  title: string;
  icon: string | null;
  docType: DocumentTreeNode["docType"];
  depth: number;
};

/**
 * Notion-style "Move to" picker: search across every page in the workspace
 * (excluding the page itself, its sub-pages, and its current parent) plus a
 * "top level" destination.
 */
export function MoveToDialog({
  open,
  onOpenChange,
  document,
  nodes,
  rootLabel,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page being moved (with its children, to exclude the subtree). */
  document: DocumentTreeNode;
  /** Workspace tree roots — the candidate destinations. */
  nodes: DocumentTreeNode[];
  /** Section name shown for the top-level destination (e.g. "Private"). */
  rootLabel: string;
  onMoved?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [moving, startMoving] = useTransition();

  const destinations = useMemo(() => {
    const excluded = collectSubtreeIds(document);
    const flat: Destination[] = [];
    const walk = (list: DocumentTreeNode[], depth: number) => {
      for (const item of list) {
        if (excluded.has(item.id)) continue;
        if (item.id !== document.parentId) {
          flat.push({
            id: item.id,
            title: item.title,
            icon: item.icon,
            docType: item.docType,
            depth,
          });
        }
        walk(item.children, depth + 1);
      }
    };
    walk(nodes, 0);
    return flat;
  }, [document, nodes]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? destinations.filter((item) =>
        (item.title || "Untitled").toLowerCase().includes(normalizedQuery),
      )
    : destinations;

  const showRootOption =
    document.parentId !== null &&
    (!normalizedQuery || rootLabel.toLowerCase().includes(normalizedQuery));

  const move = (newParentId: string | null, destinationLabel: string) => {
    if (moving) return;
    startMoving(async () => {
      const result = await actionMoveDocument({
        documentId: document.id,
        newParentId,
      });
      if (result.ok) {
        toast.success(`Moved to "${destinationLabel}"`);
        onOpenChange(false);
        onMoved?.();
      } else {
        toast.error(result.error);
      }
    });
  };

  const selectFirst = () => {
    if (showRootOption) {
      move(null, rootLabel);
      return;
    }
    const first = filtered[0];
    if (first) move(first.id, first.title || "Untitled");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-base">
            Move &ldquo;{document.title || "Untitled"}&rdquo; to…
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5">
          <Search className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                selectFirst();
              }
            }}
            placeholder="Search pages…"
            aria-label="Search move destinations"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
          />
        </div>
        <ul
          aria-label="Move destinations"
          className="max-h-72 space-y-px overflow-y-auto"
        >
          {showRootOption && (
            <li>
              <button
                type="button"
                disabled={moving}
                onClick={() => move(null, rootLabel)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:outline-none disabled:opacity-50"
              >
                <CornerUpLeft className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                <span className="truncate">
                  Top level of {rootLabel}
                </span>
              </button>
            </li>
          )}
          {filtered.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={moving}
                onClick={() => move(item.id, item.title || "Untitled")}
                style={{ paddingLeft: 8 + item.depth * 14 }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:outline-none disabled:opacity-50"
              >
                {item.icon ? (
                  <span className="shrink-0 text-sm leading-none">
                    {item.icon}
                  </span>
                ) : item.docType === "wiki" ? (
                  <BookOpen className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
                )}
                <span className="truncate">{item.title || "Untitled"}</span>
              </button>
            </li>
          ))}
          {!showRootOption && filtered.length === 0 && (
            <li className="px-2 py-3 text-center text-sm text-[var(--muted-foreground)]">
              No pages match &ldquo;{query}&rdquo;
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

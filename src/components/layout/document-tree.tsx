"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronRight,
  Copy,
  FileText,
  Link2,
  Lock,
  MoreHorizontal,
  PenLine,
  Plus,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  actionDuplicateDocument,
  actionRenameDocument,
  actionToggleFavorite,
  actionTrashDocument,
} from "@/app/actions";
import type { DocumentTreeNode } from "@/lib/documents/types";

/**
 * Collapsible page tree for the sidebar. Ancestors of the active page are
 * expanded automatically. Rows expose Notion-style hover controls: a "···"
 * menu (rename, favorite, copy link, duplicate, trash) and an add-page "+".
 */
export function DocumentTree({
  nodes,
  workspaceId,
  activePath,
  favoriteIds,
  onCreateChild,
}: {
  nodes: DocumentTreeNode[];
  workspaceId: string;
  activePath: string;
  favoriteIds?: Set<string>;
  onCreateChild?: (parentId: string) => void;
}) {
  const activeDocId = useMemo(() => {
    const match = activePath.match(/\/docs\/([^/]+)/);
    return match?.[1] ?? null;
  }, [activePath]);

  const ancestorIds = useMemo(() => {
    if (!activeDocId) return new Set<string>();
    const result = new Set<string>();
    const walk = (list: DocumentTreeNode[], trail: string[]): boolean => {
      for (const node of list) {
        if (node.id === activeDocId) {
          trail.forEach((id) => result.add(id));
          return true;
        }
        if (walk(node.children, [...trail, node.id])) return true;
      }
      return false;
    };
    walk(nodes, []);
    return result;
  }, [nodes, activeDocId]);

  // User toggles override the default (auto-expanded ancestors of the
  // active page) — no effects needed.
  const [userToggled, setUserToggled] = useState<Map<string, boolean>>(
    new Map(),
  );

  const expanded = useMemo(() => {
    const set = new Set<string>(ancestorIds);
    for (const [id, isOpen] of userToggled) {
      if (isOpen) set.add(id);
      else set.delete(id);
    }
    return set;
  }, [ancestorIds, userToggled]);

  const toggle = (id: string) =>
    setUserToggled((prev) => {
      const next = new Map(prev);
      const currentlyOpen = next.has(id) ? next.get(id)! : ancestorIds.has(id);
      next.set(id, !currentlyOpen);
      return next;
    });

  return (
    <ul role="tree" aria-label="Pages">
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          workspaceId={workspaceId}
          activeDocId={activeDocId}
          expanded={expanded}
          favoriteIds={favoriteIds}
          onToggle={toggle}
          onCreateChild={onCreateChild}
        />
      ))}
    </ul>
  );
}

function TreeItem({
  node,
  depth,
  workspaceId,
  activeDocId,
  expanded,
  favoriteIds,
  onToggle,
  onCreateChild,
}: {
  node: DocumentTreeNode;
  depth: number;
  workspaceId: string;
  activeDocId: string | null;
  expanded: Set<string>;
  favoriteIds?: Set<string>;
  onToggle: (id: string) => void;
  onCreateChild?: (parentId: string) => void;
}) {
  const router = useRouter();
  const isActive = node.id === activeDocId;
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [favoriteOverride, setFavoriteOverride] = useState<boolean | null>(
    null,
  );
  const displayTitle = titleOverride ?? node.title;
  const isFavorited =
    favoriteOverride ?? favoriteIds?.has(node.id) ?? false;
  const docUrl = `/app/${workspaceId}/docs/${node.id}`;

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [, startTransition] = useTransition();
  const renameCommittedRef = useRef(false);

  const commitRename = (value: string) => {
    if (renameCommittedRef.current) return;
    renameCommittedRef.current = true;
    setRenaming(false);
    const title = value.trim();
    if (!title || title === displayTitle) return;
    const previousTitle = displayTitle;
    setTitleOverride(title);
    startTransition(async () => {
      const result = await actionRenameDocument({ documentId: node.id, title });
      if (!result.ok) {
        setTitleOverride(previousTitle);
        toast.error(result.error);
      }
    });
  };

  const toggleFavorite = () => {
    const previous = isFavorited;
    setFavoriteOverride(!previous);
    startTransition(async () => {
      const result = await actionToggleFavorite({ documentId: node.id });
      if (!result.ok) {
        setFavoriteOverride(previous);
        toast.error(result.error);
      }
    });
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${docUrl}`);
    toast.success("Link copied to clipboard");
  };

  const duplicate = () => {
    startTransition(async () => {
      const result = await actionDuplicateDocument({ documentId: node.id });
      if (result.ok) {
        toast.success("Page duplicated");
      } else {
        toast.error(result.error);
      }
    });
  };

  const moveToTrash = () => {
    startTransition(async () => {
      const result = await actionTrashDocument({ documentId: node.id });
      if (result.ok) {
        toast.success("Moved to trash");
        if (isActive) router.push(`/app/${workspaceId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const controlsVisibility = menuOpen
    ? "opacity-100"
    : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100";

  return (
    <li
      role="treeitem"
      aria-selected={isActive}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <div
        className={`group flex items-center rounded-md pr-1 transition-colors hover:bg-[var(--sidebar-hover)] ${
          isActive ? "bg-[var(--sidebar-active)]" : ""
        }`}
        style={{ paddingLeft: depth * 12 }}
      >
        {/* Notion-style: the page icon swaps to a toggle chevron on hover. */}
        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
          <span
            className={`pointer-events-none absolute inset-0 flex items-center justify-center ${
              hasChildren ? "transition-opacity group-hover:opacity-0" : ""
            }`}
          >
            {node.icon ? (
              <span className="text-sm leading-none">{node.icon}</span>
            ) : node.docType === "wiki" ? (
              <BookOpen className="h-4 w-4 text-[var(--muted-foreground)]" />
            ) : (
              <FileText className="h-4 w-4 text-[var(--muted-foreground)]" />
            )}
          </span>
          {hasChildren && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={isExpanded ? "Collapse" : "Expand"}
              onClick={() => onToggle(node.id)}
              className="absolute inset-0.5 flex items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--hover-strong)] focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </button>
          )}
        </span>

        {renaming ? (
          <input
            autoFocus
            defaultValue={displayTitle}
            aria-label="Rename page"
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename(event.currentTarget.value);
              } else if (event.key === "Escape") {
                renameCommittedRef.current = true;
                setRenaming(false);
              }
            }}
            onBlur={(event) => commitRename(event.currentTarget.value)}
            className="mx-0.5 min-w-0 flex-1 rounded border border-[var(--primary)] bg-[var(--card)] px-1 py-0.5 text-sm font-medium outline-none"
          />
        ) : (
          <Link
            href={docUrl}
            className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-0.5 text-sm font-medium ${
              isActive
                ? "text-[var(--foreground)]"
                : "text-[var(--muted-foreground)]"
            }`}
          >
            <span className="truncate">{displayTitle || "Untitled"}</span>
            {node.locked && (
              <Lock
                aria-label="Locked"
                className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]"
              />
            )}
          </Link>
        )}

        {!renaming && (
          <span
            className={`flex shrink-0 items-center gap-px transition-opacity ${controlsVisibility}`}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Page options for ${displayTitle || "Untitled"}`}
                  title="Delete, duplicate, and more…"
                  className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--hover-strong)] focus-visible:outline-none"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" className="w-52">
                <DropdownMenuItem
                  onSelect={() => {
                    renameCommittedRef.current = false;
                    setRenaming(true);
                  }}
                >
                  <PenLine className="h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleFavorite}>
                  {isFavorited ? (
                    <>
                      <StarOff className="h-4 w-4" />
                      Remove from favorites
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4" />
                      Add to favorites
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copyLink()}>
                  <Link2 className="h-4 w-4" />
                  Copy link
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={duplicate}>
                  <Copy className="h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={moveToTrash}>
                  <Trash2 className="h-4 w-4" />
                  Move to trash
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {onCreateChild && (
              <button
                type="button"
                aria-label={`Add page inside ${displayTitle || "Untitled"}`}
                title="Add a page inside"
                onClick={() => onCreateChild(node.id)}
                className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted-foreground)] hover:bg-[var(--hover-strong)] focus-visible:outline-none"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              activeDocId={activeDocId}
              expanded={expanded}
              favoriteIds={favoriteIds}
              onToggle={onToggle}
              onCreateChild={onCreateChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

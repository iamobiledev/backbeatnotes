"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  BookOpen,
  ChevronRight,
  Copy,
  CornerUpRight,
  ExternalLink,
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  actionDuplicateDocument,
  actionMoveDocument,
  actionRenameDocument,
  actionToggleFavorite,
  actionTrashDocument,
} from "@/app/actions";
import type { DocumentTreeNode } from "@/lib/documents/types";
import {
  DROP_TARGET_CLASS,
  collectSubtreeIds,
  endTreeDrag,
  getTreeDrag,
  startTreeDrag,
  type TreeDrag,
} from "./tree-dnd";

const MoveToDialog = dynamic(() =>
  import("./move-to-dialog").then((module) => module.MoveToDialog),
);

/**
 * Collapsible page tree for the sidebar. Ancestors of the active page are
 * expanded automatically. Rows expose Notion-style hover controls: a "···"
 * menu (rename, favorite, copy link, duplicate, move, trash) and an
 * add-page "+". Rows also open the same menu on right-click and support
 * drag & drop: drop a page onto another page to nest it as a sub-page.
 */
export function DocumentTree({
  nodes,
  workspaceId,
  activePath,
  favoriteIds,
  canEdit = true,
  rootLabel = "workspace",
  onCreateChild,
  onMoved,
}: {
  nodes: DocumentTreeNode[];
  workspaceId: string;
  activePath: string;
  favoriteIds?: Set<string>;
  /** Whether the viewer may edit pages (rename, move, trash, drag). */
  canEdit?: boolean;
  /** Section name for "Move to top level of …" (e.g. "Private"). */
  rootLabel?: string;
  onCreateChild?: (parentId: string) => void;
  /** Called after a page was moved so the owner can refresh the tree. */
  onMoved?: () => void;
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

  const toggle = (id: string, force?: boolean) =>
    setUserToggled((prev) => {
      const next = new Map(prev);
      const currentlyOpen = next.has(id) ? next.get(id)! : ancestorIds.has(id);
      next.set(id, force ?? !currentlyOpen);
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
          canEdit={canEdit}
          rootNodes={nodes}
          rootLabel={rootLabel}
          onToggle={toggle}
          onCreateChild={onCreateChild}
          onMoved={onMoved}
        />
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared page menu (rendered by both the "···" dropdown and right-click)      */
/* -------------------------------------------------------------------------- */

/**
 * Minimal structural props shared by Radix DropdownMenu and ContextMenu item
 * primitives, so one menu definition renders inside either menu type.
 */
type MenuPrimitives = {
  Item: React.ComponentType<{
    children?: React.ReactNode;
    destructive?: boolean;
    onSelect?: (event: Event) => void;
  }>;
  Separator: React.ComponentType<object>;
};

function PageMenuItems({
  M,
  canEdit,
  isFavorited,
  updatedAt,
  updatedByName,
  onToggleFavorite,
  onCopyLink,
  onDuplicate,
  onRename,
  onMoveTo,
  onTrash,
  onOpenInNewTab,
}: {
  M: MenuPrimitives;
  canEdit: boolean;
  isFavorited: boolean;
  updatedAt: Date;
  updatedByName: string | null;
  onToggleFavorite: () => void;
  onCopyLink: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onMoveTo: () => void;
  onTrash: () => void;
  onOpenInNewTab: () => void;
}) {
  return (
    <>
      <M.Item onSelect={onToggleFavorite}>
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
      </M.Item>
      <M.Separator />
      <M.Item onSelect={onCopyLink}>
        <Link2 className="h-4 w-4" />
        Copy link
      </M.Item>
      {canEdit && (
        <>
          <M.Item onSelect={onDuplicate}>
            <Copy className="h-4 w-4" />
            Duplicate
          </M.Item>
          <M.Item onSelect={onRename}>
            <PenLine className="h-4 w-4" />
            Rename
          </M.Item>
          <M.Item onSelect={onMoveTo}>
            <CornerUpRight className="h-4 w-4" />
            Move to
          </M.Item>
          <M.Item destructive onSelect={onTrash}>
            <Trash2 className="h-4 w-4" />
            Move to trash
          </M.Item>
        </>
      )}
      <M.Separator />
      <M.Item onSelect={onOpenInNewTab}>
        <ExternalLink className="h-4 w-4" />
        Open in new tab
      </M.Item>
      <M.Separator />
      <div className="px-2 py-1.5 text-xs text-[var(--muted-foreground)]">
        {updatedByName && (
          <p className="truncate">Last edited by {updatedByName}</p>
        )}
        <p>{format(updatedAt, "MMM d, yyyy, h:mm a")}</p>
      </div>
    </>
  );
}

const dropdownPrimitives: MenuPrimitives = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
};

const contextPrimitives: MenuPrimitives = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};

/* -------------------------------------------------------------------------- */
/* Tree row                                                                    */
/* -------------------------------------------------------------------------- */

function TreeItem({
  node,
  depth,
  workspaceId,
  activeDocId,
  expanded,
  favoriteIds,
  canEdit,
  rootNodes,
  rootLabel,
  onToggle,
  onCreateChild,
  onMoved,
}: {
  node: DocumentTreeNode;
  depth: number;
  workspaceId: string;
  activeDocId: string | null;
  expanded: Set<string>;
  favoriteIds?: Set<string>;
  canEdit: boolean;
  rootNodes: DocumentTreeNode[];
  rootLabel: string;
  onToggle: (id: string, force?: boolean) => void;
  onCreateChild?: (parentId: string) => void;
  onMoved?: () => void;
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
  const [contextOpen, setContextOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
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

  const startRename = () => {
    renameCommittedRef.current = false;
    setRenaming(true);
  };

  const openInNewTab = () => {
    window.open(docUrl, "_blank", "noopener");
  };

  /* ------------------------------ Drag & drop ----------------------------- */

  const canDrag = canEdit && !node.locked && !renaming;
  const [isDropTarget, setIsDropTarget] = useState(false);
  const dropDepthRef = useRef(0);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExpandTimer = () => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current);
      expandTimerRef.current = null;
    }
  };

  const resetDropState = () => {
    dropDepthRef.current = 0;
    setIsDropTarget(false);
    clearExpandTimer();
  };

  /** A drag that may legally be dropped onto this row, if any. */
  const validDrag = (): TreeDrag | null => {
    const drag = getTreeDrag();
    if (!drag || !canEdit) return null;
    if (drag.workspaceId !== workspaceId) return null;
    // No dropping a page onto itself or inside its own subtree.
    if (drag.subtreeIds.has(node.id)) return null;
    // Dropping onto the current parent is a no-op.
    if (drag.parentId === node.id) return null;
    return drag;
  };

  const handleDragStart = (event: React.DragEvent) => {
    if (!canDrag) {
      event.preventDefault();
      return;
    }
    // Nested rows: keep ancestors from overwriting the drag state.
    event.stopPropagation();
    startTreeDrag({
      docId: node.id,
      parentId: node.parentId,
      workspaceId,
      subtreeIds: collectSubtreeIds(node),
    });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", displayTitle || "Untitled");
  };

  const handleDragEnd = () => {
    endTreeDrag();
    resetDropState();
  };

  const handleDragEnter = (event: React.DragEvent) => {
    if (!validDrag()) return;
    event.preventDefault();
    dropDepthRef.current += 1;
    setIsDropTarget(true);
    // Notion behavior: hovering a collapsed parent briefly expands it.
    if (hasChildren && !isExpanded && !expandTimerRef.current) {
      expandTimerRef.current = setTimeout(() => {
        expandTimerRef.current = null;
        onToggle(node.id, true);
      }, 500);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!validDrag()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = () => {
    if (dropDepthRef.current === 0) return;
    dropDepthRef.current -= 1;
    if (dropDepthRef.current === 0) {
      setIsDropTarget(false);
      clearExpandTimer();
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    const drag = validDrag();
    resetDropState();
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    endTreeDrag();
    startTransition(async () => {
      const result = await actionMoveDocument({
        documentId: drag.docId,
        newParentId: node.id,
      });
      if (result.ok) {
        toast.success(`Moved to "${displayTitle || "Untitled"}"`);
        onToggle(node.id, true);
        onMoved?.();
      } else {
        toast.error(result.error);
      }
    });
  };

  /* ------------------------------------------------------------------------ */

  const controlsVisibility =
    menuOpen || contextOpen
      ? "opacity-100"
      : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100";

  const menuItems = (M: MenuPrimitives) => (
    <PageMenuItems
      M={M}
      canEdit={canEdit}
      isFavorited={isFavorited}
      updatedAt={node.updatedAt}
      updatedByName={node.updatedByName}
      onToggleFavorite={toggleFavorite}
      onCopyLink={() => void copyLink()}
      onDuplicate={duplicate}
      onRename={startRename}
      onMoveTo={() => setMoveOpen(true)}
      onTrash={moveToTrash}
      onOpenInNewTab={openInNewTab}
    />
  );

  return (
    <li
      role="treeitem"
      aria-selected={isActive}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <ContextMenu onOpenChange={setContextOpen}>
        <ContextMenuTrigger asChild>
          <div
            draggable={canDrag}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`group flex items-center rounded-md pr-1 transition-colors hover:bg-[var(--sidebar-hover)] ${
              isActive ? "bg-[var(--sidebar-active)]" : ""
            } ${isDropTarget ? DROP_TARGET_CLASS : ""}`}
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
                draggable={false}
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
                  <DropdownMenuContent
                    align="start"
                    side="right"
                    className="w-60"
                  >
                    {menuItems(dropdownPrimitives)}
                  </DropdownMenuContent>
                </DropdownMenu>

                {canEdit && onCreateChild && (
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
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          {menuItems(contextPrimitives)}
        </ContextMenuContent>
      </ContextMenu>

      {moveOpen && (
        <MoveToDialog
          open
          onOpenChange={setMoveOpen}
          document={node}
          nodes={rootNodes}
          rootLabel={rootLabel}
          onMoved={onMoved}
        />
      )}

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
              canEdit={canEdit}
              rootNodes={rootNodes}
              rootLabel={rootLabel}
              onToggle={onToggle}
              onCreateChild={onCreateChild}
              onMoved={onMoved}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

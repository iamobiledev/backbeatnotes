"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, FileText, Lock, Plus } from "lucide-react";
import type { DocumentTreeNode } from "@/lib/documents/types";

/**
 * Collapsible page tree for the sidebar. Ancestors of the active page are
 * expanded automatically.
 */
export function DocumentTree({
  nodes,
  workspaceId,
  activePath,
  onCreateChild,
}: {
  nodes: DocumentTreeNode[];
  workspaceId: string;
  activePath: string;
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
  onToggle,
  onCreateChild,
}: {
  node: DocumentTreeNode;
  depth: number;
  workspaceId: string;
  activeDocId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onCreateChild?: (parentId: string) => void;
}) {
  const isActive = node.id === activeDocId;
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;

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
              className="absolute inset-0.5 flex items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[rgba(55,53,47,0.12)] focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
            </button>
          )}
        </span>
        <Link
          href={`/app/${workspaceId}/docs/${node.id}`}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-0.5 text-sm font-medium ${
            isActive
              ? "text-[var(--foreground)]"
              : "text-[var(--muted-foreground)]"
          }`}
        >
          <span className="truncate">{node.title || "Untitled"}</span>
          {node.locked && (
            <Lock
              aria-label="Locked"
              className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]"
            />
          )}
        </Link>
        {onCreateChild && (
          <button
            type="button"
            aria-label={`Add page inside ${node.title || "Untitled"}`}
            onClick={() => onCreateChild(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[rgba(55,53,47,0.12)] focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
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
              onToggle={onToggle}
              onCreateChild={onCreateChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

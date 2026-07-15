"use client";

import { useRef, useState } from "react";
import type { DocumentTreeNode } from "@/lib/documents/types";

/**
 * Shared drag state for sidebar page drag & drop.
 *
 * HTML5 `dataTransfer` payloads are unreadable during `dragover`, so a
 * module-level store is the standard same-window workaround. Only one drag
 * can happen at a time, so a single slot is enough.
 */
export type TreeDrag = {
  docId: string;
  parentId: string | null;
  workspaceId: string;
  /** The dragged page id plus every descendant id (invalid drop targets). */
  subtreeIds: Set<string>;
};

let current: TreeDrag | null = null;

export function startTreeDrag(drag: TreeDrag) {
  current = drag;
}

export function endTreeDrag() {
  current = null;
}

export function getTreeDrag(): TreeDrag | null {
  return current;
}

/** The dragged page id and all of its descendants' ids. */
export function collectSubtreeIds(node: DocumentTreeNode): Set<string> {
  const ids = new Set<string>();
  const walk = (item: DocumentTreeNode) => {
    ids.add(item.id);
    item.children.forEach(walk);
  };
  walk(node);
  return ids;
}

/** Row highlight used by every sidebar drop target. */
export const DROP_TARGET_CLASS =
  "bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] shadow-[inset_0_0_0_1.5px_var(--primary)]";

/**
 * Drop-target behavior for "move to top level" zones (the Private section
 * header and teamspace rows). Accepts drags from the same workspace that are
 * not already at the top level.
 */
export function useRootDropTarget({
  workspaceId,
  enabled,
  onDropDocument,
}: {
  workspaceId: string;
  enabled: boolean;
  onDropDocument: (documentId: string) => void;
}) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const depthRef = useRef(0);

  const validDrag = (): TreeDrag | null => {
    const drag = getTreeDrag();
    if (!enabled || !drag) return null;
    if (drag.workspaceId !== workspaceId) return null;
    if (drag.parentId === null) return null;
    return drag;
  };

  const reset = () => {
    depthRef.current = 0;
    setIsDropTarget(false);
  };

  const dropProps = {
    onDragEnter: (event: React.DragEvent) => {
      if (!validDrag()) return;
      event.preventDefault();
      depthRef.current += 1;
      setIsDropTarget(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!validDrag()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDragLeave: () => {
      if (depthRef.current === 0) return;
      depthRef.current -= 1;
      if (depthRef.current === 0) setIsDropTarget(false);
    },
    onDrop: (event: React.DragEvent) => {
      const drag = validDrag();
      reset();
      if (!drag) return;
      event.preventDefault();
      event.stopPropagation();
      endTreeDrag();
      onDropDocument(drag.docId);
    },
  };

  return { isDropTarget, dropProps };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import {
  Check,
  CheckSquare,
  ChevronRight,
  Code,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Plus,
  Text,
  TextQuote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { TURN_INTO_OPTIONS, getActiveTurnIntoLabel } from "./turn-into";

type BlockHandleProps = {
  editor: Editor;
};

type HoveredBlock = {
  node: ProseMirrorNode;
  pos: number;
  dom: HTMLElement;
};

const TURN_INTO_ICONS: Record<string, LucideIcon> = {
  Text,
  "Heading 1": Heading1,
  "Heading 2": Heading2,
  "Heading 3": Heading3,
  "Bulleted list": List,
  "Numbered list": ListOrdered,
  "To-do list": CheckSquare,
  Quote: TextQuote,
  Code,
};

const HANDLE_WIDTH = 52;
const BLOCK_DRAG_MIME = "application/x-docloom-block";

/** ProseMirror exposes `view.dragging` as a mutable drag payload. */
function setProseMirrorDragging(
  view: Editor["view"],
  payload: { slice: ReturnType<NodeSelection["content"]>; move: boolean } | null,
) {
  view.dragging = payload;
}

function moveBlock(editor: Editor, from: number, to: number) {
  const { state } = editor.view;
  const node = state.doc.nodeAt(from);
  if (!node) return;

  const size = node.nodeSize;
  if (to >= from && to <= from + size) return; // no-op drop onto self

  let tr = state.tr;
  if (to > from) {
    // Delete first would shift `to`; insert then delete at original from.
    tr = tr.insert(to, node).delete(from, from + size);
  } else {
    tr = tr.delete(from, from + size).insert(to, node);
  }
  editor.view.dispatch(tr.scrollIntoView());
}

/**
 * Notion-style block controls: hover-reveal + / grip, drag-to-reorder with a
 * blue drop indicator (via TipTap dropcursor), and a click menu for delete /
 * duplicate / turn-into.
 */
export function BlockHandle({ editor }: BlockHandleProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const hoveredRef = useRef<HoveredBlock | null>(null);
  const menuBlockRef = useRef<HoveredBlock | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const skipClickRef = useRef(false);
  const dragPosRef = useRef<number>(-1);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuOpenRef = useRef(menuOpen);
  const draggingRef = useRef(dragging);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  const clearHoverHighlight = useCallback(() => {
    const prev = hoveredRef.current?.dom;
    prev?.classList.remove("is-block-hovered");
  }, []);

  const hide = useCallback(() => {
    if (menuOpenRef.current) return;
    clearHoverHighlight();
    hoveredRef.current = null;
    setVisible(false);
  }, [clearHoverHighlight]);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      hide();
    }, 200);
  }, [cancelHide, hide]);

  const positionFor = useCallback((dom: HTMLElement) => {
    const rect = dom.getBoundingClientRect();
    setCoords({
      top: rect.top,
      left: rect.left - HANDLE_WIDTH,
    });
  }, []);

  const findTopLevelBlock = useCallback(
    (clientX: number, clientY: number): HoveredBlock | null => {
      const view = editor.view;
      // Prefer the exact point; if the cursor is in the left gutter (empty
      // margin), probe a few pixels into the content column.
      const probes = [clientX, clientX + 24, clientX + 48];
      for (const x of probes) {
        const coordsAt = view.posAtCoords({ left: x, top: clientY });
        if (!coordsAt) continue;

        const $pos = view.state.doc.resolve(coordsAt.pos);
        if ($pos.depth === 0) {
          const after = $pos.nodeAfter;
          if (after) {
            const dom = view.nodeDOM($pos.pos);
            if (dom instanceof HTMLElement) {
              return { node: after, pos: $pos.pos, dom };
            }
          }
          continue;
        }

        const depth = 1;
        const pos = $pos.before(depth);
        const node = $pos.node(depth);
        const dom = view.nodeDOM(pos);
        if (!(dom instanceof HTMLElement)) continue;
        return { node, pos, dom };
      }
      return null;
    },
    [editor],
  );

  useEffect(() => {
    const view = editor.view;
    const dom = view.dom;

    const onMouseMove = (event: MouseEvent) => {
      if (draggingRef.current || menuOpenRef.current) return;
      if (handleRef.current?.contains(event.target as Node)) return;

      const block = findTopLevelBlock(event.clientX, event.clientY);
      if (!block) {
        scheduleHide();
        return;
      }

      cancelHide();
      const prev = hoveredRef.current;
      if (!prev || prev.pos !== block.pos || prev.dom !== block.dom) {
        clearHoverHighlight();
        block.dom.classList.add("is-block-hovered");
        hoveredRef.current = block;
      }
      positionFor(block.dom);
      setVisible(true);
    };

    const onMouseLeave = (event: MouseEvent) => {
      if (draggingRef.current || menuOpenRef.current) return;
      const related = event.relatedTarget as Node | null;
      if (related && handleRef.current?.contains(related)) return;
      scheduleHide();
    };

    const onScroll = () => {
      const block = hoveredRef.current;
      if (block) positionFor(block.dom);
    };

    dom.addEventListener("mousemove", onMouseMove);
    dom.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      dom.removeEventListener("mousemove", onMouseMove);
      dom.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("scroll", onScroll, true);
      cancelHide();
      clearHoverHighlight();
    };
  }, [
    editor,
    findTopLevelBlock,
    hide,
    clearHoverHighlight,
    positionFor,
    scheduleHide,
    cancelHide,
  ]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setTurnIntoOpen(false);
    menuBlockRef.current = null;
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (handleRef.current?.contains(target)) return;
      closeMenu();
      hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        hide();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, closeMenu, hide]);

  const selectBlock = useCallback(
    (block: HoveredBlock) => {
      const { pos, node } = block;
      if (node.isTextblock) {
        editor.commands.setTextSelection({
          from: pos + 1,
          to: pos + node.nodeSize - 1,
        });
      } else {
        editor.commands.setNodeSelection(pos);
      }
    },
    [editor],
  );

  const openMenu = useCallback(() => {
    const block = hoveredRef.current;
    if (!block) return;
    menuBlockRef.current = block;
    selectBlock(block);
    setTurnIntoOpen(false);
    setMenuOpen(true);
  }, [selectBlock]);

  const insertBlockBelow = useCallback(() => {
    const block = hoveredRef.current;
    if (!block) return;
    const insertPos = block.pos + block.node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, { type: "paragraph" })
      .setTextSelection(insertPos + 1)
      .run();
    hide();
  }, [editor, hide]);

  const deleteBlock = useCallback(() => {
    const block = menuBlockRef.current;
    if (!block) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: block.pos, to: block.pos + block.node.nodeSize })
      .run();
    closeMenu();
    hide();
  }, [editor, closeMenu, hide]);

  const duplicateBlock = useCallback(() => {
    const block = menuBlockRef.current;
    if (!block) return;
    const insertPos = block.pos + block.node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, block.node.toJSON())
      .run();
    closeMenu();
  }, [editor, closeMenu]);

  const applyTurnInto = useCallback(
    (apply: (editor: Editor) => void) => {
      const block = menuBlockRef.current;
      if (!block) return;
      selectBlock(block);
      apply(editor);
      closeMenu();
    },
    [editor, selectBlock, closeMenu],
  );

  const onGripDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      const block = hoveredRef.current;
      if (!block) {
        event.preventDefault();
        return;
      }

      skipClickRef.current = true;
      setDragging(true);
      closeMenu();
      dragPosRef.current = block.pos;

      const view = editor.view;
      const selection = NodeSelection.create(view.state.doc, block.pos);
      const slice = selection.content();
      view.dispatch(view.state.tr.setSelection(selection));
      setProseMirrorDragging(view, { slice, move: true });

      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(BLOCK_DRAG_MIME, String(block.pos));
      // Some browsers require a text fallback; use a non-empty sentinel that
      // we ignore on drop so an empty string isn’t inserted as a new block.
      event.dataTransfer.setData("text/plain", "\u00A0");

      const ghost = block.dom.cloneNode(true) as HTMLElement;
      ghost.style.position = "absolute";
      ghost.style.top = "-10000px";
      ghost.style.left = "0";
      ghost.style.width = `${block.dom.getBoundingClientRect().width}px`;
      ghost.style.opacity = "0.85";
      ghost.style.pointerEvents = "none";
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 0, 0);
      window.setTimeout(() => ghost.remove(), 0);
    },
    [editor, closeMenu],
  );

  const onGripDragEnd = useCallback(() => {
    setProseMirrorDragging(editor.view, null);
    setDragging(false);
    dragPosRef.current = -1;
    window.setTimeout(() => {
      skipClickRef.current = false;
    }, 0);
    hide();
  }, [editor, hide]);

  // Handle drops ourselves so external text/plain fallbacks never insert
  // empty paragraphs, and so reordering is deterministic.
  useEffect(() => {
    const view = editor.view;
    const dom = view.dom;

    const onDragOver = (event: DragEvent) => {
      if (!draggingRef.current) return;
      if (!event.dataTransfer?.types.includes(BLOCK_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    };

    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(BLOCK_DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();

      const from = dragPosRef.current;
      if (from < 0) return;

      const drop = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (!drop) return;

      // Snap to the nearest top-level block boundary (before/after).
      const $pos = view.state.doc.resolve(drop.pos);
      let to: number;
      if ($pos.depth === 0) {
        to = $pos.pos;
      } else {
        const blockStart = $pos.before(1);
        const blockNode = $pos.node(1);
        const blockEnd = blockStart + blockNode.nodeSize;
        const domNode = view.nodeDOM(blockStart);
        if (domNode instanceof HTMLElement) {
          const rect = domNode.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          to = event.clientY < mid ? blockStart : blockEnd;
        } else {
          to = blockStart;
        }
      }

      moveBlock(editor, from, to);
      setProseMirrorDragging(view, null);
      setDragging(false);
      dragPosRef.current = -1;
    };

    dom.addEventListener("dragover", onDragOver);
    dom.addEventListener("drop", onDrop, true);
    return () => {
      dom.removeEventListener("dragover", onDragOver);
      dom.removeEventListener("drop", onDrop, true);
    };
  }, [editor]);

  const activeLabel = getActiveTurnIntoLabel(editor);

  if (!visible && !menuOpen) return null;

  return (
    <div
      ref={handleRef}
      className={`block-drag-handle ${dragging ? "is-dragging" : ""}`}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: HANDLE_WIDTH,
        zIndex: 30,
      }}
      onMouseEnter={() => {
        cancelHide();
        setVisible(true);
      }}
      onMouseLeave={(event) => {
        if (menuOpenRef.current || draggingRef.current) return;
        const related = event.relatedTarget as Node | null;
        if (related && editor.view.dom.contains(related)) return;
        scheduleHide();
      }}
    >
      <div className="relative flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Add block below"
          title="Click to add below"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            insertBlockBelow();
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          draggable
          aria-label="Drag or open block options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Drag to move · click for options"
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)] active:cursor-grabbing"
          onDragStart={onGripDragStart}
          onDragEnd={onGripDragEnd}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (skipClickRef.current || dragging) return;
            if (menuOpen) {
              closeMenu();
              return;
            }
            openMenu();
          }}
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.75} />
        </button>

        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Block options"
            className="absolute top-0 right-full z-50 mr-2 w-52 animate-fade rounded-md border border-[var(--border)] bg-[var(--card)] p-1 text-[var(--foreground)] shadow-md"
          >
            <MenuItem
              destructive
              onSelect={deleteBlock}
              shortcut="Del"
              icon={Trash2}
            >
              Delete
            </MenuItem>
            <MenuItem onSelect={duplicateBlock} shortcut="⌘D" icon={Copy}>
              Duplicate
            </MenuItem>
            <div className="-mx-1 my-1 h-px bg-[var(--border)]" />
            <div className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={turnIntoOpen}
                className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-[var(--muted)] focus:bg-[var(--muted)]"
                onMouseEnter={() => setTurnIntoOpen(true)}
                onFocus={() => setTurnIntoOpen(true)}
                onClick={() => setTurnIntoOpen((open) => !open)}
              >
                <Text className="h-4 w-4" />
                Turn into
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-[var(--muted-foreground)]" />
              </button>
              {turnIntoOpen && (
                <div
                  role="menu"
                  aria-label="Turn into"
                  className="absolute top-0 right-full z-50 mr-1 w-48 animate-fade rounded-md border border-[var(--border)] bg-[var(--card)] p-1 shadow-md"
                  onMouseEnter={() => setTurnIntoOpen(true)}
                >
                  {TURN_INTO_OPTIONS.map((option) => {
                    const Icon = TURN_INTO_ICONS[option.label] ?? Text;
                    return (
                      <MenuItem
                        key={option.label}
                        icon={Icon}
                        onSelect={() => applyTurnInto(option.apply)}
                        trailing={
                          option.label === activeLabel ? (
                            <Check className="ml-auto h-3.5 w-3.5 text-[var(--primary)]" />
                          ) : null
                        }
                      >
                        {option.label}
                      </MenuItem>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  children,
  onSelect,
  icon: Icon,
  shortcut,
  trailing,
  destructive,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon: LucideIcon;
  shortcut?: string;
  trailing?: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-[var(--muted)] focus:bg-[var(--muted)] ${
        destructive ? "text-[var(--destructive)]" : ""
      }`}
      onClick={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <Icon className="h-4 w-4" />
      {children}
      {trailing}
      {shortcut && !trailing && (
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">
          {shortcut}
        </span>
      )}
    </button>
  );
}

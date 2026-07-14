import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Notion-style "selected block" highlight (the soft blue wash shown while a
 * block's ··· menu is open).
 *
 * Implemented as a ProseMirror node decoration rather than direct DOM
 * classList mutation: ProseMirror's DOM observer redraws nodes and discards
 * foreign class changes (e.g. whenever the selection is dispatched), so a
 * decoration is the only reliable way to keep the class applied.
 */

type BlockSelectionMeta = { pos: number } | { clear: true };

export const blockSelectionKey = new PluginKey<DecorationSet>(
  "blockSelectionHighlight",
);

/** Highlight the top-level block at `pos` (as set while its menu is open). */
export function setBlockSelectionHighlight(
  view: { state: import("@tiptap/pm/state").EditorState; dispatch: (tr: import("@tiptap/pm/state").Transaction) => void },
  pos: number,
) {
  view.dispatch(
    view.state.tr.setMeta(blockSelectionKey, { pos } satisfies BlockSelectionMeta),
  );
}

/** Remove the highlight (menu closed). */
export function clearBlockSelectionHighlight(view: {
  state: import("@tiptap/pm/state").EditorState;
  dispatch: (tr: import("@tiptap/pm/state").Transaction) => void;
}) {
  if (!blockSelectionKey.getState(view.state)?.find().length) return;
  view.dispatch(
    view.state.tr.setMeta(blockSelectionKey, {
      clear: true,
    } satisfies BlockSelectionMeta),
  );
}

export const BlockSelectionHighlight = Extension.create({
  name: "blockSelectionHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: blockSelectionKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(blockSelectionKey) as
              | BlockSelectionMeta
              | undefined;
            if (meta) {
              if ("clear" in meta) return DecorationSet.empty;
              const node = tr.doc.nodeAt(meta.pos);
              if (!node) return DecorationSet.empty;
              return DecorationSet.create(tr.doc, [
                Decoration.node(meta.pos, meta.pos + node.nodeSize, {
                  class: "is-block-selected",
                }),
              ]);
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return blockSelectionKey.getState(state);
          },
        },
      }),
    ];
  },
});

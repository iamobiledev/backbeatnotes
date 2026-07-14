import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { nanoid } from "nanoid";
import {
  BLOCK_ID_ATTRIBUTE,
  blockDomId,
  blockIdFromHash,
  isSearchableBlockType,
  isValidBlockId,
} from "@/lib/documents/blocks";

type BlockIdOptions = {
  assignIds: boolean;
};

const pluginKey = new PluginKey("docloomBlockIds");
const deepLinkPluginKey = new PluginKey<DecorationSet>(
  "docloomDeepLinkTarget",
);

function deepLinkDecorations(doc: ProseMirrorNode): DecorationSet {
  if (typeof window === "undefined") return DecorationSet.empty;
  const targetId = blockIdFromHash(window.location.hash);
  if (!targetId) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.attrs[BLOCK_ID_ATTRIBUTE] !== targetId) return;
    decorations.push(
      Decoration.node(position, position + node.nodeSize, {
        class: "is-deep-link-target",
      }),
    );
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

function deepLinkPlugin() {
  return new Plugin<DecorationSet>({
    key: deepLinkPluginKey,
    state: {
      init: (_config, state) => deepLinkDecorations(state.doc),
      apply: (transaction, current, _oldState, newState) =>
        transaction.docChanged || transaction.getMeta(deepLinkPluginKey)
          ? deepLinkDecorations(newState.doc)
          : current,
    },
    props: {
      decorations: (state) => deepLinkPluginKey.getState(state) ?? null,
    },
    view: (view) => {
      const update = () => {
        view.dispatch(view.state.tr.setMeta(deepLinkPluginKey, true));
      };
      const timer = setTimeout(update, 0);
      window.addEventListener("hashchange", update);
      return {
        destroy: () => {
          clearTimeout(timer);
          window.removeEventListener("hashchange", update);
        },
      };
    },
  });
}

function transactionWithMissingBlockIds(state: EditorState) {
  const seen = new Set<string>();
  let transaction = state.tr;
  let changed = false;

  state.doc.descendants((node, position) => {
    if (!isSearchableBlockType(node.type.name)) return;

    const current = node.attrs[BLOCK_ID_ATTRIBUTE] as unknown;
    let blockId = isValidBlockId(current) && !seen.has(current) ? current : "";
    if (!blockId) {
      do {
        blockId = nanoid();
      } while (seen.has(blockId));
      transaction = transaction.setNodeMarkup(position, undefined, {
        ...node.attrs,
        [BLOCK_ID_ATTRIBUTE]: blockId,
      });
      changed = true;
    }
    seen.add(blockId);
  });

  if (!changed) return null;
  transaction.setMeta("addToHistory", false);
  transaction.setMeta(pluginKey, true);
  return transaction;
}

/**
 * Stable anchors for paragraph-level search results.
 *
 * Editable instances repair missing/duplicated IDs. Read-only instances only
 * expose persisted IDs in the DOM and never mutate their content.
 */
export const BlockIdExtension = Extension.create<BlockIdOptions>({
  name: "docloomBlockIds",

  addOptions() {
    return { assignIds: true };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "codeBlock"],
        attributes: {
          [BLOCK_ID_ATTRIBUTE]: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes) => {
              const blockId = attributes[BLOCK_ID_ATTRIBUTE] as unknown;
              if (!isValidBlockId(blockId)) return {};
              return {
                "data-block-id": blockId,
                id: blockDomId(blockId),
              };
            },
          },
        },
      },
    ];
  },

  onCreate() {
    if (!this.options.assignIds) return;
    const transaction = transactionWithMissingBlockIds(this.editor.state);
    if (transaction) this.editor.view.dispatch(transaction);
  },

  addProseMirrorPlugins() {
    const plugins = [deepLinkPlugin()];
    if (this.options.assignIds) {
      plugins.push(
        new Plugin({
        key: pluginKey,
        appendTransaction: (transactions, _oldState, newState) => {
          if (
            !transactions.some((transaction) => transaction.docChanged) ||
            transactions.some((transaction) => transaction.getMeta(pluginKey))
          ) {
            return null;
          }
          return transactionWithMissingBlockIds(newState);
        },
        }),
      );
    }
    return plugins;
  },
});

"use client";

import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  type NodeViewProps,
} from "@tiptap/react";
import Link from "next/link";
import { FileText } from "lucide-react";

/**
 * Notion-style sub-page block: an atomic block that links to a child page.
 * Inserted by the "/subpage" slash command; the title attribute is refreshed
 * server-side on page load so renames stay in sync.
 */
export const Subpage = Node.create({
  name: "subpage",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      documentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-document-id"),
        renderHTML: (attributes) => ({
          "data-document-id": attributes.documentId as string | null,
        }),
      },
      workspaceId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-workspace-id"),
        renderHTML: (attributes) => ({
          "data-workspace-id": attributes.workspaceId as string | null,
        }),
      },
      title: {
        default: "Untitled",
        parseHTML: (element) => element.getAttribute("data-title"),
        renderHTML: (attributes) => ({
          "data-title": attributes.title as string,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="subpage"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "subpage" }, HTMLAttributes),
      (node.attrs.title as string) || "Untitled",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubpageView);
  },
});

function SubpageView({ node }: NodeViewProps) {
  const documentId = node.attrs.documentId as string | null;
  const workspaceId = node.attrs.workspaceId as string | null;
  const title = (node.attrs.title as string) || "Untitled";

  return (
    <NodeViewWrapper data-type="subpage" className="my-0.5">
      {documentId && workspaceId ? (
        <Link
          href={`/app/${workspaceId}/docs/${documentId}`}
          contentEditable={false}
          draggable={false}
          className="group flex w-full items-center gap-1.5 rounded-md px-1 py-1 no-underline transition-colors hover:bg-[var(--sidebar-hover)]"
        >
          <FileText className="h-4.5 w-4.5 shrink-0 text-[var(--muted-foreground)]" />
          <span className="truncate font-medium underline decoration-[var(--underline-soft)] underline-offset-[3px] group-hover:decoration-[var(--foreground)]">
            {title}
          </span>
        </Link>
      ) : (
        <span className="flex items-center gap-1.5 px-1 py-1 text-[var(--muted-foreground)]">
          <FileText className="h-4.5 w-4.5 shrink-0" />
          {title}
        </span>
      )}
    </NodeViewWrapper>
  );
}

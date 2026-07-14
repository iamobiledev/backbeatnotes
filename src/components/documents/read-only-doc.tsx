"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Subpage } from "@/components/editor/subpage-node";
import { NotionCodeBlock } from "@/components/editor/code-block";
import { BlockIdExtension } from "@/components/editor/block-id-extension";

/** Render TipTap JSON read-only (used for version previews). */
export function ReadOnlyDoc({
  contentJson,
}: {
  contentJson: Record<string, unknown>;
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false, codeBlock: false }),
        NotionCodeBlock,
        Image.configure({ allowBase64: false }),
        Link.configure({ openOnClick: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Subpage,
        BlockIdExtension.configure({ assignIds: false }),
      ],
      content: contentJson,
      editable: false,
      immediatelyRender: false,
    },
    [contentJson],
  );

  if (!editor) {
    return (
      <div className="space-y-2" aria-busy>
        <div className="h-4 w-full animate-pulse rounded bg-[var(--muted)]" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--muted)]" />
      </div>
    );
  }

  return (
    <div className="prose prose-neutral prose-sm max-w-none">
      <EditorContent editor={editor} />
    </div>
  );
}

import type { Editor } from "@tiptap/react";

export type TurnIntoOption = {
  label: string;
  isActive: (editor: Editor) => boolean;
  apply: (editor: Editor) => void;
};

/** Shared “Turn into” options for the bubble menu and block handle menu. */
export const TURN_INTO_OPTIONS: TurnIntoOption[] = [
  {
    label: "Text",
    isActive: (editor) =>
      editor.isActive("paragraph") &&
      !editor.isActive("bulletList") &&
      !editor.isActive("orderedList") &&
      !editor.isActive("taskList") &&
      !editor.isActive("blockquote"),
    apply: (editor) => {
      const chain = editor.chain().focus();
      if (editor.isActive("bulletList")) chain.toggleBulletList();
      if (editor.isActive("orderedList")) chain.toggleOrderedList();
      if (editor.isActive("taskList")) chain.toggleTaskList();
      if (editor.isActive("blockquote")) chain.lift("blockquote");
      chain.setParagraph().run();
    },
  },
  {
    label: "Heading 1",
    isActive: (editor) => editor.isActive("heading", { level: 1 }),
    apply: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    isActive: (editor) => editor.isActive("heading", { level: 2 }),
    apply: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    isActive: (editor) => editor.isActive("heading", { level: 3 }),
    apply: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    label: "Bulleted list",
    isActive: (editor) => editor.isActive("bulletList"),
    apply: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered list",
    isActive: (editor) => editor.isActive("orderedList"),
    apply: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "To-do list",
    isActive: (editor) => editor.isActive("taskList"),
    apply: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    label: "Quote",
    isActive: (editor) => editor.isActive("blockquote"),
    apply: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Code",
    isActive: (editor) => editor.isActive("codeBlock"),
    apply: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
];

export function getActiveTurnIntoLabel(editor: Editor): string {
  return (
    TURN_INTO_OPTIONS.find((option) => option.isActive(editor)) ??
    TURN_INTO_OPTIONS[0]
  ).label;
}

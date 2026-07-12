"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Extension, ReactRenderer, type Editor, type Range } from "@tiptap/react";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import {
  CheckSquare,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListOrdered,
  Minus,
  Text,
  TextQuote,
  type LucideIcon,
} from "lucide-react";

/** Fired when the "/image" command wants the editor to open its file picker. */
export const IMAGE_REQUEST_EVENT = "docloom:editor-image-request";

/** Fired when the "/subpage" command wants the editor to create a child page. */
export const SUBPAGE_REQUEST_EVENT = "docloom:editor-subpage-request";

export type SlashCommandItem = {
  title: string;
  description: string;
  searchTerms: string[];
  icon: LucideIcon;
  command: (props: { editor: Editor; range: Range }) => void;
};

type SlashCommandGroup = {
  name: string;
  items: SlashCommandItem[];
};

const GROUPS: SlashCommandGroup[] = [
  {
    name: "Basic blocks",
    items: [
      {
        title: "Text",
        description: "Just start writing with plain text.",
        searchTerms: ["p", "paragraph", "plain"],
        icon: Text,
        command: ({ editor, range }) =>
          editor.chain().focus().deleteRange(range).setParagraph().run(),
      },
      {
        title: "Heading 1",
        description: "Big section heading.",
        searchTerms: ["h1", "title", "big", "large"],
        icon: Heading1,
        command: ({ editor, range }) =>
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .setHeading({ level: 1 })
            .run(),
      },
      {
        title: "Heading 2",
        description: "Medium section heading.",
        searchTerms: ["h2", "medium"],
        icon: Heading2,
        command: ({ editor, range }) =>
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .setHeading({ level: 2 })
            .run(),
      },
      {
        title: "Heading 3",
        description: "Small section heading.",
        searchTerms: ["h3", "small"],
        icon: Heading3,
        command: ({ editor, range }) =>
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .setHeading({ level: 3 })
            .run(),
      },
      {
        title: "Sub-page",
        description: "Create a page inside this page.",
        searchTerms: ["subpage", "page", "child", "nested", "link", "doc"],
        icon: FileText,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).run();
          window.dispatchEvent(new CustomEvent(SUBPAGE_REQUEST_EVENT));
        },
      },
      {
        title: "To-do list",
        description: "Track tasks with a to-do list.",
        searchTerms: ["todo", "task", "check", "checkbox"],
        icon: CheckSquare,
        command: ({ editor, range }) =>
          editor.chain().focus().deleteRange(range).toggleTaskList().run(),
      },
      {
        title: "Bulleted list",
        description: "Create a simple bulleted list.",
        searchTerms: ["ul", "unordered", "point"],
        icon: List,
        command: ({ editor, range }) =>
          editor.chain().focus().deleteRange(range).toggleBulletList().run(),
      },
      {
        title: "Numbered list",
        description: "Create a list with numbering.",
        searchTerms: ["ol", "ordered", "numbers"],
        icon: ListOrdered,
        command: ({ editor, range }) =>
          editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
      },
      {
        title: "Quote",
        description: "Capture a quote.",
        searchTerms: ["blockquote", "citation"],
        icon: TextQuote,
        command: ({ editor, range }) =>
          editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
      },
      {
        title: "Divider",
        description: "Visually divide blocks.",
        searchTerms: ["hr", "horizontal", "rule", "separator", "line"],
        icon: Minus,
        command: ({ editor, range }) =>
          editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
      },
      {
        title: "Code",
        description: "Capture a code snippet.",
        searchTerms: ["codeblock", "snippet", "pre"],
        icon: Code,
        command: ({ editor, range }) =>
          editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
      },
    ],
  },
  {
    name: "Media",
    items: [
      {
        title: "Image",
        description: "Upload an image from your computer.",
        searchTerms: ["photo", "picture", "media", "upload"],
        icon: ImagePlus,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).run();
          window.dispatchEvent(new CustomEvent(IMAGE_REQUEST_EVENT));
        },
      },
    ],
  },
];

function filterGroups(query: string): SlashCommandGroup[] {
  const q = query.toLowerCase().trim();
  if (!q) return GROUPS;
  return GROUPS.map((group) => ({
    name: group.name,
    items: group.items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.searchTerms.some((term) => term.includes(q)),
    ),
  })).filter((group) => group.items.length > 0);
}

type SlashMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

type SlashMenuProps = {
  query: string;
  command: (item: SlashCommandItem) => void;
};

const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  function SlashMenu({ query, command }, ref) {
    const groups = filterGroups(query);
    const flat = groups.flatMap((group) => group.items);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    // Clamp the selection when the filtered list shrinks.
    const safeIndex = Math.min(selectedIndex, Math.max(flat.length - 1, 0));

    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-index="${safeIndex}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }, [safeIndex]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowDown") {
          setSelectedIndex((safeIndex + 1) % Math.max(flat.length, 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (safeIndex - 1 + Math.max(flat.length, 1)) %
              Math.max(flat.length, 1),
          );
          return true;
        }
        if (event.key === "Enter") {
          const item = flat[safeIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (flat.length === 0) {
      return (
        <div className="w-80 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-4 text-sm text-[var(--muted-foreground)] shadow-[0_9px_24px_rgba(15,15,15,0.2)]">
          No results
        </div>
      );
    }

    let runningIndex = -1;
    return (
      <div
        ref={containerRef}
        role="listbox"
        aria-label="Insert block"
        className="max-h-80 w-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1.5 shadow-[0_9px_24px_rgba(15,15,15,0.2)]"
      >
        {groups.map((group) => (
          <div key={group.name}>
            <p className="px-3 pb-1 pt-2 text-xs font-medium text-[var(--muted-foreground)]">
              {group.name}
            </p>
            {group.items.map((item) => {
              runningIndex += 1;
              const index = runningIndex;
              const active = index === safeIndex;
              return (
                <button
                  key={item.title}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-index={index}
                  onMouseEnter={() => setSelectedIndex(index)}
                  // Keep editor focus/selection while clicking.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => command(item)}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                    active ? "bg-[var(--sidebar-hover)]" : ""
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--card)]">
                    <item.icon className="h-4.5 w-4.5 text-[var(--foreground)]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[var(--foreground)]">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);

/**
 * Notion-style "/" menu: typing a slash at the start of a line (or after a
 * space) opens a filterable block picker anchored to the caret.
 */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) =>
          filterGroups(query).flatMap((group) => group.items),
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null =
            null;
          let unmount: (() => void) | null = null;

          return {
            onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
              component = new ReactRenderer(SlashMenu, {
                props: {
                  query: props.query,
                  command: (item: SlashCommandItem) => props.command(item),
                },
                editor: props.editor,
              });
              unmount = props.mount(component.element as HTMLElement);
            },
            onUpdate: (props) => {
              component?.updateProps({
                query: props.query,
                command: (item: SlashCommandItem) => props.command(item),
              });
            },
            // Escape is handled by the suggestion plugin itself (it exits
            // and triggers onExit), so only arrows/enter are handled here.
            onKeyDown: (props) => component?.ref?.onKeyDown(props) ?? false,
            onExit: () => {
              unmount?.();
              unmount = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});

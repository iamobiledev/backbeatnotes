"use client";

import {
  useEditor,
  useEditorState,
  EditorContent,
  isNodeSelection,
  type Editor,
} from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useRouter } from "next/navigation";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Bold,
  Check,
  ChevronDown,
  Code,
  Italic,
  Link2,
  Loader2,
  Strikethrough,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SlashCommand,
  IMAGE_REQUEST_EVENT,
  SUBPAGE_REQUEST_EVENT,
} from "./slash-command";
import { Subpage } from "./subpage-node";
import { BlockSelectionHighlight } from "./block-selection";
import { NotionCodeBlock } from "./code-block";
import { BlockHandle } from "./block-handle";
import {
  TURN_INTO_OPTIONS,
  getActiveTurnIntoLabel,
} from "./turn-into";
import { actionCreateDocument } from "@/app/actions";

export type SaveStatus = "saved" | "saving" | "dirty" | "error";

type SaveResult = { ok: true } | { ok: false; error: string };

type DocumentEditorProps = {
  documentId: string;
  workspaceId: string;
  initialTitle: string;
  initialContent: Record<string, unknown>;
  onSave: (payload: {
    title: string;
    contentJson: Record<string, unknown>;
  }) => Promise<SaveResult>;
  readOnly?: boolean;
};

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function DocumentEditor({
  documentId,
  workspaceId,
  initialTitle,
  initialContent,
  onSave,
  readOnly = false,
}: DocumentEditorProps) {
  const router = useRouter();
  // Fresh pages start with an empty title + "New page" placeholder (Notion
  // behavior) instead of prefilled "Untitled" text the user has to clear.
  const startingTitle = initialTitle === "Untitled" ? "" : initialTitle;
  const [title, setTitle] = useState(startingTitle);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mutable save-machine state (only touched from handlers/effects).
  const titleRef = useRef(startingTitle);
  const statusRef = useRef<SaveStatus>("saved");

  // The page can be renamed from outside (sidebar "···" menu). When the
  // server sends a new title and there are no unsaved local edits, adopt it
  // so a later autosave doesn't resurrect the stale title.
  useEffect(() => {
    if (statusRef.current === "saved") {
      setTitle(startingTitle);
      titleRef.current = startingTitle;
    }
  }, [startingTitle]);
  const savingRef = useRef(false);
  const dirtyAgainRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        codeBlock: false,
        // Notion-style blue drop indicator while reordering blocks.
        dropcursor: {
          color: "#2383e2",
          width: 2,
          class: "notion-dropcursor",
        },
      }),
      NotionCodeBlock,
      Placeholder.configure({
        // Notion-style: hint on the caret's empty line, not just the
        // first line of the document.
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            return `Heading ${node.attrs.level as number}`;
          }
          return "Write, or press '/' for commands…";
        },
        showOnlyCurrent: true,
      }),
      Image.configure({ allowBase64: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Subpage,
      SlashCommand,
      BlockSelectionHighlight,
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral editor-with-handles max-w-none min-h-[50vh] focus:outline-none pb-32",
        "aria-label": "Document content",
      },
    },
  });

  // Re-render the bubble menu contents on selection/state changes —
  // plain `editor.isActive(...)` reads during render would go stale.
  const activeStates = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        link: e.isActive("link"),
        turnIntoLabel: getActiveTurnIntoLabel(e),
      };
    },
  });

  // Stable handle to the latest save function (avoids self-reference,
  // which the React Compiler cannot memoize).
  const saveFnRef = useRef<((editor: Editor) => Promise<void>) | null>(null);

  const performSave = useCallback(
    async (currentEditor: Editor) => {
      if (readOnly) return;
      if (savingRef.current) {
        dirtyAgainRef.current = true;
        return;
      }
      savingRef.current = true;
      applyStatus("saving");
      const payload = {
        title: titleRef.current.trim() || "Untitled",
        // Deep-clone to plain JSON: ProseMirror attrs objects have a null
        // prototype, which React's server-action serializer refuses to send
        // (it turns them into opaque temporary references).
        contentJson: JSON.parse(
          JSON.stringify(currentEditor.getJSON()),
        ) as Record<string, unknown>,
      };
      let reschedule = false;
      try {
        const result = await onSave(payload);
        if (result.ok) {
          applyStatus(dirtyAgainRef.current ? "dirty" : "saved");
        } else {
          applyStatus("error");
          toast.error(result.error);
        }
      } catch {
        applyStatus("error");
      } finally {
        savingRef.current = false;
        if (dirtyAgainRef.current) {
          dirtyAgainRef.current = false;
          reschedule = true;
        }
      }
      if (reschedule) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          void saveFnRef.current?.(currentEditor);
        }, AUTOSAVE_DEBOUNCE_MS);
      }
    },
    [onSave, readOnly, applyStatus],
  );

  useEffect(() => {
    saveFnRef.current = performSave;
  }, [performSave]);

  // Deterministic save: waits out any in-flight autosave, then persists the
  // editor's *current* content. Used before navigating away (e.g. /subpage).
  const saveNow = useCallback(
    async (currentEditor: Editor) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      while (savingRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await performSave(currentEditor);
    },
    [performSave],
  );

  const scheduleSave = useCallback(
    (currentEditor: Editor) => {
      if (readOnly) return;
      if (statusRef.current !== "saving") applyStatus("dirty");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void performSave(currentEditor);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [performSave, readOnly, applyStatus],
  );

  // Mark dirty + debounce on every edit.
  useEffect(() => {
    if (!editor || readOnly) return;
    const handler = () => scheduleSave(editor);
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, readOnly, scheduleSave]);

  // Cmd/Ctrl+S saves immediately.
  useEffect(() => {
    if (!editor || readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        void performSave(editor);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, performSave, readOnly]);

  // The "/subpage" slash command: create a child page, link it inline, and
  // open it (Notion behavior).
  useEffect(() => {
    if (!editor || readOnly) return;
    const onSubpageRequest = () => {
      void (async () => {
        const creating = toast.loading("Creating sub-page…");
        try {
          const formData = new FormData();
          formData.set("workspaceId", workspaceId);
          formData.set("parentId", documentId);
          formData.set("title", "Untitled");
          const doc = await actionCreateDocument(formData);
          editor
            .chain()
            .focus()
            .insertContent({
              type: "subpage",
              attrs: {
                documentId: doc.id,
                workspaceId,
                title: doc.title || "Untitled",
              },
            })
            .run();
          // Persist the parent before leaving so the link is never lost.
          await saveNow(editor);
          toast.success("Sub-page created", { id: creating });
          router.push(`/app/${workspaceId}/docs/${doc.id}`);
        } catch {
          toast.error("Couldn't create the sub-page. Please try again.", {
            id: creating,
          });
        }
      })();
    };
    window.addEventListener(SUBPAGE_REQUEST_EVENT, onSubpageRequest);
    return () =>
      window.removeEventListener(SUBPAGE_REQUEST_EVENT, onSubpageRequest);
  }, [editor, readOnly, workspaceId, documentId, saveNow, router]);

  // The "/image" slash command asks the editor to open the file picker.
  useEffect(() => {
    if (readOnly) return;
    const onImageRequest = () => fileInputRef.current?.click();
    window.addEventListener(IMAGE_REQUEST_EVENT, onImageRequest);
    return () => window.removeEventListener(IMAGE_REQUEST_EVENT, onImageRequest);
  }, [readOnly]);

  // Flush pending work on unmount / page hide.
  useEffect(() => {
    if (!editor || readOnly) return;
    const flush = () => {
      if (statusRef.current === "dirty") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        void performSave(editor);
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [editor, performSave, readOnly]);

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    setLinkUrl((editor.getAttributes("link").href as string) ?? "");
    setLinkDialogOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const normalized = /^(https?:\/\/|mailto:)/i.test(url)
        ? url
        : `https://${url}`;
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: normalized })
        .run();
    }
    setLinkDialogOpen(false);
  }, [editor, linkUrl]);

  const uploadImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      const formData = new FormData();
      formData.set("file", file);
      formData.set("workspaceId", workspaceId);
      formData.set("documentId", documentId);
      formData.set("kind", "document-image");
      const uploading = toast.loading("Uploading image…");
      try {
        const res = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          throw new Error(data.error ?? "Upload failed");
        }
        editor.chain().focus().setImage({ src: data.url, alt: file.name }).run();
        toast.success("Image added", { id: uploading });
      } catch (error) {
        toast.error(
          error instanceof Error && error.message.includes("BLOB")
            ? "Image uploads aren't configured for this environment yet."
            : "Couldn't upload that image. Please try again.",
          { id: uploading },
        );
      }
    },
    [editor, workspaceId, documentId],
  );

  if (!editor) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="h-10 w-2/3 animate-pulse rounded-md bg-[var(--muted)]" />
        <div className="h-4 w-full animate-pulse rounded bg-[var(--muted)]" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--muted)]" />
        <div className="h-4 w-4/6 animate-pulse rounded bg-[var(--muted)]" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col">
      {!readOnly && (
        <div className="flex h-5 items-center justify-end">
          <SaveIndicator
            status={status}
            onRetry={() => void performSave(editor)}
          />
        </div>
      )}

      {readOnly ? (
        <h1 className="editor-title mb-2 text-4xl font-bold tracking-tight">
          {title}
        </h1>
      ) : (
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            titleRef.current = event.target.value;
            scheduleSave(editor);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "ArrowDown") {
              event.preventDefault();
              editor.commands.focus("start");
            }
          }}
          aria-label="Document title"
          className="editor-title mb-2 w-full bg-transparent text-4xl font-bold tracking-tight outline-none placeholder:text-[var(--placeholder-faint)]"
          placeholder="New page"
        />
      )}

      {!readOnly && (
        <BubbleMenu
          editor={editor}
          options={{ placement: "top-start", offset: 8 }}
          shouldShow={({ editor: e, state }) => {
            if (state.selection.empty) return false;
            // Only for text selections: skip images and code blocks.
            if (isNodeSelection(state.selection)) return false;
            if (e.isActive("codeBlock")) return false;
            return true;
          }}
          className="flex items-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[0_9px_24px_rgba(15,15,15,0.2)]"
        >
          <TurnIntoDropdown
            editor={editor}
            activeLabel={activeStates?.turnIntoLabel ?? "Text"}
          />
          <BubbleDivider />
          <BubbleButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={activeStates?.bold}
            label="Bold (⌘B)"
          >
            <Bold className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={activeStates?.italic}
            label="Italic (⌘I)"
          >
            <Italic className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={activeStates?.underline}
            label="Underline (⌘U)"
          >
            <Underline className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={activeStates?.strike}
            label="Strikethrough (⌘⇧S)"
          >
            <Strikethrough className="h-4 w-4" />
          </BubbleButton>
          <BubbleButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={activeStates?.code}
            label="Code (⌘E)"
          >
            <Code className="h-4 w-4" />
          </BubbleButton>
          <BubbleDivider />
          <BubbleButton
            onClick={openLinkDialog}
            active={activeStates?.link}
            label="Link (⌘K)"
          >
            <Link2 className="h-4 w-4" />
          </BubbleButton>
        </BubbleMenu>
      )}

      {!readOnly && <BlockHandle editor={editor} />}

      <div className="editor-canvas">
        <EditorContent editor={editor} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadImage(file);
          event.target.value = "";
        }}
      />

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editor.isActive("link") ? "Edit link" : "Add link"}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyLink();
            }}
            className="space-y-3"
          >
            <label className="sr-only" htmlFor="link-url">
              Link URL
            </label>
            <Input
              id="link-url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://example.com"
              autoFocus
            />
            <DialogFooter>
              {editor.isActive("link") && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setLinkUrl("");
                    applyLink();
                  }}
                >
                  Remove link
                </Button>
              )}
              <Button type="submit">Apply</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TurnIntoDropdown({
  editor,
  activeLabel,
}: {
  editor: Editor;
  activeLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Turn into"
          onMouseDown={(event) => event.preventDefault()}
          className="flex h-8 items-center gap-1 px-2.5 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--sidebar-hover)] focus-visible:outline-none"
        >
          {activeLabel}
          <ChevronDown className="h-3 w-3 text-[var(--muted-foreground)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {TURN_INTO_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.label}
            onSelect={() => option.apply(editor)}
          >
            {option.label}
            {option.label === activeLabel && (
              <Check className="ml-auto h-3.5 w-3.5 text-[var(--primary)]" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SaveIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 text-xs font-medium text-[var(--destructive)] hover:underline"
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Save failed — retry
      </button>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]"
    >
      {status === "saving" ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving…
        </>
      ) : status === "dirty" ? (
        "Unsaved changes"
      ) : (
        <>
          <Check className="h-3.5 w-3.5" />
          Saved
        </>
      )}
    </span>
  );
}

function BubbleButton({
  children,
  onClick,
  active,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      // Keep focus (and selection) in the editor while clicking.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center transition-colors focus-visible:outline-none ${
        active
          ? "text-[var(--primary)]"
          : "text-[var(--foreground)] hover:bg-[var(--sidebar-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

function BubbleDivider() {
  return <span aria-hidden className="h-5 w-px bg-[var(--border)]" />;
}

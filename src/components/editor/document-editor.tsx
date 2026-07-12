"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
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
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo,
  Undo,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mutable save-machine state (only touched from handlers/effects).
  const titleRef = useRef(initialTitle);
  const statusRef = useRef<SaveStatus>("saved");
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
      }),
      Placeholder.configure({
        placeholder: "Start writing — try headings, lists, code, or / images…",
      }),
      Image.configure({ allowBase64: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral max-w-none min-h-[50vh] focus:outline-none px-1",
        "aria-label": "Document content",
      },
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
        contentJson: currentEditor.getJSON() as Record<string, unknown>,
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
    <div className="flex flex-col gap-4">
      {!readOnly && (
        <div
          role="toolbar"
          aria-label="Formatting"
          className="sticky top-[57px] z-[5] -mx-1 flex flex-wrap items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-1.5 py-1 shadow-sm"
        >
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive("heading", { level: 1 })}
            label="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive("heading", { level: 2 })}
            label="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive("heading", { level: 3 })}
            label="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            label="Bold (⌘B)"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            label="Italic (⌘I)"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={openLinkDialog}
            active={editor.isActive("link")}
            label="Link"
          >
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            label="Bullet list (⌘⇧8)"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            label="Numbered list (⌘⇧7)"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            active={editor.isActive("taskList")}
            label="Task list (⌘⇧9)"
          >
            <CheckSquare className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive("codeBlock")}
            label="Code block (⌘⌥C)"
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            label="Quote"
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => fileInputRef.current?.click()}
            label="Insert image"
          >
            <ImagePlus className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            label="Undo (⌘Z)"
            disabled={!editor.can().undo()}
          >
            <Undo className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            label="Redo (⌘⇧Z)"
            disabled={!editor.can().redo()}
          >
            <Redo className="h-4 w-4" />
          </ToolbarButton>

          <div className="ml-auto pr-1">
            <SaveIndicator
              status={status}
              onRetry={() => void performSave(editor)}
            />
          </div>
        </div>
      )}

      {readOnly ? (
        <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight">
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
            if (event.key === "Enter") {
              event.preventDefault();
              editor.commands.focus("start");
            }
          }}
          aria-label="Document title"
          className="w-full bg-transparent font-[family-name:var(--font-display)] text-4xl tracking-tight outline-none placeholder:text-[var(--muted-foreground)]"
          placeholder="Untitled"
        />
      )}

      <EditorContent editor={editor} />

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
          <Check className="h-3.5 w-3.5 text-[var(--primary)]" />
          Saved
        </>
      )}
    </span>
  );
}

function ToolbarButton({
  children,
  onClick,
  active,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          // Keep focus (and selection) in the editor while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          disabled={disabled}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-40 ${
            active
              ? "bg-[var(--muted)] text-[var(--foreground)]"
              : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-[var(--border)]" />;
}

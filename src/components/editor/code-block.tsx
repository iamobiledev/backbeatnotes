"use client";

import { useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Check, ChevronDown, Copy } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { blockDomId, isValidBlockId } from "@/lib/documents/blocks";

const lowlight = createLowlight(common);

/** Display names for the language picker (ids must be lowlight grammars). */
const LANGUAGES: Array<{ id: string | null; label: string }> = [
  { id: null, label: "Plain text" },
  { id: "bash", label: "Bash" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "css", label: "CSS" },
  { id: "diff", label: "Diff" },
  { id: "go", label: "Go" },
  { id: "graphql", label: "GraphQL" },
  { id: "ini", label: "INI" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "kotlin", label: "Kotlin" },
  { id: "lua", label: "Lua" },
  { id: "makefile", label: "Makefile" },
  { id: "markdown", label: "Markdown" },
  { id: "objectivec", label: "Objective-C" },
  { id: "perl", label: "Perl" },
  { id: "php", label: "PHP" },
  { id: "plaintext", label: "Plain text" },
  { id: "python", label: "Python" },
  { id: "r", label: "R" },
  { id: "ruby", label: "Ruby" },
  { id: "rust", label: "Rust" },
  { id: "scss", label: "SCSS" },
  { id: "shell", label: "Shell" },
  { id: "sql", label: "SQL" },
  { id: "swift", label: "Swift" },
  { id: "typescript", label: "TypeScript" },
  { id: "xml", label: "HTML / XML" },
  { id: "yaml", label: "YAML" },
];

function languageLabel(id: string | null): string {
  return (
    LANGUAGES.find((language) => language.id === id)?.label ?? id ?? "Plain text"
  );
}

/**
 * Notion-style code block: gray canvas, hover-reveal language picker and
 * copy button, lowlight (highlight.js) syntax colors.
 */
export const NotionCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Notion indents with Tab inside code instead of leaving the block.
      Tab: () => {
        if (!this.editor.isActive(this.name)) return false;
        return this.editor.commands.insertContent("  ");
      },
    };
  },
}).configure({
  lowlight,
  defaultLanguage: null,
});

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  const blockId = node.attrs.blockId as unknown;
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    const text = node.textContent;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Async clipboard can be blocked by permissions — fall back to the
      // legacy execCommand path, which only needs a user gesture.
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      ok = document.execCommand("copy");
      textarea.remove();
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <NodeViewWrapper
      className="code-block group/code relative my-1"
      {...(isValidBlockId(blockId)
        ? { id: blockDomId(blockId), "data-block-id": blockId }
        : {})}
    >
      <div
        contentEditable={false}
        className="pointer-events-none absolute inset-x-2 top-1.5 z-[1] flex items-center justify-between opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 group-focus-within/code:opacity-100"
      >
        {editor.isEditable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Code language"
                className="pointer-events-auto flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--hover-strong)] focus-visible:outline-none"
              >
                {languageLabel(language)}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-72 w-44 overflow-y-auto"
            >
              {LANGUAGES.filter((entry) => entry.id !== "plaintext").map(
                (entry) => (
                  <DropdownMenuItem
                    key={entry.label}
                    onSelect={() => updateAttributes({ language: entry.id })}
                  >
                    {entry.label}
                    {(entry.id === language ||
                      (entry.id === null && language === null)) && (
                      <Check className="ml-auto h-3.5 w-3.5 text-[var(--primary)]" />
                    )}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="px-1.5 py-0.5 text-xs text-[var(--muted-foreground)]">
            {languageLabel(language)}
          </span>
        )}

        <button
          type="button"
          aria-label="Copy code"
          onClick={() => void copyCode()}
          className="pointer-events-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--hover-strong)] focus-visible:outline-none"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[var(--primary)]" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>

      <pre>
        <NodeViewContent<"code"> as="code" spellCheck={false} />
      </pre>
    </NodeViewWrapper>
  );
}

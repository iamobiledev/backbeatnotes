"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const SHORTCUTS: Array<{ keys: string[]; description: string }> = [
  { keys: ["/"], description: "Open the block menu while writing" },
  { keys: ["⌘/Ctrl", "K"], description: "Search everything" },
  { keys: ["N"], description: "New page (outside a text field)" },
  { keys: ["⌘/Ctrl", "S"], description: "Save now (autosave is always on)" },
  { keys: ["⌘/Ctrl", "B"], description: "Bold selection" },
  { keys: ["⌘/Ctrl", "I"], description: "Italic selection" },
  { keys: ["⌘/Ctrl", "U"], description: "Underline selection" },
  { keys: ["⌘/Ctrl", "E"], description: "Inline code" },
  { keys: ["⌘/Ctrl", "Shift", "8"], description: "Bullet list" },
  { keys: ["⌘/Ctrl", "Shift", "7"], description: "Numbered list" },
  { keys: ["⌘/Ctrl", "Shift", "9"], description: "Task list" },
  { keys: ["⌘/Ctrl", "Alt", "C"], description: "Code block" },
  { keys: ["?"], description: "Show this list" },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Work faster without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.description}
              className="flex items-center justify-between gap-4 text-sm"
            >
              <span>{shortcut.description}</span>
              <span className="flex shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-[var(--border)] bg-[var(--muted)] px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

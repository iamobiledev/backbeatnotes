"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { actionRestoreDocument } from "@/app/actions";

type TrashItem = {
  id: string;
  title: string;
  icon: string | null;
  archivedAt: string | null;
};

export function TrashList({
  workspaceId,
  items,
  canRestore,
}: {
  workspaceId: string;
  items: TrashItem[];
  canRestore: boolean;
}) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <div className="mt-12 flex flex-col items-center rounded-lg border border-dashed border-[var(--border)] py-16 text-center">
        <Trash2 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <p className="mt-3 font-medium">Trash is empty</p>
        <p className="mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">
          Pages you move to the trash will show up here, ready to be restored
          whenever you need them.
        </p>
      </div>
    );
  }

  const restore = (id: string) => {
    setRestoringId(id);
    startTransition(async () => {
      const result = await actionRestoreDocument({ documentId: id });
      setRestoringId(null);
      if (result.ok) {
        toast.success("Page restored");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <ul className="mt-6 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--card)]">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-3">
          {item.icon ? (
            <span className="text-base leading-none">{item.icon}</span>
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          )}
          <span className="min-w-0 flex-1">
            <Link
              href={`/app/${workspaceId}/docs/${item.id}`}
              className="block truncate text-sm font-medium hover:text-[var(--primary)]"
            >
              {item.title || "Untitled"}
            </Link>
            {item.archivedAt && (
              <span className="block text-xs text-[var(--muted-foreground)]">
                Trashed{" "}
                {formatDistanceToNow(new Date(item.archivedAt), {
                  addSuffix: true,
                })}
              </span>
            )}
          </span>
          {canRestore && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => restore(item.id)}
              disabled={restoringId === item.id}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {restoringId === item.id ? "Restoring…" : "Restore"}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

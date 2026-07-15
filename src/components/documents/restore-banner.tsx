"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actionRestoreDocument } from "@/app/actions";

export function RestoreBanner({
  documentId,
  workspaceId,
}: {
  documentId: string;
  workspaceId: string;
}) {
  const [pending, startTransition] = useTransition();

  const restore = () => {
    startTransition(async () => {
      const result = await actionRestoreDocument({ documentId });
      if (result.ok) {
        toast.success("Page restored");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Link
        href={`/app/${workspaceId}/trash`}
        className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to trash
      </Link>
      <Button size="sm" onClick={restore} disabled={pending} className="gap-1.5">
        <RotateCcw className="h-3.5 w-3.5" />
        {pending ? "Restoring…" : "Restore page"}
      </Button>
    </div>
  );
}

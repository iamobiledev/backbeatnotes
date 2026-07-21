"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { actionCreateDocument } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function CreateDocumentButton({
  workspaceId,
  workspaceSlug,
  docType = "doc",
  label,
  variant = "default",
  className,
}: {
  workspaceId: string;
  workspaceSlug: string;
  docType?: "doc" | "wiki";
  label: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={pending}
      onClick={() => {
        if (pending) return;
        startTransition(async () => {
          const formData = new FormData();
          formData.set("workspaceId", workspaceId);
          formData.set("title", "Untitled");
          formData.set("docType", docType);
          const result = await actionCreateDocument(formData);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.push(
            `/app/${workspaceSlug}/docs/${result.data.id}`,
          );
          router.refresh();
        });
      }}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : docType === "wiki" ? (
        <BookOpen className="h-4 w-4" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      {pending ? "Creating…" : label}
    </Button>
  );
}

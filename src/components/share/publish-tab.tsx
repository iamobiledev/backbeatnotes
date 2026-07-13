"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionPublishDocument } from "@/app/actions";

/**
 * Notion-style Publish tab: publish a read-only public version of the page
 * at /p/[slug]. Independent of in-app sharing (a page can be invite-only
 * and still be published).
 */
export function PublishTab({
  doc,
}: {
  doc: { id: string; title: string; published: boolean; publicSlug: string | null };
}) {
  const router = useRouter();
  const [published, setPublished] = useState(doc.published);
  const [publicSlug, setPublicSlug] = useState(doc.publicSlug);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = publicSlug ? `${origin}/p/${publicSlug}` : null;

  const setPublish = (publish: boolean) => {
    startTransition(async () => {
      const result = await actionPublishDocument({
        documentId: doc.id,
        publish,
      });
      if (result.ok) {
        setPublished(publish);
        setPublicSlug(result.data.publicSlug);
        toast.success(
          publish
            ? "Published — anyone with the link can view"
            : "Unpublished — the public link no longer works",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const copy = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("Public link copied");
  };

  if (!published) {
    return (
      <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--muted)]">
          <Globe className="h-6 w-6 text-[var(--muted-foreground)]" />
        </span>
        <h3 className="mt-3 text-sm font-medium">Publish to web</h3>
        <p className="mt-1 max-w-[260px] text-xs text-[var(--muted-foreground)]">
          Create a read-only website from this page. Anyone with the link can
          view it — no account needed.
        </p>
        <Button
          className="mt-4 w-full"
          onClick={() => setPublish(true)}
          disabled={pending}
        >
          {pending ? "Publishing…" : "Publish"}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-3 pb-3 pt-3">
      <p className="flex items-center gap-1.5 px-0.5 text-xs text-[var(--muted-foreground)]">
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        This page is live on the web. Anyone with the link can view it.
      </p>

      {publicUrl && (
        <div className="mt-2.5 flex items-center gap-2">
          <Input
            readOnly
            value={publicUrl}
            aria-label="Public link"
            className="h-9 flex-1 text-xs"
            onFocus={(event) => event.target.select()}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void copy()}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            Copy
          </Button>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
        <Button
          variant="outline"
          size="sm"
          className="h-8 flex-1 gap-1.5 text-xs"
          asChild
        >
          <a href={publicUrl ?? "#"} target="_blank" rel="noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
            View site
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 flex-1 text-xs text-[var(--destructive)] hover:text-[var(--destructive)]"
          onClick={() => setPublish(false)}
          disabled={pending}
        >
          {pending ? "…" : "Unpublish"}
        </Button>
      </div>
    </div>
  );
}

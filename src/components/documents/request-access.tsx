"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Lock, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actionRequestAccess } from "@/app/actions";

/**
 * Shown when someone opens a document link they can't access.
 * Never leaks the document's title or content.
 */
export function RequestAccess({ documentId }: { documentId: string }) {
  const [requested, setRequested] = useState(false);
  const [pending, startTransition] = useTransition();

  const request = () => {
    startTransition(async () => {
      const result = await actionRequestAccess({ documentId });
      if (result.ok) {
        setRequested(true);
        toast.success("Request sent");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--muted)]">
        {requested ? (
          <MailCheck className="h-6 w-6 text-[var(--primary)]" />
        ) : (
          <Lock className="h-6 w-6 text-[var(--muted-foreground)]" />
        )}
      </span>
      <h1 className="mt-5 font-[family-name:var(--font-display)] text-2xl font-semibold">
        {requested ? "Request sent" : "You need access"}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {requested
          ? "The workspace admins have been notified by email. You'll get an invitation if they approve."
          : "This page belongs to a workspace you're not a member of. Request access, and the workspace admins will be notified."}
      </p>
      <div className="mt-6 flex gap-2">
        {!requested && (
          <Button onClick={request} disabled={pending}>
            {pending ? "Sending…" : "Request access"}
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/app">Back to your workspaces</Link>
        </Button>
      </div>
    </div>
  );
}

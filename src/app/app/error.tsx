"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--muted)]">
        <AlertTriangle className="h-6 w-6 text-[var(--destructive)]" />
      </span>
      <h1 className="mt-5 font-[family-name:var(--font-display)] text-2xl font-semibold">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        That wasn’t supposed to happen. Try again — if it keeps happening, let
        your workspace admin know.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/app">Back to workspaces</Link>
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actionSetWorkspaceAutoJoinDomain } from "@/app/actions";

/**
 * Workspace "Domain access" — owners/admins set a company email domain so
 * every verified user at that domain automatically joins as an Editor.
 */
export function DomainAccessSection({
  workspaceId,
  autoJoinDomain,
  canEdit,
}: {
  workspaceId: string;
  autoJoinDomain: string | null;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(autoJoinDomain ?? "");
  const [saved, setSaved] = useState(autoJoinDomain ?? "");
  const [pending, startTransition] = useTransition();

  if (!canEdit) return null;

  const submit = (domain: string | null) => {
    startTransition(async () => {
      const result = await actionSetWorkspaceAutoJoinDomain({
        workspaceId,
        domain,
      });
      if (result.ok) {
        const next = domain ?? "";
        setSaved(next);
        setValue(next);
        toast.success(
          domain
            ? `Domain access enabled for @${domain}`
            : "Domain access turned off",
        );
      } else {
        toast.error(result.error);
      }
    });
  };

  const trimmed = value.trim().toLowerCase().replace(/^@+/, "");

  return (
    <section aria-labelledby="domain-access-heading">
      <h2
        id="domain-access-heading"
        className="flex items-center gap-2 text-lg font-medium"
      >
        <Globe className="h-4 w-4 text-[var(--primary)]" />
        Domain access
      </h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Anyone who signs in with a verified email at this domain automatically
        joins this workspace as an Editor. You can only enable the domain of
        your own verified email, and each domain can be claimed by one
        workspace. Adjust each person&apos;s role in Members below.
      </p>
      <form
        className="mt-3 flex max-w-md gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed || trimmed === saved) return;
          submit(trimmed);
        }}
      >
        <Label htmlFor="auto-join-domain" className="sr-only">
          Allowed email domain
        </Label>
        <div className="relative flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-[var(--muted-foreground)]"
          >
            @
          </span>
          <Input
            id="auto-join-domain"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="yourcompany.com"
            maxLength={253}
            className="pl-8"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={pending || !trimmed || trimmed === saved}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => submit(null)}
          >
            Turn off
          </Button>
        )}
      </form>
      {saved ? (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Everyone <span className="font-medium">@{saved}</span> joins
          automatically as an Editor when they sign in — including people you
          previously removed. Turn domain access off before removing someone
          with a matching email.
        </p>
      ) : (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Domain access is off — people join by invitation only.
        </p>
      )}
    </section>
  );
}

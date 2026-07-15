"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actionRenameWorkspace } from "@/app/actions";

export function WorkspaceNameSection({
  workspaceId,
  name,
  canEdit,
}: {
  workspaceId: string;
  name: string;
  canEdit: boolean;
}) {
  const [value, setValue] = useState(name);
  const [pending, startTransition] = useTransition();

  if (!canEdit) return null;

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) return;
    startTransition(async () => {
      const result = await actionRenameWorkspace({
        workspaceId,
        name: trimmed,
      });
      if (result.ok) {
        toast.success("Workspace renamed");
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <section aria-labelledby="workspace-name-heading">
      <h2 id="workspace-name-heading" className="text-lg font-medium">
        Workspace name
      </h2>
      <form
        className="mt-3 flex max-w-md gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Label htmlFor="workspace-name" className="sr-only">
          Workspace name
        </Label>
        <Input
          id="workspace-name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={100}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={pending || !value.trim() || value.trim() === name}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </section>
  );
}

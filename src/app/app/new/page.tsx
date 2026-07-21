import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { requireVerifiedSession, platformRoleOf } from "@/lib/session";
import { actionCreateWorkspace } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brand } from "@/config/brand";
import { workspacePath } from "@/lib/workspaces/paths";

export default async function NewWorkspacePage() {
  const session = await requireVerifiedSession();

  if (platformRoleOf(session.user) !== "admin") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--muted)]">
          <ShieldAlert className="h-6 w-6 text-[var(--muted-foreground)]" />
        </span>
        <h1 className="mt-5 font-[family-name:var(--font-display)] text-2xl font-semibold">
          Admins only
        </h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Only platform admins can create shared workspaces. Ask an admin to
          create one and invite you — your personal notebook is always
          available for private notes.
        </p>
        <Button variant="outline" asChild className="mt-6">
          <Link href="/app">Back to your workspaces</Link>
        </Button>
      </div>
    );
  }

  async function create(formData: FormData) {
    "use server";
    const workspace = await actionCreateWorkspace(formData);
    redirect(workspacePath(workspace));
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
        New workspace
      </h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        A shared home for your team&apos;s knowledge in {brand.name}. Everyone
        you invite can see every page inside it.
      </p>
      <form action={create} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Workspace name</Label>
          <Input
            id="name"
            name="name"
            required
            placeholder={brand.defaultWorkspaceName}
          />
        </div>
        <Button type="submit">Create</Button>
      </form>
    </div>
  );
}

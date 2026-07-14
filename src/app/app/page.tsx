import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BookLock, Plus, Users } from "lucide-react";
import { requireVerifiedSession, platformRoleOf } from "@/lib/session";
import { listUserWorkspaces } from "@/lib/documents/service";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";

export default async function AppHomePage() {
  const session = await requireVerifiedSession();
  const workspaces = await listUserWorkspaces(session.user.id);

  // Straight into the only workspace (usually the personal notebook).
  if (workspaces.length === 1) {
    redirect(`/app/${workspaces[0].id}`);
  }

  const personal = workspaces.filter((w) => w.isPersonal);
  const shared = workspaces.filter((w) => !w.isPersonal);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
        Welcome back, {session.user.name.split(" ")[0]}
      </h1>
      <p className="mt-2 text-[var(--muted-foreground)]">{brand.tagline}</p>

      {personal.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)]">
            <BookLock className="h-3.5 w-3.5" />
            Private
          </h2>
          <ul className="mt-3 space-y-2">
            {personal.map((ws) => (
              <li key={ws.id}>
                <Link
                  href={`/app/${ws.id}`}
                  className="block rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3 transition-colors hover:border-[var(--primary)]"
                >
                  <span className="font-medium">{ws.name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                    Only you can see these pages
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-[var(--muted-foreground)]">
          <Users className="h-3.5 w-3.5" />
          Workspaces
        </h2>
        {shared.length === 0 ? (
          <p className="mt-3 rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
            No shared workspaces yet — create one to collaborate with your
            team.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shared.map((ws) => (
              <li key={ws.id}>
                <Link
                  href={`/app/${ws.id}`}
                  className="block rounded-md border border-[var(--border)] bg-[var(--card)] px-4 py-3 transition-colors hover:border-[var(--primary)]"
                >
                  <span className="font-medium">{ws.name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                    {ws.role === "owner"
                      ? "Owner"
                      : ws.role === "admin"
                        ? "Admin"
                        : ws.role === "member"
                          ? "Editor"
                          : "Viewer"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8 flex items-center gap-3">
        {platformRoleOf(session.user) === "admin" && (
          <Button asChild className="gap-1.5">
            <Link href="/app/new">
              <Plus className="h-4 w-4" />
              New workspace
            </Link>
          </Button>
        )}
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Home
        </Link>
      </div>
    </div>
  );
}

import { Suspense } from "react";
import { Toaster } from "sonner";
import { requireVerifiedSession } from "@/lib/session";
import { getOrCreatePersonalWorkspace } from "@/lib/workspaces/service";
import { Skeleton } from "@/components/ui/skeleton";

// Authentication is intentionally request-bound. Child routes can still
// validate instant sibling navigations below this boundary.
export const unstable_instant = false;

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense fallback={<AppBootstrapLoading />}>
        <AuthenticatedApp>{children}</AuthenticatedApp>
      </Suspense>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
          },
        }}
      />
    </>
  );
}

async function AuthenticatedApp({ children }: { children: React.ReactNode }) {
  const session = await requireVerifiedSession();
  // Every user gets a personal notebook, provisioned lazily.
  await getOrCreatePersonalWorkspace(session.user.id);

  return <>{children}</>;
}

function AppBootstrapLoading() {
  return (
    <div
      className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-6 py-16"
      aria-busy
      aria-label="Loading application"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="mt-8 h-24 w-full" />
    </div>
  );
}

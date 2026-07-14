import { requireVerifiedSession } from "@/lib/session";
import { getOrCreatePersonalWorkspace } from "@/lib/workspaces/service";

/** Auth + DB backed — never statically prerender at build time. */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireVerifiedSession();
  // Every user gets a personal notebook, provisioned lazily.
  await getOrCreatePersonalWorkspace(session.user.id);

  return <>{children}</>;
}

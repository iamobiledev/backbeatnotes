import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

export type PlatformRole = "admin" | "developer";

/** Platform user type from the session (admin | developer). */
export function platformRoleOf(sessionUser: unknown): PlatformRole {
  const role = (sessionUser as { role?: string } | null)?.role;
  return role === "admin" ? "admin" : "developer";
}

export async function getSession() {
  // Read request data before constructing Better Auth. Better Auth initializes
  // internal random IDs, which Cache Components must never execute during
  // prerender before the request boundary is established.
  const requestHeaders = await headers();
  const auth = getAuth();
  return auth.api.getSession({
    headers: requestHeaders,
  });
}

export async function requireSession() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/sign-in");
  }
  return session;
}

export async function requireVerifiedSession() {
  const session = await requireSession();
  if (!session.user.emailVerified) {
    redirect("/verify-email");
  }
  return session;
}

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
  const auth = getAuth();
  return auth.api.getSession({
    headers: await headers(),
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

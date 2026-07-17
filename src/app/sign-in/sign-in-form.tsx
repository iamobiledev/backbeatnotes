"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import {
  AuthDivider,
  GoogleSignInButton,
} from "@/components/auth/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("error");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <AuthShell title="Welcome back">
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Sign in to continue to your workspace.
      </p>

      {oauthError && (
        <p
          className="mt-6 rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-3 py-2 text-sm text-[var(--destructive)]"
          role="alert"
        >
          We couldn&apos;t sign you in with that Google account. Use your work
          Google account, or sign in with email below.
        </p>
      )}

      {googleEnabled && (
        <div className="mt-8 space-y-4">
          <GoogleSignInButton />
          <AuthDivider />
        </div>
      )}

      <form
        className={googleEnabled ? "mt-4 space-y-4" : "mt-8 space-y-4"}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const email = String(form.get("email") ?? "");
          const password = String(form.get("password") ?? "");
          setError(null);
          startTransition(async () => {
            const result = await signIn.email({ email, password });
            if (result.error) {
              setError(result.error.message ?? "Sign in failed");
              return;
            }
            // Hard navigate so post-auth soft push+refresh cannot leave long
            // tasks on the main thread that inflate INP on the next click
            // (workspace / Recent card subtitles).
            window.location.assign("/app");
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {error && (
          <p className="text-sm text-[var(--destructive)]" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-[var(--muted-foreground)]">
        <Link href="/forgot-password" className="underline">
          Forgot password?
        </Link>
      </p>
    </AuthShell>
  );
}

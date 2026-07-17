"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { brand } from "@/config/brand";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <Link
        href="/"
        aria-label={`${brand.name} home`}
        className="mb-8 w-fit"
      >
        <BrandLogo
          markClassName="h-9 w-9"
          wordmarkClassName="text-2xl"
        />
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Sign in to continue to your workspace.
      </p>

      <form
        className="mt-8 space-y-4"
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
    </main>
  );
}

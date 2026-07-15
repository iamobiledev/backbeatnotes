"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { brand } from "@/config/brand";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {brand.tagline}
      </p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const name = String(form.get("name") ?? "");
          const email = String(form.get("email") ?? "");
          const password = String(form.get("password") ?? "");
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await signUp.email({ name, email, password });
            if (result.error) {
              setError(result.error.message ?? "Sign up failed");
              return;
            }
            setMessage(
              "Check your email to verify your account, then sign in.",
            );
            router.push("/verify-email");
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
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
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {error && (
          <p className="text-sm text-[var(--destructive)]" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="text-sm text-[var(--primary)]" role="status">
            {message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-[var(--muted-foreground)]">
        Already have an account?{" "}
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}

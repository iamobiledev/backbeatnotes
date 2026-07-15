"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { brand } from "@/config/brand";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        We&apos;ll email you a reset link.
      </p>
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const email = String(new FormData(e.currentTarget).get("email") ?? "");
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await requestPasswordReset({
              email,
              redirectTo: "/reset-password",
            });
            if (result.error) {
              setError(result.error.message ?? "Request failed");
              return;
            }
            setMessage("If that email exists, a reset link is on the way.");
          });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}
        {message && <p className="text-sm text-[var(--primary)]">{message}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </main>
  );
}

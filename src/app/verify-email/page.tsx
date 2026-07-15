import Link from "next/link";
import { brand } from "@/config/brand";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";

export default function VerifyEmailPage() {
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
      <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
      <p className="mt-3 text-[var(--muted-foreground)]">
        We sent a verification link. Open it to activate your account, then sign
        in.
      </p>
      <Button asChild className="mt-8">
        <Link href="/sign-in">Back to sign in</Link>
      </Button>
    </main>
  );
}

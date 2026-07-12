import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { brand } from "@/config/brand";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4 animate-fade">
        <div className="text-lg font-bold tracking-tight">{brand.logoText}</div>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Get {brand.name} free</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 pb-32 pt-10 text-center">
        <h1 className="animate-rise text-5xl font-bold leading-[1.1] tracking-tight md:text-6xl">
          Your docs, wikis,
          <br />
          and knowledge. Together.
        </h1>
        <p className="animate-rise animate-delay-1 mt-6 max-w-xl text-lg text-[var(--muted-foreground)] md:text-xl">
          {brand.tagline} Capture decisions, share playbooks, and find answers
          across your workspace.
        </p>
        <div className="animate-rise animate-delay-2 mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="gap-1.5">
            <Link href="/sign-up">
              Get {brand.name} free
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/sign-in">Log in</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

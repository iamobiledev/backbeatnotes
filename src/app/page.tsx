import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/config/brand";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: brand.name,
  alternateName: brand.shortName,
  url: brand.siteUrl,
  description: brand.description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
};

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4 animate-fade">
        <Link href="/" aria-label={`${brand.name} home`}>
          <BrandLogo
            markClassName="h-8 w-8"
            wordmarkClassName="text-lg"
          />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Log in</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 pb-32 pt-10 text-center">
        <h1 className="animate-rise text-5xl font-bold leading-[1.1] tracking-tight md:text-6xl">
          Your docs, wikis,
          <br />
          and knowledge. In sync.
        </h1>
        <p className="animate-rise animate-delay-1 mt-6 max-w-xl text-lg text-[var(--muted-foreground)] md:text-xl">
          {brand.tagline} Capture decisions, share playbooks, and find answers
          across your workspace.
        </p>
        <div className="animate-rise animate-delay-2 mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/sign-in">Log in</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

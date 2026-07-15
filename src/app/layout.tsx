import type { Metadata } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { brand } from "@/config/brand";
import { ThemeProvider, ThemeScript } from "@/components/theme/theme";
import "./globals.css";

// Notion-style UI: one clean sans family for both headings and body.
const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: brand.title,
    template: `%s · ${brand.name}`,
  },
  description: brand.description,
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  openGraph: {
    title: brand.name,
    description: brand.tagline,
    siteName: brand.name,
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isVercelDeployment = Boolean(
    process.env.VERCEL || process.env.NEXT_PUBLIC_VERCEL_ENV,
  );

  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <Suspense fallback={<RootLoading />}>{children}</Suspense>
        </ThemeProvider>
        {isVercelDeployment && (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        )}
      </body>
    </html>
  );
}

function RootLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center text-sm text-[var(--muted-foreground)]"
      aria-busy
      aria-label="Loading page"
    >
      Loading…
    </div>
  );
}

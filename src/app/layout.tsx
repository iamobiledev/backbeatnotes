import type { Metadata, Viewport } from "next";
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
  applicationName: brand.name,
  title: {
    default: brand.title,
    template: `%s | ${brand.name}`,
  },
  description: brand.description,
  keywords: [...brand.keywords],
  metadataBase: new URL(brand.siteUrl),
  referrer: "origin-when-cross-origin",
  creator: brand.name,
  publisher: brand.name,
  category: "productivity",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: brand.socialTitle,
    description: brand.description,
    url: "/",
    siteName: brand.name,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: brand.socialTitle,
    description: brand.description,
  },
  robots: {
    index: false,
    follow: false,
  },
  appleWebApp: {
    capable: true,
    title: brand.shortName,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brand.themeColor },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
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

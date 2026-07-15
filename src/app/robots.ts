import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/p/"],
      disallow: [
        "/api/",
        "/app/",
        "/invitations/",
        "/sign-in",
        "/sign-up",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
      ],
    },
    sitemap: `${brand.siteUrl}/sitemap.xml`,
    host: brand.siteUrl,
  };
}

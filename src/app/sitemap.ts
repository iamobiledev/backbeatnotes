import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: brand.siteUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

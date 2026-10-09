import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configuredUrl) return [];
  return [{ url: new URL("/", configuredUrl).toString(), changeFrequency: "weekly", priority: 1 }];
}

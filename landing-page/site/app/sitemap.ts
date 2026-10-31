import type { MetadataRoute } from "next";

// Keep the sitemap generated at request time instead of serving an older
// prerendered XML after adding or removing indexed routes.
export const dynamic = "force-dynamic";

const DEFAULT_SITE_URL = "https://basicdietksa.com";

export function getSitemapOrigin() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  try {
    const url = new URL(raw || DEFAULT_SITE_URL);
    if (url.protocol !== "https:") return DEFAULT_SITE_URL;
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSitemapOrigin();
  return [
    { url: origin + "/", lastModified: new Date("2026-10-31"), changeFrequency: "weekly", priority: 1 },
    { url: origin + "/jeddah/healthy-meals", lastModified: new Date("2026-10-31"), changeFrequency: "monthly", priority: 0.9 },
    { url: origin + "/jeddah/subscription-prices", lastModified: new Date("2026-10-31"), changeFrequency: "weekly", priority: 0.9 },
    ...(process.env.NEXT_PUBLIC_MENU_PREVIEW_MODE === "true" ? [] : [{ url: origin + "/menu", lastModified: new Date("2026-10-28"), changeFrequency: "weekly" as const, priority: 0.9 }]),
  ];
}

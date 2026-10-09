import type { MetadataRoute } from "next";

const DEFAULT_SITE_URL = "https://basicdiet-landing-production.up.railway.app";

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
    { url: origin + "/", changeFrequency: "weekly", priority: 1 },
    { url: origin + "/jeddah/healthy-meals", changeFrequency: "monthly", priority: 0.9 },
  ];
}

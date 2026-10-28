import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawOption = {
  id?: string; key?: string; name?: string; imageUrl?: string;
  priceHalala?: number; isPremium?: boolean; available?: boolean; type?: string;
};
type RawSection = {
  id?: string; key?: string; title?: string;
  selectionType?: string; items?: RawOption[];
};

const safeText = (value: unknown, max = 100) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function GET() {
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  if (!backend || !/^https:\/\//.test(backend)) {
    return NextResponse.json({ status: false, data: [], code: "SOURCE_NOT_CONFIGURED" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    const upstream = await fetch(backend + "/api/subscriptions/meal-builder", {
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8500),
      headers: { "accept": "application/json", "accept-language": "ar" },
    });
    if (!upstream.ok) throw new Error("APP_CATALOG_UNAVAILABLE");
    const body = await upstream.json() as { status?: boolean; data?: { sections?: RawSection[]; revisionHash?: string } };
    if (body.status !== true || !Array.isArray(body.data?.sections)) throw new Error("APP_CATALOG_INVALID");
    const sections = body.data.sections
      .slice(0, 40)
      .map((section, index) => ({
        id: safeText(section.id) || String(index),
        key: safeText(section.key),
        title: safeText(section.title, 70),
        selectionType: safeText(section.selectionType),
        items: (Array.isArray(section.items) ? section.items : [])
          .filter(item => item && item.available !== false && Boolean(safeText(item.name)))
          .slice(0, 250)
          .map(item => ({
            id: safeText(item.id),
            key: safeText(item.key),
            name: safeText(item.name, 110),
            image: typeof item.imageUrl === "string" && /^https:\/\/res\.cloudinary\.com\/da8tyika6\//.test(item.imageUrl)
              ? item.imageUrl.slice(0, 500) : "",
            extraPriceHalala: Number.isSafeInteger(item.priceHalala) && (item.priceHalala ?? 0) > 0
              ? item.priceHalala : 0,
            isPremium: item.isPremium === true,
            type: item.type === "product" ? "product" : "option",
          })),
      }))
      .filter(section => section.items.length > 0 && section.title);
    if (!sections.length) throw new Error("APP_CATALOG_EMPTY");
    return NextResponse.json({
      status: true, source: "published_subscription_meal_builder",
      revision: safeText(body.data?.revisionHash), data: sections,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ status: false, data: [], code: "SOURCE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}

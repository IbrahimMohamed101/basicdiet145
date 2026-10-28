import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawOption = {
  id?: string; key?: string; name?: string; imageUrl?: string;
  priceHalala?: number; extraPriceHalala?: number; extraFeeHalala?: number;
  isPremium?: boolean; available?: boolean; type?: string;
};
type RawGroup = { id?: string; key?: string; name?: string; options?: RawOption[] };
type RawProduct = RawOption & { optionGroups?: RawGroup[] };
type RawSection = {
  id?: string; key?: string; title?: string; name?: string;
  selectionType?: string; items?: RawOption[]; products?: RawProduct[];
};
type PublicResponse = { status?: boolean; data?: {
  sections?: RawSection[]; revisionHash?: string;
  builderCatalog?: { sections?: RawSection[]; proteins?: RawOption[]; carbs?: RawOption[]; sandwiches?: RawOption[] };
  plannerCatalog?: { sections?: RawSection[] };
} };
const safeText = (value: unknown, max = 100) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function publicRead(backend: string, path: string): Promise<PublicResponse> {
  const upstream = await fetch(backend + path, {
    cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(8500),
    headers: { accept: "application/json", "accept-language": "ar" },
  });
  if (!upstream.ok) throw new Error(path + "_UNAVAILABLE");
  return upstream.json() as Promise<PublicResponse>;
}

function sanitizedSection(section: RawSection, index: number) {
  const items = (Array.isArray(section.items) ? section.items : [])
    .filter(item => item && item.available !== false && Boolean(safeText(item.name)))
    .slice(0, 250)
    .map(item => {
      const fee = item.type === "product" ? item.priceHalala : item.extraPriceHalala ?? item.extraFeeHalala ?? item.priceHalala;
      return {
        id: safeText(item.id), key: safeText(item.key), name: safeText(item.name, 110),
        image: typeof item.imageUrl === "string" && /^https:\/\/res\.cloudinary\.com\/da8tyika6\//.test(item.imageUrl)
          ? item.imageUrl.slice(0, 500) : "",
        extraPriceHalala: Number.isSafeInteger(fee) && (fee ?? 0) > 0 ? fee : 0,
        isPremium: item.isPremium === true, type: item.type === "product" ? "product" : "option",
      };
    });
  return {
    id: safeText(section.id) || String(index), key: safeText(section.key),
    title: safeText(section.title || section.name, 85),
    selectionType: safeText(section.selectionType || section.key),
    items,
  };
}

function flattenPlannerSections(sections: RawSection[]) {
  const flattened: RawSection[] = [];
  for (const section of sections.slice(0, 40)) {
    const products = Array.isArray(section.products) ? section.products : [];
    const sectionName = safeText(section.title || section.name, 48);
    const sectionId = safeText(section.id);
    let hasOptionGroups = false;
    for (const product of products.slice(0, 30)) {
      for (const group of (Array.isArray(product.optionGroups) ? product.optionGroups : []).slice(0, 20)) {
        if (!Array.isArray(group.options) || !group.options.length) continue;
        hasOptionGroups = true;
        flattened.push({
          id: sectionId + ":" + safeText(group.id || group.key),
          key: safeText(group.key),
          title: [sectionName, safeText(group.name, 48)].filter(Boolean).join(" · "),
          selectionType: safeText(section.key),
          items: group.options.map(option => ({ ...option, type: "option" })),
        });
      }
    }
    if (!hasOptionGroups && products.length) {
      flattened.push({
        id: sectionId, key: safeText(section.key), title: sectionName,
        selectionType: safeText(section.key),
        items: products.map(product => ({ ...product, type: "product" })),
      });
    }
  }
  return flattened;
}

export async function GET() {
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  if (!backend || !/^https:\/\//.test(backend)) {
    return NextResponse.json({ status: false, data: [], code: "SOURCE_NOT_CONFIGURED" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    let rawSections: RawSection[] = [];
    let revision = "";
    try {
      const direct = await publicRead(backend, "/api/subscriptions/meal-builder");
      if (direct.status === true && Array.isArray(direct.data?.sections)) {
        rawSections = direct.data.sections;
        revision = safeText(direct.data.revisionHash);
      }
    } catch { /* Use the older Flutter-facing public catalog if no published direct contract exists. */ }

    if (!rawSections.length) {
      const app = await publicRead(backend, "/api/subscriptions/meal-planner-menu");
      if (app.status !== true || !app.data) throw new Error("APP_CATALOG_INVALID");
      const planner = app.data.plannerCatalog?.sections || app.data.builderCatalog?.sections;
      if (Array.isArray(planner) && planner.length) {
        rawSections = flattenPlannerSections(planner);
      } else {
        const catalog = app.data.builderCatalog || {};
        rawSections = [
          { id: "proteins", key: "proteins", title: "البروتين", items: catalog.proteins },
          { id: "carbs", key: "carbs", title: "الأرز والمكرونة", items: catalog.carbs },
          { id: "sandwiches", key: "sandwiches", title: "الساندويتشات", items: catalog.sandwiches?.map(x => ({...x, type: "product"})) },
        ];
      }
    }

    const sections = rawSections.map(sanitizedSection).filter(section => section.items.length && section.title);
    if (!sections.length) throw new Error("APP_CATALOG_EMPTY");
    return NextResponse.json({
      status: true, source: "published_subscription_meal_builder", revision, data: sections,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ status: false, data: [], code: "SOURCE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}

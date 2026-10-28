import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawMeal = { mealsPerDay?: number; priceHalala?: number; priceSar?: number };
type RawGram = { grams?: number; mealsOptions?: RawMeal[] };
type RawPlan = { id?: string; daysCount?: number; currency?: string; gramsOptions?: RawGram[] };

function normalize(raw: RawPlan) {
  if (!raw || ![7, 26, 30].includes(raw.daysCount ?? 0) || raw.currency !== "SAR") return null;
  const gramsOptions = (Array.isArray(raw.gramsOptions) ? raw.gramsOptions : [])
    .filter(g => [100, 150, 200].includes(g.grams ?? 0))
    .map(g => ({
      grams: g.grams,
      mealsOptions: (Array.isArray(g.mealsOptions) ? g.mealsOptions : [])
        .filter(m => Number.isInteger(m.mealsPerDay) && (m.mealsPerDay ?? 0) >= 1 && (m.mealsPerDay ?? 0) <= 5
          && Number.isSafeInteger(m.priceHalala) && (m.priceHalala ?? 0) > 0)
        .map(m => ({ mealsPerDay: m.mealsPerDay, priceHalala: m.priceHalala })),
    }))
    .filter(g => g.mealsOptions.length > 0);
  return gramsOptions.length > 0 ? { daysCount: raw.daysCount, currency: "SAR", gramsOptions } : null;
}

export async function GET() {
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  if (!backend || !/^https:\/\//.test(backend)) {
    return NextResponse.json({ status: false, data: [], code: "SOURCE_NOT_CONFIGURED" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    // Same public, read-only price matrix consumed by the mobile app. No DB writes.
    const upstream = await fetch(backend + "/api/plans", {
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(6500),
      headers: { "accept": "application/json", "accept-language": "ar" },
    });
    if (!upstream.ok) throw new Error("PLANS_UNAVAILABLE");
    const body = await upstream.json() as { data?: RawPlan[]; status?: boolean };
    if (body.status !== true || !Array.isArray(body.data)) throw new Error("PLANS_INVALID");
    const plans = body.data.map(normalize).filter((v): v is NonNullable<typeof v> => Boolean(v));
    if (plans.length === 0) throw new Error("PLANS_EMPTY");
    return NextResponse.json({ status: true, source: "live_app_catalog", data: plans },
      { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ status: false, data: [], code: "SOURCE_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } });
  }
}

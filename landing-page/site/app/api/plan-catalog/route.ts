import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpstreamMeal = { mealsPerDay?: unknown; priceSar?: unknown; priceHalala?: unknown };
type UpstreamGram = { grams?: unknown; mealsOptions?: UpstreamMeal[]; mealOptions?: UpstreamMeal[] };
type UpstreamPlan = { id?: unknown; daysCount?: unknown; gramsOptions?: UpstreamGram[]; currency?: unknown };

export async function GET() {
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  if (!backend || !/^https:\/\//.test(backend)) {
    return NextResponse.json({ status: false, data: [], code: "UNAVAILABLE" }, { status: 503 });
  }
  try {
    const upstream = await fetch(backend + "/api/plans", {
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(6500),
      headers: { "accept": "application/json", "accept-language": "ar" },
    });
    if (!upstream.ok) throw new Error("CATALOG_NOT_AVAILABLE");
    const response = await upstream.json() as { data?: UpstreamPlan[] };
    const candidates = Array.isArray(response.data) ? response.data : [];
    const allowedDays = new Set([7, 26, 30]);
    const data = candidates.flatMap((plan) => {
      const days = Number(plan.daysCount);
      if (!allowedDays.has(days) || plan.currency !== "SAR" || typeof plan.id !== "string" || !/^[a-f\d]{24}$/i.test(plan.id)) return [];
      const gramsOptions = (Array.isArray(plan.gramsOptions) ? plan.gramsOptions : []).flatMap(gram => {
        const grams = Number(gram.grams);
        if (![100, 150, 200].includes(grams)) return [];
        const mealsOptions = (Array.isArray(gram.mealsOptions) ? gram.mealsOptions : Array.isArray(gram.mealOptions) ? gram.mealOptions : [])
          .flatMap(meal => {
            const count = Number(meal.mealsPerDay);
            // Never guess a missing price. SAR in the public API is derived from a validated halala matrix.
            const price = typeof meal.priceSar === "number" ? meal.priceSar :
              typeof meal.priceHalala === "number" ? meal.priceHalala / 100 : NaN;
            return Number.isInteger(count) && count >= 1 && count <= 5 && Number.isFinite(price) && price > 0
              ? [{ mealsPerDay: count, priceSar: price }] : [];
          });
        return mealsOptions.length ? [{ grams, mealsOptions }] : [];
      });
      return gramsOptions.length ? [{ planId: plan.id, daysCount: days, gramsOptions }] : [];
    }).sort((a, b) => a.daysCount - b.daysCount);
    return NextResponse.json({ status: true, data }, { headers: { "cache-control": "private, no-store", "x-robots-tag": "noindex" } });
  } catch {
    return NextResponse.json({ status: false, data: [], code: "UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

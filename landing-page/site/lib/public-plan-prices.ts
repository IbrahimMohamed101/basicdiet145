/**
 * Read-only price feed for crawlable, server-rendered subscription prices.
 * Never guess prices: render a price only after validating the live app catalog.
 */
export type PublicMealPrice = { mealsPerDay: number; priceSar: number };
export type PublicGramPrices = { grams: number; mealsOptions: PublicMealPrice[] };
export type PublicPlanPrices = { daysCount: number; gramsOptions: PublicGramPrices[] };

type UpstreamMeal = { mealsPerDay?: unknown; priceSar?: unknown; priceHalala?: unknown };
type UpstreamGram = { grams?: unknown; mealsOptions?: UpstreamMeal[]; mealOptions?: UpstreamMeal[] };
type UpstreamPlan = { daysCount?: unknown; gramsOptions?: UpstreamGram[]; currency?: unknown };

export function normalizePublicPrices(payload: unknown): PublicPlanPrices[] {
  if (!payload || typeof payload !== "object") return [];
  const response = payload as { data?: unknown };
  if (!Array.isArray(response.data)) return [];
  const allowedDays = new Set([7, 26, 30]);
  return response.data.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== "object") return [];
    const plan = raw as UpstreamPlan;
    const daysCount = Number(plan.daysCount);
    if (!allowedDays.has(daysCount) || plan.currency !== "SAR") return [];
    const gramsOptions = (Array.isArray(plan.gramsOptions) ? plan.gramsOptions : []).flatMap(gram => {
      const grams = Number(gram.grams);
      if (![100, 150, 200].includes(grams)) return [];
      const options = Array.isArray(gram.mealsOptions) ? gram.mealsOptions :
        Array.isArray(gram.mealOptions) ? gram.mealOptions : [];
      const mealsOptions = options.flatMap(meal => {
        const mealsPerDay = Number(meal.mealsPerDay);
        const priceSar = typeof meal.priceSar === "number" ? meal.priceSar :
          typeof meal.priceHalala === "number" ? meal.priceHalala / 100 : NaN;
        return Number.isInteger(mealsPerDay) && mealsPerDay >= 1 && mealsPerDay <= 5 &&
          Number.isFinite(priceSar) && priceSar > 0 && priceSar <= 100000 &&
          Number.isInteger(Math.round(priceSar * 100))
          ? [{ mealsPerDay, priceSar }] : [];
      }).sort((a, b) => a.mealsPerDay - b.mealsPerDay);
      return mealsOptions.length ? [{ grams, mealsOptions }] : [];
    }).sort((a, b) => a.grams - b.grams);
    return gramsOptions.length ? [{ daysCount, gramsOptions }] : [];
  }).sort((a, b) => a.daysCount - b.daysCount);
}

export async function getPublicPlanPrices(): Promise<PublicPlanPrices[]> {
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  if (!backend || !/^https:\/\//.test(backend)) return [];
  try {
    const upstream = await fetch(backend + "/api/plans", {
      next: { revalidate: 900 },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json", "accept-language": "ar" },
    });
    if (!upstream.ok) return [];
    return normalizePublicPrices(await upstream.json());
  } catch {
    return []; // Fail closed: don't publish outdated or invented prices.
  }
}

export const formatSar = (value: number) =>
  new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(value) + " ر.س";

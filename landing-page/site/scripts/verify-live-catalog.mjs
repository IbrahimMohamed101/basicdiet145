const base = process.env.BASICDIET_CATALOG_SMOKE_URL || "https://basicdiet145-production-51e9.up.railway.app";

async function readOnlyCatalog(path) {
  const response = await fetch(base + path, {
    headers: { accept: "application/json", "accept-language": "ar" },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(path + " HTTP " + response.status);
  const body = await response.json();
  if (body.status !== true || !Array.isArray(body.data)) {
    if (path.endsWith("/meal-builder") && body.status === true && Array.isArray(body.data?.sections)) {
      return body.data.sections;
    }
    throw new Error(path + " invalid response");
  }
  return body.data;
}

try {
  const plans = await readOnlyCatalog("/api/plans");
  const priceIndex = [];
  for (const plan of plans) {
    if (![7,26,30].includes(plan.daysCount)) continue;
    for (const grams of plan.gramsOptions || []) {
      for (const opt of grams.mealsOptions || []) {
        if (Number.isInteger(opt.priceHalala) && opt.priceHalala > 0) {
          priceIndex.push({ days: plan.daysCount, grams: grams.grams, meals: opt.mealsPerDay, halala: opt.priceHalala });
        }
      }
    }
  }
  if (priceIndex.length < 15) throw new Error("Public plan catalog has fewer than 15 validated prices");
  const sample = priceIndex.find(p => p.days === 26 && p.grams === 150 && p.meals === 2);
  console.log("LIVE_PLAN_PRICE_COUNT", priceIndex.length, "26d_150g_2meals", sample?.halala ?? "not_available");

  const sections = await readOnlyCatalog("/api/subscriptions/meal-builder");
  const totalItems = sections.reduce((sum, section) => sum + (Array.isArray(section.items) ? section.items.length : 0), 0);
  if (!sections.length || !totalItems) throw new Error("Published meal builder is empty");
  console.log("PUBLISHED_APP_MENU", sections.length, "sections", totalItems, "options");
  console.log("Source checked with public GET only. No data written.");
} catch (error) {
  console.error("PUBLIC_CATALOG_CHECK_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

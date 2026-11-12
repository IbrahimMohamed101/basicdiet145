import type { Page } from "@playwright/test";

/** Keep third-party widget/network policy noise separate from first-party QA.
 * Live official embeds are also inspected separately; meal images stay real. */
export async function isolateInstagram(page: Page) {
  await page.route("https://www.instagram.com/**", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html lang="ar"><body style="margin:0;background:#203c2c;color:white">Official embed isolated for deterministic layout QA</body></html>',
  }));
}

/** Catalog fixture: a real documented 26-day, 150g, two-meal example (SAR 1186).
 * Other combinations deliberately stay unavailable rather than inventing prices. */
export const planCatalogFixture = {
  status: true,
  data: [{
    planId: "000000000000000000000026",
    daysCount: 26,
    gramsOptions: [{
      grams: 150,
      mealsOptions: [{ mealsPerDay: 2, priceSar: 1186 }],
    }],
  }],
};

export async function stubPlanCatalog(page: Page) {
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(planCatalogFixture),
  }));
}

/** Verify the actual unavailable-catalog UI rather than a successful fixture. */
export async function stubUnavailablePlanCatalog(page: Page) {
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ status: false, data: [], code: "UNAVAILABLE" }),
  }));
}

/** Isolate analytics ingestion in presentation/navigation-only browser tests.
 * Production analytics semantics and analytics-origin.spec.ts are NOT mocked. */
export async function stubPresentationAnalytics(page: Page) {
  await page.route("**/api/analytics", route => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({ status: 204, body: "" });
  });
}

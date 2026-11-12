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

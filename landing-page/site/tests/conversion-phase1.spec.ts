import { expect, test } from "@playwright/test";

const catalog = { data: [{ planId: "fixture", daysCount: 26, gramsOptions: [{ grams: 150, mealsOptions: [{ mealsPerDay: 2, priceSar: 1186 }] }] }] };
const format = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test("hero targets the server-rendered calculator shell; controls load on demand", async ({ page, request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  expect(await response.text()).toContain('id="plans"');
  await page.route("**/api/plan-catalog", route => route.fulfill({ json: catalog }));
  await page.goto("/");
  const hero = page.locator('.hero-cinema-actions a[href="#plans"]');
  await expect(hero).toHaveText("احسب سعر اشتراكك");
  await hero.click();
  await expect(page).toHaveURL(/#plans$/);
  await expect(page.locator("#plans fieldset").first()).toBeVisible();
  await expect(page.getByTestId("offer-price")).toBeVisible();
});

test("package-only price, savings and per-meal estimate use catalog data", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({ json: catalog }));
  await page.goto("/");
  await page.locator("#plans").scrollIntoViewIfNeeded();
  const base = catalog.data[0].gramsOptions[0].mealsOptions[0].priceSar;
  const saving = Math.round(base * 100 * .15) / 100;
  await expect(page.getByTestId("offer-price")).toContainText(format(base - saving));
  await expect(page.getByTestId("offer-savings")).toContainText(format(saving));
  await expect(page.getByTestId("offer-per-meal")).toContainText(format((base - saving) / 52));
});

test("store click reaches the existing endpoint exactly once per click, including nested targets", async ({ page }) => {
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/analytics", async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { ok: true } });
  });
  await page.route("**/api/plan-catalog", route => route.fulfill({ json: catalog }));
  await page.goto("/");
  await page.locator("#plans").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("offer-price")).toBeVisible();
  // Keep the test in this browser tab without visiting a real store.
  await page.evaluate(() => document.addEventListener("click", e => {
    if ((e.target as Element)?.closest("a[href*='apps.apple.com'],a[href*='play.google.com']")) e.preventDefault();
  }));
  for (const store of ["app_store", "google_play"]) {
    await page.locator('#plans [data-store="' + store + '"]').click();
    await expect.poll(() => sent.filter(e => e.event === "lp_store_click" && e.store === store && e.location === "plans").length).toBe(1);
  }
  const regular = page.locator(".app-store-button[href*='apps.apple.com'] .app-store-copy").first();
  await regular.click();
  await expect.poll(() => sent.filter(e => e.event === "lp_store_click").length).toBe(3);
  expect(sent.filter(e => e.event === "lp_store_click" && e.location === "plans")).toHaveLength(2);
});

test("catalog outage preserves honest pricing fallback", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({ status: 503, json: { data: [] } }));
  await page.goto("/");
  const calculator = page.locator("#plans");
  await calculator.scrollIntoViewIfNeeded();
  await expect(calculator.locator(".bd-calculator-summary a[href='/jeddah/subscription-prices']")).toBeVisible();
  await expect(calculator.locator(".bd-calculator-offer")).toHaveCount(0);
});

for (const width of [320, 390, 430]) {
  test("calculator conversion mobile " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/plan-catalog", route => route.fulfill({ json: catalog }));
    await page.goto("/");
    await page.locator("#plans").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("offer-price")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.locator("#plans").screenshot({ path: "artifacts/conversion-" + width + ".png", animations: "disabled" });
  });
}

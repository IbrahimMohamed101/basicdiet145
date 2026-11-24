import { expect, test } from "@playwright/test";

test("home calculator controls exist in initial HTML", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain("احسب سعر اشتراكك");
  expect(html).toContain("01 / مدة الاشتراك");
  expect(html).not.toContain("جاري تجهيز حاسبة الاشتراكات...");
});

test("calculator shows package-only savings and per-meal value", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({ json: { data: [
    { planId: "fixture", daysCount: 26, gramsOptions: [{ grams: 150, mealsOptions: [{ mealsPerDay: 2, priceSar: 1186 }] }] }
  ] } }));
  await page.goto("/");
  const calculator = page.locator("#plans");
  await expect(calculator).toContainText("1,008.10");
  await expect(calculator).toContainText("177.90");
  await expect(calculator).toContainText("19.39");
  await expect(calculator.getByRole("link", { name: /اشترك من تطبيق بيسك دايت على App Store/ })).toBeAttached();
});

test("calculator failure links to pricing without inventing a price", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({ status: 503, json: { data: [] } }));
  await page.goto("/");
  const calculator = page.locator("#plans");
  await expect(calculator).toContainText("تعذّر تحميل الأسعار");
  await expect(calculator.getByRole("link", { name: "شاهد جدول أسعار الاشتراكات المتاح" })).toHaveAttribute("href", "/jeddah/subscription-prices");
  await expect(calculator.locator(".bd-calculator-offer")).toHaveCount(0);
});

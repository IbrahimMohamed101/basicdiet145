import { expect, test } from "@playwright/test";

const options = {
  status: true,
  data: [{ planId: "507f1f77bcf86cd799439026", daysCount: 26,
    gramsOptions: [{ grams: 150, mealsPerDay: [1, 2, 3] }] }],
};

test("search-intent page is crawlable, useful and links to the lead enquiry", async ({ page }) => {
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(options),
  }));
  await page.goto("/jeddah/healthy-meals", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(/اشتراك وجبات صحية في جدة/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("اشتراك وجبات صحية في جدة");
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", /\/jeddah\/healthy-meals$/);
  await expect(page.getByRole("heading", { name: /باقات اشتراكات وجبات صحية/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /طريقة بدء اشتراك/ })).toBeVisible();

  await page.getByRole("button", { name: /استفسر عن الباقة/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /26 يوم/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("dialog").getByRole("button", { name: "إغلاق النافذة" }).click();
});

test("sitemap and robots list canonical public content, excluding private lead APIs", async ({ request }) => {
  const [map, robots] = await Promise.all([
    request.get("/sitemap.xml"), request.get("/robots.txt"),
  ]);
  expect(map.status()).toBe(200);
  expect(robots.status()).toBe(200);
  const xml = await map.text();
  expect(xml).toContain("/jeddah/healthy-meals");
  expect(xml).toContain("https://");
  expect(xml).not.toContain("/privacy");
  const text = await robots.text();
  expect(text).toContain("Disallow: /api/");
  expect(text).toContain("Disallow: /privacy");
  expect(text).toContain("Sitemap:");
});

test("search page remains usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/jeddah/healthy-meals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "اشتراكات وجبات صحية جدة" })).toHaveAttribute("href", "/jeddah/healthy-meals");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(391);
});

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

  await page.getByRole("button", { name: /سجّل لخصم 15%/ }).first().click();
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
  expect(xml).toContain("/jeddah/subscription-prices");
  expect(xml).toContain("/menu");
  expect(xml).toContain("<lastmod>");
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

test("homepage links contextually to the Jeddah subscriptions guide", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const guide = page.getByRole("link", { name: /قارن باقات بيسك دايت/ });
  await expect(guide).toHaveAttribute("href", "/jeddah/healthy-meals");
});

test("Jeddah page has useful local links, a real meal image and correct breadcrumb JSON-LD", async ({ page }) => {
  await page.goto("/jeddah/healthy-meals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /وجبات دايت في جدة تختارها حسب باقتك/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /موقع المطعم والتواصل/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /سالمون من أصناف منيو بيسك دايت/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /موقع Basic Diet على Google Maps/ })).toHaveAttribute("href", /maps.app.goo.gl/);
  const rawSchemas = await page.locator('script[type="application/ld+json"]').allTextContents();
  const schemas = rawSchemas.map(raw => JSON.parse(raw));
  const breadcrumbSchemas = schemas.filter(schema => schema["@type"] === "BreadcrumbList");
  expect(breadcrumbSchemas).toHaveLength(1);
  const schema = breadcrumbSchemas[0];
  expect(schema.itemListElement).toHaveLength(2);
  expect(schema.itemListElement[1].item).toMatch(/\/jeddah\/healthy-meals$/);
});

test("pricing SEO page has canonical, crawlable server HTML and a safe live-feed fallback", async ({ request, page }) => {
  const response = await request.get("/jeddah/subscription-prices");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("أسعار اشتراك وجبات دايت في جدة");
  expect(html).toContain("/jeddah/subscription-prices");
  expect(html).toContain("وجبات");
  // Both conditions are legitimate: live price feed can be temporarily unavailable in CI.
  expect(html.includes("جدول أسعار باقات الاشتراك")).toBeTruthy();
  expect(html.includes("قائمة الأسعار غير متاحة للعرض الآن") ||
    html.includes("السعر الأساسي")).toBeTruthy();

  await page.goto("/jeddah/subscription-prices", { waitUntil: "domcontentloaded" });
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", /\/jeddah\/subscription-prices$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("أسعار اشتراك وجبات دايت");
  await expect(page.getByRole("link", { name: /تصفّح منيو بيسك دايت/ })).toHaveAttribute("href", "/menu");
});

test("homepage offers crawlable pricing content and business data without invented 24-hour opening", async ({ request }) => {
  const result = await request.get("/");
  expect(result.status()).toBe(200);
  const html = await result.text();
  expect(html).toContain("قارن أسعار باقات بيسك دايت قبل التسجيل");
  expect(html).toContain("/jeddah/subscription-prices");
  expect(html).not.toContain('Mo-Su 00:00-23:59');
  expect(html).toContain('"hasMenu"');
});

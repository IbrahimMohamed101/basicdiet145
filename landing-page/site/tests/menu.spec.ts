import { expect, test } from "@playwright/test";

for (const width of [320, 360, 390, 768, 1440]) {
  test("menu preview remains within viewport at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /منيو بيسك دايت/ })).toBeVisible();
    for (const id of ["menu-plans", "menu-custom", "menu-products", "menu-download"]) {
      await expect(page.locator("#" + id)).toBeVisible();
    }
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
    await expect(page.locator("main .menu-product-card")).toHaveCount(12);
    const missingTargets = await page.locator('a[href^="#"]').evaluateAll((links) => links
      .map((link) => link.getAttribute("href") || "")
      .filter((href) => href.length > 1 && !document.getElementById(href.slice(1))));
    expect(missingTargets).toEqual([]);
  });
}

test("plan selector uses current public app catalog pricing and responds to all dimensions", async ({ page }) => {
  await page.route("**/api/menu-plans", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ status: true, source: "live_app_catalog", data: [
      { daysCount: 26, gramsOptions: [
        { grams: 150, mealsOptions: [{ mealsPerDay: 2, priceHalala: 118600 }] },
      ] },
      { daysCount: 7, gramsOptions: [
        { grams: 150, mealsOptions: [{ mealsPerDay: 2, priceHalala: 34800 }, { mealsPerDay: 3, priceHalala: 52200 }] },
        { grams: 200, mealsOptions: [{ mealsPerDay: 2, priceHalala: 42000 }, { mealsPerDay: 3, priceHalala: 63000 }] },
      ] },
    ] }),
  }));
  await page.goto("/menu");
  const plans = page.locator("#menu-plans");
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("١٬١٨٦");
  await plans.getByRole("group", { name: "مدة الاشتراك" }).getByRole("button", { name: /7/ }).click();
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("٣٤٨");
  await plans.getByRole("group", { name: "حجم الوجبة" }).getByRole("button", { name: /200/ }).click();
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("٤٢٠");
  await plans.getByRole("group", { name: "عدد الوجبات" }).getByRole("button", { name: "3" }).click();
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("٦٣٠");
  await expect(plans).toContainText("السعر الأساسي مباشرة من كتالوج التطبيق");
});

test("builder and catalog interactions are read-only", async ({ page }) => {
  await page.goto("/menu");
  const builder = page.locator("#menu-custom");
  await builder.getByRole("button", { name: /رز أبيض/ }).click();
  await expect(builder.locator(".menu-summary-data")).toContainText("رز أبيض");
  await builder.getByRole("group", { name: "نوع تجربة التخصيص" })
    .getByRole("button", { name: /اصنع سلطتك/ }).click();
  await builder.getByRole("button", { name: "خس" }).click();
  await builder.getByRole("button", { name: "جرجير" }).click();
  await expect(builder.locator(".menu-summary-data")).toContainText("2");
  const catalog = page.locator("#menu-products");
  await catalog.getByRole("group", { name: "تصنيفات المنيو" })
    .getByRole("button", { name: "السلطات" }).click();
  await expect(catalog).toContainText("18 صنف");
  await catalog.getByRole("searchbox", { name: "ابحث عن صنف" }).fill("90");
  await expect(catalog.locator(".menu-product-card")).toHaveCount(1);
  await catalog.locator(".menu-product-card button").click();
  await expect(page.getByRole("dialog", { name: /سلطه بيسك/ })).toBeVisible();
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("draft menu is not indexed", async ({ page }) => {
  await page.goto("/menu");
  const robots = page.locator('meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
});


test("footer callback uses the existing landing lead endpoint and preserves the customer inputs", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: true,
      data: [{ planId: "6a621995f4f8d0974cebc472", daysCount: 26, gramsOptions: [{ grams: 150, mealsPerDay: [2] }] }],
    }),
  }));
  await page.route("**/api/leads", async route => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 202, contentType: "application/json", body: '{"status":true}' });
  });
  await page.goto("/menu");
  const form = page.locator("#menu-quick-contact form");
  await form.getByRole("textbox", { name: "الاسم" }).fill("عميل تجربة");
  await form.getByRole("textbox", { name: "رقم الجوال السعودي" }).fill("0501234567");
  await form.getByRole("button", { name: /كمّل طلب التواصل/ }).click();
  const dialog = page.locator(".lead-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "باقي خطوة ونساعدك تبدأ" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /اسمك/ })).toHaveValue("عميل تجربة");
  await expect(dialog.getByRole("textbox", { name: "رقم الجوال" })).toHaveValue("0501234567");
  await dialog.getByRole("checkbox", { name: /أوافق على التواصل/ }).check();
  await dialog.getByRole("button", { name: /اطلب تواصل من Basic Diet/ }).click();
  await expect(dialog.getByRole("heading", { name: "وصلنا طلبك!" })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].name).toBe("عميل تجربة");
  expect(sent[0].phone).toBe("+966501234567");
  expect(sent[0].planId).toBe("6a621995f4f8d0974cebc472");
  expect(sent[0].daysCount).toBe(26);
  expect(sent[0].contactConsent).toBe(true);
  expect(sent[0].location).toBe("final");
  expect(String(sent[0].content)).toContain("menu_footer_form");
});

test("plan call request carries the selected plan dimensions", async ({ page }) => {
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: [{ planId: "6a621995f4f8d0974cebc472", daysCount: 26, gramsOptions: [
        { grams: 100, mealsPerDay: [1, 2] }, { grams: 150, mealsPerDay: [1, 2] }, { grams: 200, mealsPerDay: [2] },
      ] }],
    }),
  }));
  await page.goto("/menu");
  const plans = page.locator("#menu-plans");
  await plans.getByRole("group", { name: "حجم الوجبة" }).getByRole("button", { name: /200/ }).click();
  await plans.getByRole("button", { name: /تبغى نكلمك عن هذي الباقة/ }).click();
  const dialog = page.locator(".lead-dialog");
  await expect(dialog.getByRole("heading", { name: "باقي خطوة ونساعدك تبدأ" })).toBeVisible();
  await expect(dialog.locator(".lead-selection-summary")).toContainText("200 جرام");
});

test("menu offers a visible app download without contact consent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  await expect(page.locator(".menu-mobile-conversion-bar")).toHaveCount(0);
  await expect(page.locator("#menu-quick-contact a[href*='play.google.com']")).toBeVisible();
  await expect(page.locator("#menu-quick-contact a[href*='apps.apple.com']")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});


test("food photos, categories and catalog precede subscription and contact on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  await expect(page.locator(".menu-hero-art img")).toHaveCount(3);
  await expect(page.locator(".menu-featured-card")).toHaveCount(4);
  await expect(page.locator(".menu-quick-lead")).toHaveCount(1);
  await expect(page.locator(".menu-hero .menu-quick-lead")).toHaveCount(0);
  await expect(page.locator(".menu-mobile-conversion-bar")).toHaveCount(0);
  const positions = await page.evaluate(() => ({
    hero: document.querySelector(".menu-hero")?.getBoundingClientRect().top ?? -1,
    categories: document.querySelector(".menu-featured-categories")?.getBoundingClientRect().top ?? -1,
    catalog: document.querySelector("#menu-products")?.getBoundingClientRect().top ?? -1,
    plans: document.querySelector("#menu-plans")?.getBoundingClientRect().top ?? -1,
    builder: document.querySelector("#menu-custom")?.getBoundingClientRect().top ?? -1,
    footer: document.querySelector("#menu-quick-contact")?.getBoundingClientRect().top ?? -1,
  }));
  expect(positions.hero).toBeLessThan(positions.categories);
  expect(positions.categories).toBeLessThan(positions.catalog);
  expect(positions.catalog).toBeLessThan(positions.plans);
  expect(positions.plans).toBeLessThan(positions.builder);
  expect(positions.builder).toBeLessThan(positions.footer);
});

test("photographic category shortcut selects products without opening contact", async ({ page }) => {
  await page.goto("/menu");
  await page.locator(".menu-featured-card").filter({ hasText: "السلطات" }).click();
  const catalog = page.locator("#menu-products");
  await expect(catalog.getByRole("group", { name: "تصنيفات المنيو" })
    .getByRole("button", { name: "السلطات" })).toHaveAttribute("aria-pressed", "true");
  await expect(catalog).toContainText("18 صنف");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("builder asks for callback only when explicitly selected", async ({ page }) => {
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: [{
      planId: "6a621995f4f8d0974cebc472", daysCount: 26,
      gramsOptions: [{ grams: 150, mealsPerDay: [2] }],
    }] }),
  }));
  await page.goto("/menu");
  const builder = page.locator("#menu-custom");
  await builder.getByRole("group", { name: "نوع تجربة التخصيص" })
    .getByRole("button", { name: /اصنع سلطتك/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await builder.getByRole("button", { name: /عندك سؤال/ }).click();
  await expect(page.locator(".lead-dialog")).toBeVisible();
  await expect(page.locator(".lead-dialog").getByRole("heading", { name: "باقي خطوة ونساعدك تبدأ" })).toBeVisible();
});


test("menu has one navigational header with local menu links", async ({ page }) => {
  await page.goto("/menu");
  await expect(page.locator(".site-header")).toHaveCount(1);
  await expect(page.locator(".menu-jump-nav")).toHaveCount(0);
  const nav = page.locator(".site-header .desktop-nav");
  await expect(nav.locator('a[href="#menu-products"]')).toHaveCount(1);
  await expect(nav.locator('a[href="#menu-plans"]')).toHaveCount(1);
  await expect(nav.locator('a[href="#menu-custom"]')).toHaveCount(1);
  await expect(nav.locator('a[href="#menu-download"]')).toHaveCount(1);
  await expect(page.locator(".menu-hero .menu-quick-lead")).toHaveCount(0);
});

test("same food picture is displayed once for shrimp size variants", async ({ page }) => {
  await page.goto("/menu");
  const shrimpCard = page.locator(".menu-product-card")
    .filter({ has: page.getByRole("group", { name: "اختر وزن جمبري" }) });
  await expect(shrimpCard).toHaveCount(1);
  await expect(shrimpCard.getByRole("button", { name: "100 جم" })).toHaveAttribute("aria-pressed", "true");
  await shrimpCard.getByRole("button", { name: "150 جم" }).click();
  await expect(shrimpCard.getByRole("button", { name: "150 جم" })).toHaveAttribute("aria-pressed", "true");
  await expect(shrimpCard.locator(".menu-product-bottom strong")).toContainText("٤٩");
  await shrimpCard.getByRole("button", { name: /تفاصيل جمبري 150 جرام/ }).click();
  await expect(page.getByRole("dialog")).toContainText("جمبري 150 جرام");
});


test("subscription prices fail closed when live app catalog cannot be reached", async ({ page }) => {
  await page.route("**/api/menu-plans", route => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ status: false, data: [], code: "SOURCE_UNAVAILABLE" }),
  }));
  await page.goto("/menu");
  const plans = page.locator("#menu-plans");
  await expect(plans.locator(".menu-price-unavailable")).toHaveText("السعر غير متاح");
  await expect(plans).not.toContainText("١٬١٨٦");
});

test("meal-builder shows photos only for supported matched dishes", async ({ page }) => {
  await page.goto("/menu");
  const builder = page.locator("#menu-custom");
  const shrimp = builder.getByRole("button", { name: /جمبري/ });
  await expect(shrimp.locator("img")).toHaveCount(1);
  const rice = builder.getByRole("button", { name: /رز أبيض/ });
  await expect(rice.locator("img")).toHaveCount(1);
  await rice.click();
  await expect(rice).toHaveAttribute("aria-pressed","true");
  await expect(builder.locator(".menu-summary-data")).toContainText("رز أبيض");
});


test("published app menu options are browsable with real Drive photo mapping and no invented item price", async ({ page }) => {
  await page.route("**/api/menu-app-catalog", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ status: true, source: "published_subscription_meal_builder", data: [
      { id: "chicken", key: "protein", title: "الدجاج", selectionType: "standard_meal", items: [
        { id: "a", key: "tikka", name: "دجاج تكا", image: "", extraPriceHalala: 0, isPremium: false, type: "option" },
        { id: "b", key: "barbecue", name: "دجاج باربكيو", image: "", extraPriceHalala: 450, isPremium: false, type: "option" },
      ]},
      { id: "carbs", key: "carbs", title: "الكارب", selectionType: "standard_meal", items: [
        { id: "c", key: "rice", name: "رز أبيض", image: "", extraPriceHalala: 0, isPremium: false, type: "option" },
      ]},
    ] }),
  }));
  await page.goto("/menu");
  const catalog = page.locator("#menu-app-catalog");
  await expect(catalog).toContainText("3 اختيار");
  await expect(catalog.locator(".menu-app-card")).toHaveCount(2);
  await expect(catalog.locator(".menu-app-card").first().locator("img")).toHaveCount(1);
  await expect(catalog.locator(".menu-app-card").first()).toContainText("اختيار داخل الاشتراك");
  await expect(catalog.locator(".menu-app-card").nth(1)).toContainText("٤٫٥");
  await catalog.getByRole("button", { name: /الكارب/ }).click();
  await expect(catalog.locator(".menu-app-card")).toHaveCount(1);
  await expect(catalog.locator(".menu-app-card")).toContainText("رز أبيض");
});

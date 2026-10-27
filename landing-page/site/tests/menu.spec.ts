import { expect, test } from "@playwright/test";

for (const width of [320, 360, 390, 768, 1440]) {
  test("menu preview remains within viewport at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /وجبات على مزاجك/ })).toBeVisible();
    for (const id of ["menu-plans", "menu-custom", "menu-products", "menu-download"]) {
      await expect(page.locator("#" + id)).toBeVisible();
    }
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
    await expect(page.locator("main .menu-product-card")).toHaveCount(9);
    const missingTargets = await page.locator('a[href^="#"]').evaluateAll((links) => links
      .map((link) => link.getAttribute("href") || "")
      .filter((href) => href.length > 1 && !document.getElementById(href.slice(1))));
    expect(missingTargets).toEqual([]);
  });
}

test("plan selector is explicitly draft and responds to all dimensions", async ({ page }) => {
  await page.goto("/menu");
  const plans = page.locator("#menu-plans");
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("١٬١٨٦");
  await plans.getByRole("group", { name: "مدة الاشتراك" }).getByRole("button", { name: /7/ }).click();
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("٣٤٨");
  await plans.getByRole("group", { name: "حجم الوجبة" }).getByRole("button", { name: /200/ }).click();
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("٤٢٠");
  await plans.getByRole("group", { name: "عدد الوجبات" }).getByRole("button", { name: "3" }).click();
  await expect(plans.locator(".menu-price-pop strong")).toHaveText("٦٣٠");
  await expect(plans).toContainText("سعر توضيحي");
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


test("menu quick contact uses the existing landing lead endpoint and preserves the customer inputs", async ({ page }) => {
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
  expect(sent[0].location).toBe("hero");
  expect(String(sent[0].content)).toContain("menu_hero_form");
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
  await expect(page.locator(".menu-mobile-conversion-bar")).toBeVisible();
  await expect(page.locator("#menu-quick-contact a[href*='play.google.com']")).toBeVisible();
  await expect(page.locator("#menu-quick-contact a[href*='apps.apple.com']")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

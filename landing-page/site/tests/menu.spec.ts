import { expect, test } from "@playwright/test";

for (const width of [320, 360, 390, 768, 1440]) {
  test("menu preview remains within viewport at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /أكلك الصحي/ })).toBeVisible();
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

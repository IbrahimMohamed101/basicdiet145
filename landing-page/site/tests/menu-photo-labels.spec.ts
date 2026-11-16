import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`menu photos do not show source badges at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });

    const menu = page.locator("#restaurant-menu");
    await menu.getByRole("button", { name: "الأسماك واللحوم", exact: true }).click();
    for (const name of ["لحم مفروم", "لحم مشروم"]) {
      const dish = menu.locator(".restaurant-menu-card").filter({
        has: page.getByRole("heading", { name, exact: true }),
      });
      await expect(dish).toBeVisible();
      await expect(dish.locator("img")).toHaveCount(1);
    }

    await expect(page.locator("body")).not.toContainText("صورة توضيحية");
    await expect(page.locator(".restaurant-menu-image-note, .menu-photo-disclosure, .menu-coming-soon-photo-note, .menu-builder-photo-note")).toHaveCount(0);

    await page.locator(".menu-extra-toggle").click();
    await page.locator("#menu-products").getByRole("button", { name: "المشروبات" }).click();
    await expect(page.locator(".menu-product-card img")).toHaveCount(12);
    await expect(page.locator(".menu-product-card .menu-photo-disclosure")).toHaveCount(0);

    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )).toBeLessThanOrEqual(1);
  });
}

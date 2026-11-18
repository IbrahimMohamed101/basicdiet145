import { expect, test } from "@playwright/test";
import { restaurantMenuItems } from "../lib/restaurant-menu-data";

const newProducts = [
  { id: "restaurant-18", name: "كلوب بيض اسكرامبل", price: 9, calories: 380, proteinGrams: 20 },
  { id: "restaurant-19", name: "كلوب بيض مسلوق وبيستو", price: 9, calories: 390, proteinGrams: 18 },
  { id: "restaurant-21", name: "كلوب تركي", price: 13, calories: 310, proteinGrams: 22 },
  { id: "restaurant-17", name: "كلوب تونة", price: 13, calories: 290, proteinGrams: 26 },
  { id: "restaurant-40", name: "عريكة صحية", price: 10, calories: 380, proteinGrams: 13 },
] as const;

test("five approved products have correct prices, nutrition, descriptions and approved photo paths", () => {
  expect(restaurantMenuItems).toHaveLength(40);
  expect(new Set(restaurantMenuItems.map(item => item.id)).size).toBe(40);
  for (const expected of newProducts) {
    const item = restaurantMenuItems.find(row => row.id === expected.id);
    expect(item).toBeDefined();
    expect(item).toMatchObject({ ...expected, featured: true });
    expect(item?.nameEn).toBeTruthy();
    expect(item?.descriptionAr).toBeTruthy();
    expect(item?.descriptionEn).toBeTruthy();
    expect(item?.allergens).toBeTruthy();
    expect(item?.image).toMatch(/^\/api\/meal-image\?id=[A-Za-z0-9_-]+$/);
  }
});

for (const width of [390, 1440]) {
  test(`approved products appear in the correct restaurant categories at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/menu");
    const menu = page.locator("#restaurant-menu");
    await expect(menu.locator(".restaurant-menu-card")).toHaveCount(18);

    await menu.getByRole("button", { name: "الساندوتشات", exact: true }).click();
    for (const item of newProducts.slice(0, 4)) {
      const card = menu.locator(".restaurant-menu-card").filter({
        has: page.getByRole("heading", { name: item.name, exact: true }),
      });
      await expect(card).toHaveCount(1);
      await expect(card.locator(".restaurant-menu-price")).toContainText(String(item.price));
      await expect(card).toContainText(`${item.proteinGrams} جم بروتين`);
      await expect(card.locator(".restaurant-menu-description")).toBeVisible();
      await expect(card.locator(".restaurant-menu-name-en")).toHaveCount(0);
      await expect(card.locator("p[lang='en']")).toHaveCount(0);
      await expect(card.locator("summary")).toHaveText("مسببات الحساسية");
      await card.locator("summary").click();
      await expect(card.locator(".restaurant-menu-details p")).not.toBeEmpty();
    }

    await menu.getByRole("button", { name: "الحلويات", exact: true }).click();
    await expect(menu.locator(".restaurant-menu-card")).toHaveCount(1);
    await expect(menu.locator(".restaurant-menu-card")).toContainText("عريكة صحية");
    await expect(menu.locator(".restaurant-menu-card .restaurant-menu-price")).toContainText("10");
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
  });
}

for (const width of [320, 360, 390, 428, 768, 1024, 1440]) {
  test(`club cards are compact and readable with no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    const menu = page.locator("#restaurant-menu");
    await menu.getByRole("button", { name: "الساندوتشات", exact: true }).click();
    const card = menu.locator(".restaurant-menu-card--featured").first();
    await expect(card).toBeVisible();
    await expect(card.locator(".restaurant-menu-price")).toBeVisible();
    await expect(card.locator(".restaurant-menu-description")).toBeVisible();
    await expect(card.locator("summary")).toHaveText("مسببات الحساسية");
    await expect(menu.locator(".restaurant-menu-name-en, p[lang='en']")).toHaveCount(0);

    const sizes = await card.evaluate(node => {
      const outer = node.getBoundingClientRect();
      const photo = node.querySelector(".restaurant-menu-photo")!.getBoundingClientRect();
      const info = node.querySelector(".restaurant-menu-card-content")!.getBoundingClientRect();
      const price = node.querySelector(".restaurant-menu-price")!.getBoundingClientRect();
      return {
        height: outer.height,
        photoWidth: photo.width,
        photoRatio: photo.width / photo.height,
        photoRight: photo.right,
        infoRight: info.right,
        outerWidth: outer.width,
        contentWidth: node.scrollWidth,
        priceRight: price.right,
        priceBottom: price.bottom,
        outerRight: outer.right,
        outerBottom: outer.bottom,
      };
    });
    expect(sizes.contentWidth).toBeLessThanOrEqual(sizes.outerWidth + 1);
    expect(sizes.photoRatio).toBeGreaterThan(1.2);
    expect(sizes.photoRatio).toBeLessThan(1.5);
    expect(sizes.priceBottom).toBeLessThanOrEqual(sizes.outerBottom + 1);
    if (width <= 1080) {
      expect(sizes.photoWidth).toBeLessThanOrEqual(155);
      expect(sizes.photoRight).toBeGreaterThan(sizes.infoRight);
      expect(sizes.height).toBeLessThanOrEqual(245);
    }
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);

    if ([320, 390, 768, 1440].includes(width)) {
      await card.screenshot({ path: `test-results/club-card-${width}.png`, animations: "disabled" });
    }
  });
}

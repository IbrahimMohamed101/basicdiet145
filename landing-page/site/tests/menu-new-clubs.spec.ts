import { expect, test } from "@playwright/test";
import { restaurantMenuItems } from "../lib/restaurant-menu-data";

const newProducts = [
  { id: "restaurant-18", name: "كلوب بيض اسكرامبل", price: 9, calories: 380, proteinGrams: 20 },
  { id: "restaurant-19", name: "كلوب بيض مسلوق وبيستو", price: 9, calories: 390, proteinGrams: 18 },
  { id: "restaurant-21", name: "كلوب تركي", price: 13, calories: 310, proteinGrams: 22 },
  { id: "restaurant-17", name: "كلوب تونة", price: 13, calories: 290, proteinGrams: 26 },
  { id: "restaurant-40", name: "عريكة صحية", price: 12, calories: 380, proteinGrams: 13 },
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
      await card.locator("summary").click();
      await expect(card.locator(".restaurant-menu-details")).toContainText("مسببات الحساسية");
    }

    await menu.getByRole("button", { name: "الحلويات", exact: true }).click();
    await expect(menu.locator(".restaurant-menu-card")).toHaveCount(1);
    await expect(menu.locator(".restaurant-menu-card")).toContainText("عريكة صحية");
    await expect(menu.locator(".restaurant-menu-card .restaurant-menu-price")).toContainText("12");
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
  });
}

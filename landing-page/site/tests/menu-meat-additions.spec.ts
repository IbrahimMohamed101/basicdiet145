import { expect, test } from "@playwright/test";

const newDishes = [
  { name: "لحم مفروم", calories: 250, imageId: "1VrtZmwaQaSkmVAw3iyGYpcOYbOCvQzcK" },
  { name: "لحم مشروم", calories: 240, imageId: "1_-GVEqxtZtww4VnHJGojzoULSJf5cTF4" },
] as const;

for (const width of [390, 1440]) {
  test(`new beef dishes appear as available restaurant menu items at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });

    const restaurant = page.locator("#restaurant-menu");
    await restaurant.getByRole("button", { name: "الأسماك واللحوم", exact: true }).click();
    const group = restaurant.locator(".restaurant-menu-group");
    await expect(group).toHaveCount(1);
    await expect(group.locator(".restaurant-menu-card")).toHaveCount(6);
    await expect(restaurant.getByRole("button", { name: "الكل 40" })).toBeVisible();

    for (const dish of newDishes) {
      const card = group.locator(".restaurant-menu-card").filter({
        has: page.getByRole("heading", { name: dish.name, exact: true }),
      });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText("22");
      await expect(card).toContainText(`${dish.calories} سعرة`);
      await expect(card.getByText("صورة توضيحية")).toHaveCount(0);
      await expect(card.locator("img")).toHaveAttribute("src", new RegExp(dish.imageId));
      await expect(card.getByRole("button")).toHaveCount(0);
    }
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
  });
}

test("new beef photo proxy serves public image content", async ({ request }) => {
  for (const dish of newDishes) {
    const response = await request.get(`/api/meal-image?id=${encodeURIComponent(dish.imageId)}`, {
      timeout: 20000,
    });
    expect(response.status(), `Photo unavailable for ${dish.name}`).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^image\//);
    expect((await response.body()).byteLength).toBeGreaterThan(5000);
  }
});

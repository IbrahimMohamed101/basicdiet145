import { expect, test } from "@playwright/test";
import { menuPreviewItems } from "../lib/menu-preview-items";
import { getMenuNutrition } from "../lib/menu-nutrition";
import snapshot from "../lib/menu-nutrition-data.json";

test("nutrition joins preserve POS identity and distinct dish/portion values", () => {
  const items = new Map(menuPreviewItems.map(item => [item.id, item]));
  expect(Object.keys(snapshot.items)).toHaveLength(82);
  for (const [id, row] of Object.entries(snapshot.items)) {
    expect(items.get(id)?.name, id).toBe(row.name);
    expect(Number.isFinite(row.calories) && row.calories >= 0, id).toBe(true);
    expect(row.sourceRow).toBeGreaterThanOrEqual(6);
  }
  expect(getMenuNutrition("202")?.calories).toBe(350); // liver sandwich
  expect(getMenuNutrition("214")?.calories).toBe(315); // liver breakfast
  expect(getMenuNutrition("30")?.calories).toBe(310); // tuna sandwich
  expect(getMenuNutrition("208")?.calories).toBe(260); // tuna breakfast
  expect(getMenuNutrition("34")?.calories).toBe(120); // 200g yogurt, not breakfast yogurt
  expect(getMenuNutrition("5")?.calories).toBe(0); // explicit zero, not missing
  for (const id of ["83", "84", "86", "87", "88", "89", "35", "90", "201", "39", "unknown"]) {
    expect(getMenuNutrition(id), id).toBeNull();
  }
});

test("homepage dishes display the same calories as the full menu", async ({ page }) => {
  await page.goto("/");
  const calories = page.locator("#meals .menu-calories");
  await expect(calories).toHaveCount(6);
  expect(await calories.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-calories"))))
    .toEqual(["410", "210", "380", "415", "420", "260"]);
  await expect(calories.first()).toContainText("سعرة حرارية");
  await expect(page.locator("#faq")).toContainText("السعرات التقريبية");
});

test("changing dish weight never reuses or scales a different portion's calories", async ({ page }) => {
  await page.goto("/menu");
  await page.getByRole("button", { name: "تفاصيل سالمون 100 جرام", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "سالمون", exact: true });
  await expect(dialog.locator(".menu-calories")).toHaveAttribute("data-calories", "210");
  await expect(dialog.locator(".menu-calories")).toContainText("100 جم");
  await dialog.getByRole("button", { name: "200 جم", exact: true }).click();
  await expect(dialog.locator(".menu-calories")).toHaveCount(0);
  await expect(dialog.locator(".menu-calories-missing")).toContainText("السعرات غير متوفرة");
  await expect(dialog.locator(".menu-detail-purchase-row")).toContainText(/(?:59|٥٩)/);
  await dialog.getByRole("button", { name: "100 جم", exact: true }).click();
  await expect(dialog.locator(".menu-calories")).toHaveAttribute("data-calories", "210");
});

test("a zero-calorie drink remains visible without turning an unknown food into zero", async ({ page }) => {
  await page.goto("/menu");
  await page.getByRole("searchbox", { name: "ابحث عن صنف" }).fill("مياه عاديه");
  const card = page.locator(".menu-product-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".menu-calories")).toHaveAttribute("data-calories", "0");
  await card.getByRole("button").click();
  await expect(page.getByRole("dialog").locator(".menu-calories")).toHaveAttribute("data-calories", "0");
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await page.getByRole("searchbox", { name: "ابحث عن صنف" }).fill("وجبة بيض مسلوق");
  await expect(card.locator(".menu-calories")).toHaveCount(0);
  await expect(card.locator(".menu-calories-missing")).toBeVisible();
});

for (const width of [320, 390, 1440]) {
  test(`calorie labels fit the menu and home cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/menu");
    const first = page.locator(".menu-product-card").first();
    await expect(first.locator(".menu-calories")).toHaveAttribute("data-calories", "410");
    const fits = await first.locator(".menu-calories").evaluate(node => {
      const label = node.getBoundingClientRect();
      const card = node.closest("article")!.getBoundingClientRect();
      return label.left >= card.left && label.right <= card.right;
    });
    expect(fits).toBe(true);
    await first.getByRole("button").click();
    await expect(page.getByRole("dialog").locator(".menu-calories")).toHaveAttribute("data-calories", "410");
    await page.screenshot({ path: `test-results/nutrition-detail-${width}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
    await page.goto("/");
    for (const label of await page.locator("#meals .menu-calories").all()) {
      expect(await label.evaluate(node => {
        const a = node.getBoundingClientRect();
        const b = node.closest("figure")!.getBoundingClientRect();
        return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
      })).toBe(true);
    }
    await page.locator("#meals").screenshot({ path: `test-results/nutrition-gallery-${width}.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

import { expect, test } from "@playwright/test";
import { homepageFeaturedMenuIds } from "../components/MealGallery";
import { menuPreviewItems } from "../lib/menu-preview-items";

test("home meal teaser uses the exact cashier menu data, not a separate static catalog", async ({ page }) => {
  const featured = homepageFeaturedMenuIds.map(id => menuPreviewItems.find(item => item.id === id));
  expect(featured).toHaveLength(6);
  expect(featured.every(item => Boolean(item && item.image && item.priceSar > 0))).toBe(true);
  expect(featured.some(item => item?.name.includes("ستيك"))).toBe(false);

  await page.goto("/");
  const cards = page.locator("#meals .meal-card");
  await expect(cards).toHaveCount(6);
  await expect(page.locator("#meals .meal-soon-ribbon")).toHaveCount(0);
  for (const [index, item] of featured.entries()) {
    expect(item).toBeDefined();
    const card = cards.nth(index);
    await expect(card).toContainText(item!.name);
    await expect(card.locator(".meal-card-price")).toBeVisible();
    await expect(card.locator(".meal-card-price")).toContainText("ر.س");
    const image = card.locator("img");
    await expect(image).toHaveAttribute("alt", item!.name);
  }
});

test("view-more in the homepage gallery opens the full menu, and the logo returns home", async ({ page }) => {
  await page.goto("/");
  const galleryLink = page.locator("#meals .food-link--menu");
  await expect(galleryLink).toHaveAttribute("href", "/menu");
  await expect(galleryLink).toContainText("مشاهدة المزيد");
  await galleryLink.click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page.locator("#menu-products")).toBeAttached();
  await expect(page.locator("#menu-plans")).toBeAttached();
  await expect(page.locator("#menu-download")).toBeAttached();
  await expect(page.locator(".site-header .brand")).toHaveAttribute("href", "/");
  await page.locator(".site-header .brand").click();
  await expect(page).toHaveURL(/\/$/);
});

test("one canonical menu link is present in hero, header, gallery, plans and footer", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('.site-header .desktop-nav a[href="/menu"]')).toHaveCount(1);
  await expect(page.locator('.hero-cinema-actions a[href="/menu#menu-products"]')).toHaveCount(1);
  await expect(page.locator('#meals .food-link[href="/menu"]')).toHaveCount(1);
  await expect(page.locator('#plans a[href^="/menu?"]')).toHaveCount(1);
  await expect(page.locator('.footer-nav a[href="/menu"]')).toHaveCount(1);
});

for (const width of [320, 390, 768, 1440]) {
  test(`home-to-menu integration has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator("#meals .food-footer .food-link--menu")).toBeVisible();
    await expect(page.locator(".hero-cinema-actions a[href="/menu#menu-products"]")).toBeVisible();
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
    const dimensions = await page.locator("#meals .food-footer .food-link--menu").boundingBox();
    expect(dimensions).not.toBeNull();
    expect(dimensions!.x).toBeGreaterThanOrEqual(-1);
    expect(dimensions!.x + dimensions!.width).toBeLessThanOrEqual(width + 1);
  });
}

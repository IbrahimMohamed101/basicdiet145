import { expect, test } from "@playwright/test";

test("mobile homepage displays its high-priority poster instead of the cinematic video", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const poster = page.locator(".hero-cinema-mobile-poster");
  await expect(poster).toBeVisible();
  await expect(poster).toHaveAttribute("loading", "eager");
  await expect(poster).toHaveAttribute("fetchpriority", "high");
  await expect(page.locator(".hero-cinema-video")).toBeHidden();
});

test("menu prioritizes visible featured images without fetching homepage film poster", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu", { waitUntil: "domcontentloaded" });

  const cards = page.locator(".menu-featured-card img");
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toHaveAttribute("loading", "eager");
  await expect(cards.nth(0)).toHaveAttribute("fetchpriority", "high");
  await expect(cards.nth(1)).toHaveAttribute("loading", "eager");
  await expect(cards.nth(2)).toHaveAttribute("loading", "lazy");
  await expect(page.locator('link[rel="preload"][as="image"][href*="hero-poster"]')).toHaveCount(0);
});

test("prices page does not preload the homepage film poster", async ({ page }) => {
  await page.goto("/jeddah/subscription-prices", { waitUntil: "domcontentloaded" });
  await expect(page.locator('link[rel="preload"][as="image"][href*="hero-poster"]')).toHaveCount(0);
});

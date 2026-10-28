import { expect, test } from "@playwright/test";

for (const width of [320, 375, 390, 430]) {
  test("custom meal builder remains usable at mobile width " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    const builder = page.locator("#menu-custom");
    const editor = builder.locator(".menu-builder-editor");

    await expect(editor.locator(".menu-option-photo-button")).toHaveCount(25);
    await expect(editor.locator(".menu-meal-protein-tabs button")).toHaveCount(4);
    await expect(editor.locator(".menu-mobile-selection-status")).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);

    const proteinChoice = editor.locator(".menu-option-photo-button").filter({ hasText: "دجاج سبايسي" });
    await proteinChoice.click();
    await expect(proteinChoice).toHaveAttribute("aria-pressed", "true");
    await expect(editor.locator(".menu-mobile-selection-status")).toContainText("دجاج سبايسي");

    const tabs = editor.getByRole("group", { name: "تصفية أنواع البروتين" });
    await tabs.getByRole("button", { name: "اللحم" }).click();
    await expect(editor.locator(".menu-option-block").first().locator(".menu-option-photo-button")).toHaveCount(3);
    await tabs.getByRole("button", { name: "الكل" }).click();

    const sides = editor.locator(".menu-option-block").nth(1);
    const byName = (name: string) => sides.locator(".menu-option-photo-button").filter({ hasText: name });
    await byName("رز أبيض").click();
    await byName("بطاطس مهروسة").click();
    await byName("خضار مشكل مشوي").click();

    // Choosing a third side swaps the oldest one; alternatives should never become disabled.
    await expect(byName("رز أبيض")).toHaveAttribute("aria-pressed", "false");
    await expect(byName("بطاطس مهروسة")).toHaveAttribute("aria-pressed", "true");
    await expect(byName("خضار مشكل مشوي")).toHaveAttribute("aria-pressed", "true");
    await expect(sides.locator("button:disabled")).toHaveCount(0);
    await expect(editor.locator(".menu-mobile-selection-status")).toContainText("2 / 2");

    // Sticky feedback and promo bar should not overlap the food options.
    await editor.locator(".menu-option-block").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 320));
    await expect.poll(() => editor.locator(".menu-mobile-selection-status").evaluate(
      el => Math.round(el.getBoundingClientRect().top)
    )).toBeGreaterThanOrEqual(72);
    await expect(page.locator(".bd-offer-mobile-bar")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);

    await editor.getByRole("link", { name: /الملخص/ }).click();
    await expect(builder.locator("#menu-builder-summary")).toBeInViewport();
    await expect(builder.locator(".menu-summary-data")).toContainText("خضار مشكل مشوي");
  });
}

import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`coming-soon pizza and coconut cards render without ordering at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });

    const section = page.locator("#menu-coming-soon");
    await section.scrollIntoViewIfNeeded();

    await expect(section.getByRole("heading", { name: "قريبًا في بيسك دايت" })).toBeVisible();
    await expect(section.locator(".menu-coming-soon-card")).toHaveCount(2);
    await expect(section.getByRole("heading", { name: "كوكونت", exact: true })).toBeVisible();
    await expect(section.getByRole("heading", { name: "بيتزا", exact: true })).toBeVisible();
    await expect(section).toContainText("بدون عجين");
    await expect(section).toContainText("البطاطس والبيض");
    for (const protein of ["الدجاج", "اللحم", "الجمبري", "السمك"]) {
      await expect(section).toContainText(protein);
    }

    // Prelaunch editorial teaser only: no price, interactive choice or order action.
    await expect(section.getByRole("button")).toHaveCount(0);
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section).not.toContainText(/ريال|سعرة حرارية/);
    await expect(section.locator("img")).toHaveCount(2);
    for (const image of await section.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
  });
}

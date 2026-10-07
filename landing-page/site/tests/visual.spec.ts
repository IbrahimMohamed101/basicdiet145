import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const cases = [
  { name: "desktop-1440", width: 1440, height: 1100 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-320", width: 320, height: 720 },
] as const;

for (const current of cases) {
  test(current.name, async ({ page }) => {
    await page.setViewportSize({
      width: current.width,
      height: current.height,
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /وجبات تحبها/,
      }),
    ).toBeVisible();

    await expect(page.locator("#meals")).toBeAttached();
    await expect(page.locator("#how-it-works")).toBeAttached();
    await expect(page.locator("#app")).toBeAttached();
    await expect(page.locator("#plans")).toBeAttached();
    await expect(page.locator("#faq")).toBeAttached();

    const overflow = await page.evaluate(() => {
      const clientWidth = document.documentElement.clientWidth;
      const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className:
              typeof element.className === "string" ? element.className : "",
            left: Math.round(rect.left * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
          };
        })
        .filter(
          (item) =>
            item.width > 0 &&
            (item.left < -1 || item.right > clientWidth + 1),
        )
        .slice(0, 24);

      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth,
        offenders,
      };
    });

    expect(
      overflow.scrollWidth,
      `horizontal overflow at ${current.width}px: ${JSON.stringify(
        overflow.offenders,
      )}`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    if (current.width <= 390) {
      await expect(
        page.getByRole("button", { name: "ابدأ اشتراكك" }).first(),
      ).toBeVisible();

      await expect(page.locator(".desktop-nav")).toBeHidden();
    }

    await mkdir("artifacts", { recursive: true });
    await page.screenshot({
      path: `artifacts/${current.name}.png`,
      fullPage: true,
    });
  });
}

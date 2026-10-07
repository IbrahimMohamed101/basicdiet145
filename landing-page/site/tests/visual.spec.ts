import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const cases = [
  { name: "desktop-1440", width: 1440, height: 1100 },
  { name: "desktop-1024", width: 1024, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-360", width: 360, height: 640 },
  { name: "mobile-320", width: 320, height: 720 },
] as const;

for (const current of cases) {
  test(current.name, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") browserErrors.push(message.text());
    });
    await page.setViewportSize({
      width: current.width,
      height: current.height,
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    expect(browserErrors).toEqual([]);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /وجبات تحبها/,
      }),
    ).toBeVisible();

    await expect(page.locator("#meals")).toBeAttached();

    const mealImages = page.locator("#meals .meal-card img");
    await expect(mealImages).toHaveCount(6);

    const brokenMealImages = await mealImages.evaluateAll((images) =>
      images
        .map((image) => image as HTMLImageElement)
        .filter((image) => !image.complete || image.naturalWidth < 40)
        .map((image) => image.getAttribute("src")),
    );

    expect(
      brokenMealImages,
      `broken meal images: ${JSON.stringify(brokenMealImages)}`,
    ).toEqual([]);

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

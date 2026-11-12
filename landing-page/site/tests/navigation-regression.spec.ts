import { expect, test, type Page } from "@playwright/test";
import { isolateInstagram } from "./helpers";

// These are focused reproductions of the real navigation/accessibility failures
// found in A1+A2 extended CI. The screenshot is attached BEFORE each assertion.
async function attachSnapshot(page: Page, label: string) {
  await test.info().attach(label, {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}

for (const width of [390, 1440]) {
  test(`keyboard skip link is first focus target at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await isolateInstagram(page);
    await page.goto("/", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press("Tab");
    await attachSnapshot(page, `skip-link-before-${width}`);
    await test.info().attach("focused-element", {
      body: JSON.stringify(await page.evaluate(() => ({
        activeTag: document.activeElement?.tagName,
        activeHtml: document.activeElement?.outerHTML.slice(0, 400),
      })), null, 2),
      contentType: "application/json",
    });
    await expect(page.locator(".skip-link")).toBeFocused();
  });

  test(`navbar anchors and aria-current agree at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await isolateInstagram(page);
    await page.goto("/", { waitUntil: "load" });
    for (const id of ["plans", "app", "how-it-works"]) {
      if (width < 981) {
        await page.getByRole("button", { name: "فتح القائمة" }).click();
      }
      const nav = page.locator(width < 981 ? ".nav-sheet nav" : ".desktop-nav");
      await nav.locator(`a[href="#${id}"]`).click();
      await attachSnapshot(page, `anchor-${id}-before-${width}`);
      const metrics = () => page.locator(`#${id}`).evaluate(target => ({
        sectionTop: target.getBoundingClientRect().top,
        headerBottom: document.querySelector(".nav-shell")!.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight,
      }));
      await test.info().attach(`anchor-${id}-metrics`, {
        body: JSON.stringify(await metrics(), null, 2),
        contentType: "application/json",
      });
      await expect.poll(async () => {
        const { sectionTop, headerBottom, viewportHeight } = await metrics();
        return sectionTop >= headerBottom - 2 && sectionTop < viewportHeight / 2;
      }).toBe(true);
      await expect(page.locator(`.desktop-nav a[href="#${id}"]`)).toHaveAttribute("aria-current", "location");
    }
  });
}

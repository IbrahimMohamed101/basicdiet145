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

test("global skip target adapts to menu and has a valid non-header fallback", async ({ page }) => {
  await page.goto("/menu", { waitUntil: "load" });
  await expect(page.locator('body > a.skip-link[data-global-skip]')).toHaveAttribute("href", "#menu-main");
  await expect(page.locator("main#menu-main")).toHaveCount(1);
  await page.goto("/privacy", { waitUntil: "load" });
  await expect(page.locator('body > a.skip-link[data-global-skip]')).toHaveAttribute("href", "#content-start");
  await expect(page.locator("main#content-start")).toHaveCount(1);
});

// The server HTML must make skipping the header work without hydration.
test("no-JS skip link targets actual content after the header", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 800 } });
  try {
    const page = await context.newPage();
    for (const path of ["/", "/menu", "/privacy"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const skip = page.locator('body > a.skip-link[data-global-skip]');
      await expect(skip).toHaveAttribute("href", "#content-start");
      await expect(page.locator("#content-start")).toHaveCount(1);
      const geometry = await page.evaluate(() => {
        const header = document.querySelector("header.site-header");
        const target = document.getElementById("content-start")!;
        return {
          target: target.tagName.toLowerCase(),
          headerExists: Boolean(header),
          targetIsAfterHeader: header
            ? Boolean(header.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
            : target.tagName === "MAIN",
          headerBottom: header?.getBoundingClientRect().bottom ?? null,
          targetTop: target.getBoundingClientRect().top,
        };
      });
      await test.info().attach(`no-js-skip-${path.replaceAll("/", "-") || "home"}-geometry.json`, {
        body: JSON.stringify(geometry, null, 2), contentType: "application/json",
      });
      expect(geometry.targetIsAfterHeader).toBe(true);
      await skip.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#content-start$/);
    }
  } finally {
    await context.close();
  }
});

for (const width of [390, 1440]) {
  test(`smooth anchor navigation keeps #plans clear of header at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await isolateInstagram(page);
    await page.goto("/", { waitUntil: "load" });
    if (width < 981) await page.getByRole("button", { name: "فتح القائمة" }).click();
    const nav = page.locator(width < 981 ? ".nav-sheet nav" : ".desktop-nav");
    await nav.locator('a[href="#plans"]').click();
    const metrics = () => page.locator("#plans").evaluate((section) => ({
      sectionTop: section.getBoundingClientRect().top,
      headerBottom: document.querySelector(".nav-shell")!.getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
      sectionHeight: section.getBoundingClientRect().height,
      isPlaceholder: section.getAttribute("aria-busy") === "true",
      scrollY,
      motion: matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference",
    }));
    await test.info().attach(`smooth-plans-initial-${width}.json`, {
      body: JSON.stringify(await metrics(), null, 2), contentType: "application/json",
    });
    try {
      await expect.poll(async () => {
        const { sectionTop, headerBottom, viewportHeight } = await metrics();
        return sectionTop >= headerBottom - 2 && sectionTop < viewportHeight / 2;
      }, { timeout: 20_000 }).toBe(true);
    } catch (error) {
      await test.info().attach(`smooth-plans-failure-${width}.json`, {
        body: JSON.stringify(await metrics(), null, 2), contentType: "application/json",
      });
      await attachSnapshot(page, `smooth-plans-failure-${width}`);
      throw error;
    }
  });
}

for (const width of [390, 1024, 1440]) {
  test(`keyboard skip link is first focus target at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await isolateInstagram(page);
    await page.goto("/", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press("Tab");
    await attachSnapshot(page, `skip-link-before-${width}`);
    const focusState = await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName,
      activeHtml: document.activeElement?.outerHTML.slice(0, 400),
    }));
    await test.info().attach("focused-element", {
      body: JSON.stringify(focusState, null, 2),
      contentType: "application/json",
    });
    await expect(page.locator('body > a.skip-link[data-global-skip]')).toBeFocused();
  });

  test(`keyboard order keeps consent before header and allows dismissal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.removeItem("basicdiet_meta_pixel_consent_v1"));
    await isolateInstagram(page);
    await page.goto("/", { waitUntil: "load" });

    const skip = page.locator('body > a.skip-link[data-global-skip]');
    const consent = page.getByRole("complementary", { name: "تفضيلات ملفات الارتباط والإعلانات" });
    const privacy = consent.getByRole("link", { name: "تفاصيل الخصوصية" });
    const accept = consent.getByRole("button", { name: "السماح بالتتبع" });
    const decline = consent.getByRole("button", { name: "رفض التتبع" });

    await expect(consent).toBeVisible();
    await expect(page.locator("a.skip-link:visible")).toHaveCount(1);
    await expect(skip).toHaveAttribute("href", "#main");
    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    for (const control of [privacy, accept, decline, page.locator(".brand")]) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
    }

    await page.keyboard.press("Shift+Tab");
    await expect(decline).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(consent).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("basicdiet_meta_pixel_consent_v1"))).toBe("declined");
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
      const navMetrics = await metrics();
      await test.info().attach(`anchor-${id}-metrics`, {
        body: JSON.stringify(navMetrics, null, 2),
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

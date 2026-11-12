import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { isolateInstagram, stubPlanCatalog } from "./helpers";

const viewports = [
  { width: 1920, height: 1080 }, { width: 1536, height: 864 },
  { width: 1440, height: 900 }, { width: 1280, height: 800 },
  { width: 1024, height: 768 }, { width: 768, height: 1024 },
  { width: 430, height: 932 }, { width: 390, height: 844 },
  { width: 375, height: 812 }, { width: 360, height: 800 },
  { width: 320, height: 720 },
];
const sections = [".hero", "#app", "#meals", ".bd-service-clarity", "#how-it-works", "#reels", "#plans", "#faq", ".final-cta", ".footer"];

async function checkMeals(page: Page) {
  const cards = page.locator("#meals .meal-card");
  await expect(cards).toHaveCount(6);
  for (const card of await cards.all()) {
    await card.evaluate(e => e.scrollIntoView({ behavior: "instant", block: "center", inline: "center" }));
    const img = card.locator("img");
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 40), { timeout: 60_000, message: "Real proxy-backed meal must decode" }).toBe(true);
    const geometry = await card.evaluate(e => {
      const c = e.getBoundingClientRect(), i = e.querySelector("img")!.getBoundingClientRect(), w = e.querySelector(".meal-image-wrap")!.getBoundingClientRect();
      return { card: c.height, image: i.height, wrap: w.height, width: i.width, difference: Math.abs(c.height - i.height) };
    });
    expect(geometry.card).toBeGreaterThan(200);
    expect(geometry.image).toBeGreaterThan(200);
    expect(geometry.wrap).toBeGreaterThan(200);
    expect(geometry.width).toBeGreaterThan((await page.viewportSize())!.width <= 640 ? 130 : 200);
    expect(geometry.difference).toBeLessThan(2);
    await expect(img).toBeInViewport();
  }
  const overlaps = await cards.evaluateAll(es => {
    const rs = es.map(e => e.getBoundingClientRect());
    return rs.some((a, i) => rs.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
  });
  expect(overlaps).toBe(false);
}

for (const viewport of viewports) {
  test(`full page RTL ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => {
      if (["error", "warning"].includes(m.type())) {
        errors.push(`${m.text()} [console-location-url=${m.location().url || "unknown"}]`);
      }
    });
    page.on("response", response => {
      if (response.status() === 503) {
        console.log("[DIAGNOSTIC_503_RESPONSE]", response.status(), response.url());
      }
    });
    await isolateInstagram(page);
    await stubPlanCatalog(page);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    for (const selector of sections) {
      await expect(page.locator(selector)).toBeVisible();
      await page.locator(selector).evaluate(e => e.scrollIntoView({ behavior: "instant", block: "start" }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), selector).toBeLessThanOrEqual(1);
    }
    for (const selector of ["#app", ".final-cta", ".footer"]) {
      await expect(page.locator(`${selector} a[href*="apps.apple.com"]`)).toHaveCount(1);
      await expect(page.locator(`${selector} a[href*="play.google.com/store/apps/details?id=com.app.basic_diet"]`)).toHaveCount(1);
    }
    // Every in-document navigation link resolves to an actual section/target.
    const missing = await page.locator('a[href^="#"]').evaluateAll(es => es.filter(e => !document.getElementById(e.getAttribute("href")!.slice(1))).map(e => e.getAttribute("href")));
    expect(missing).toEqual([]);
    await checkMeals(page);
    // A1 integration CI: the current FAQ component renders seven question items.
    await expect(page.locator(".faq-item")).toHaveCount(7);
    expect(errors).toEqual([]);
    await mkdir("../../.audit/refinement/final", { recursive: true });
    await page.screenshot({ path: `../../.audit/refinement/final/${viewport.width}-full.png`, fullPage: true });
  });
}

for (const zoom of [0.8, 0.9, 1, 1.1, 1.25]) {
  test(`meal layout at browser zoom equivalent ${Math.round(zoom * 100)}%`, async ({ browser }) => {
    test.setTimeout(150_000);
    // Desktop browser zoom changes CSS viewport and device pixel ratio together.
    // Keep a 1440x900 physical surface and reproduce both, not CSS transform/pinch zoom.
    const context = await browser.newContext({ viewport: { width: Math.round(1440 / zoom), height: Math.round(900 / zoom) }, deviceScaleFactor: zoom, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      await isolateInstagram(page);
    await stubPlanCatalog(page);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await checkMeals(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator("#meals").screenshot({ path: `../../.audit/refinement/final/zoom-${Math.round(zoom * 100)}.png` });
    } finally { await context.close(); }
  });
}

test("home calculator day, grams and fulfillment controls work with keyboard", async ({ page }) => {
  // Use the same canonical fixture as the non-analytics navigation/visual tests.
  await stubPlanCatalog(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#plans").scrollIntoViewIfNeeded();
  const controls = page.locator("#plans .bd-calculator-controls");
  await expect(controls).toBeVisible();

  const days = controls.locator(".bd-calculator-durations button");
  await expect(days).toHaveCount(3);
  for (const [index, expected] of ["7", "26", "30"].entries()) {
    await expect(days.nth(index)).toContainText(expected);
  }
  await expect(days.nth(1)).toBeEnabled();
  await days.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(days.nth(1)).toHaveAttribute("aria-pressed", "true");

  const grams = controls.locator("fieldset").nth(1).locator("button");
  await expect(grams).toHaveText(["100 جم", "150 جم", "200 جم"]);
  await expect(grams.nth(1)).toBeEnabled();
  await grams.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(grams.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#plans .bd-calculator-summary-title")).toContainText("26 يوم · 150 جم");

  const pickup = controls.getByRole("button", { name: "استلام", exact: true });
  await pickup.focus();
  await page.keyboard.press("Enter");
  await expect(pickup).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#plans .bd-calculator-specs")).toContainText("استلام");
});

test("Reels defer requests and support contained mobile scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await isolateInstagram(page);
    await stubPlanCatalog(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#reels iframe")).toHaveCount(0);
  const cards = page.locator(".reel-card");
  await expect(cards).toHaveCount(4);
  for (const card of await cards.all()) {
    await card.evaluate(e => e.scrollIntoView({ behavior: "instant", inline: "center", block: "center" }));
    await expect(card.locator("iframe")).toHaveCount(1);
    await expect(card.locator("iframe")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  }
  await expect(page.locator('.reels-profile-link')).toHaveAttribute("href", "https://www.instagram.com/basicdiet.sa/");
  const actual = await page.locator("#reels iframe").evaluateAll(es => es.map(e => e.getAttribute("src")));
  expect(actual).toEqual(["DTLby6gDBgM", "DZk2kKqoAJA", "DXulBRdCB7X", "DX2N3EgIvVM"].map(id => `https://www.instagram.com/reel/${id}/embed/`));
});

test("FAQ and download links work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  try {
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const item = page.locator(".faq-item").first();
    await item.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(item).toHaveAttribute("open", "");
    await expect(item.locator("p")).toBeVisible();
    await expect(page.locator(".final-cta .app-store-button")).toHaveCount(2);
    await expect(page.locator(".reel-card-foot a")).toHaveCount(4);
    await expect(page.locator(".flexibility-receipt")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  } finally { await context.close(); }
});

// Prevent mobile cover/scale regressions without changing the cinematic desktop hero.
// A0 STALE_TEST: the mobile experience deliberately hides the video in favor of an image LCP.
for (const viewport of [{ width: 320, height: 720 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 640, height: 720 }]) {
  test(`mobile Hero displays uncropped image poster at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".hero-cinema-video")).toBeHidden();
    const poster = page.locator(".hero-cinema-mobile-poster");
    await expect(poster).toBeVisible();
    const geometry = await poster.evaluate((image) => {
      const posterBox = image.getBoundingClientRect();
      const titleBox = document.querySelector(".hero-cinema-title")!.getBoundingClientRect();
      return {
        width: posterBox.width,
        height: posterBox.height,
        posterBottom: posterBox.bottom,
        titleTop: titleBox.top,
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.width / geometry.height).toBeCloseTo(16 / 9, 1);
    expect(geometry.posterBottom).toBeLessThan(geometry.titleTop);
    expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
  });
}

test("desktop Hero keeps its full-height cinematic cover video", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const fit = await page.locator(".hero-cinema-video").evaluate(video => getComputedStyle(video).objectFit);
  expect(fit).toBe("cover");
});


test("mobile app presentation prioritizes the phone, followed by two visible download links", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const positions = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const copy = box(".app-reveal-copy");
    const stage = box(".app-reveal-stage");
    const download = box(".app-reveal-download");
    const buttons = Array.from(document.querySelectorAll("#app .app-store-button")).map((e) => e.getBoundingClientRect());
    return { copyBottom: copy.bottom, stageTop: stage.top, stageBottom: stage.bottom, downloadTop: download.top, buttonWidths: buttons.map(e => e.width), buttonTops: buttons.map(e => e.top), documentWidth: document.documentElement.scrollWidth };
  });
  expect(positions.copyBottom).toBeLessThan(positions.stageTop);
  expect(positions.stageBottom).toBeLessThan(positions.downloadTop);
  expect(positions.buttonWidths).toHaveLength(2);
  expect(positions.buttonWidths.every(w => w > 125)).toBe(true);
  expect(Math.abs(positions.buttonTops[0] - positions.buttonTops[1])).toBeLessThan(2);
  expect(positions.documentWidth).toBeLessThanOrEqual(321);
});

test("mobile meals use a contained editorial grid, desktop keeps its twelve-column layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  let layout = await page.locator(".meal-showcase").evaluate(e => ({
    display: getComputedStyle(e).display,
    columns: getComputedStyle(e).gridTemplateColumns.split(" ").length,
    cards: Array.from(e.querySelectorAll(".meal-card")).map(c => { const r = c.getBoundingClientRect(); return { width: r.width, top: r.top, right: r.right }; }),
  }));
  expect(layout.display).toBe("grid");
  expect(layout.columns).toBe(2);
  expect(layout.cards[0].width).toBeGreaterThan(layout.cards[1].width * 1.8);
  expect(Math.abs(layout.cards[1].top - layout.cards[2].top)).toBeLessThan(2);
  await page.setViewportSize({ width: 1440, height: 900 });
  layout = await page.locator(".meal-showcase").evaluate(e => ({
    display: getComputedStyle(e).display,
    columns: getComputedStyle(e).gridTemplateColumns.split(" ").length,
    cards: Array.from(e.querySelectorAll(".meal-card")).map(c => { const r = c.getBoundingClientRect(); return { width: r.width, top: r.top, right: r.right }; }),
  }));
  expect(layout.display).toBe("grid");
  expect(layout.columns).toBe(12);
});

test("home calculator preserves honest fallback when plan-catalog responds 503", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ status: false, data: [], code: "UNAVAILABLE" }),
  }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#plans").scrollIntoViewIfNeeded();
  await expect(page.locator("#plans .bd-calculator-price")).toContainText("تعذّر تحميل الأسعار");
  await page.locator("#plans .bd-calculator-primary").click();
  await expect(page.getByRole("dialog", { name: "خصم 15% على اشتراكك" })).toBeVisible();
});

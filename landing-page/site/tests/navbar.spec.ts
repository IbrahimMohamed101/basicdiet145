import { isolateInstagram } from "./helpers";
import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const widths = [360, 390, 430, 768, 1024, 1440];
const targets = ["meals", "how-it-works", "app", "plans", "faq"];
const output = "../../.audit/refinement/final/navbar";
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("body *")).map(e => {
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, cls: typeof e.className === "string" ? e.className.slice(0, 80) : "", left: Math.round(r.left), right: Math.round(r.right), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth };
    });
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      rightOverflow: elements.filter(e => e.right > innerWidth + 2).sort((a, b) => b.right - a.right).slice(0, 18),
      internalOverflow: elements.filter(e => e.scrollWidth > e.clientWidth + 80).sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth)).slice(0, 12) };
  });
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
}
for (const width of widths) {
  test(`navbar RTL ${width}: anchors, keyboard, modal and scroll lock`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
    await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
    await isolateInstagram(page);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await noOverflow(page);
    await mkdir(output, { recursive: true });
    await page.screenshot({ animations: "disabled", path: `${output}/${width}-top.png` });
    const mobile = width < 981;
    const toggle = page.getByRole("button", { name: "فتح القائمة" });
    if (mobile) {
      const box = await toggle.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await toggle.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "التنقل الرئيسي" });
      await expect(dialog).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const close = dialog.getByRole("button", { name: "إغلاق القائمة" });
      const cta = dialog.getByRole("button", { name: "اسأل المطعم" });
      await expect(close).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(cta).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await expect(page.locator(".mobile-sticky-cta")).toHaveCount(0);
      await page.screenshot({ animations: "disabled", path: `${output}/${width}-open.png` });
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await page.mouse.click(2, 2);
      await expect(toggle).toBeFocused();
      await expect(page.locator("#mobile-menu")).not.toHaveAttribute("open", "");
      await page.locator("#meals").evaluate(e => e.scrollIntoView({ behavior: "instant" }));
      const before = await page.locator("#meals").boundingBox();
      const y = await page.evaluate(() => scrollY);
      await toggle.click();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
      await page.mouse.move(2, 2);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => scrollY)).toBe(y);
      expect(await page.locator("#meals").boundingBox()).toEqual(before);
      await page.keyboard.press("Escape");
    }
    for (const id of targets) {
      if (mobile) await toggle.click();
      await page.locator(`${mobile ? ".nav-sheet nav" : ".desktop-nav"} a[href="#${id}"]`).click();
      await expect.poll(() => page.locator(`#${id}`).evaluate(e => {
        const top = e.getBoundingClientRect().top;
        return top >= document.querySelector(".nav-shell")!.getBoundingClientRect().bottom && top < innerHeight / 2;
      })).toBe(true);
      await expect(page.locator(`.desktop-nav a[href="#${id}"]`)).toHaveAttribute("aria-current", "location");
      await expect(page.locator("#mobile-menu")).not.toHaveAttribute("open", "");
      await noOverflow(page);
    }
    await page.locator(".brand").click();
    await expect(page.locator(".nav-shell")).not.toHaveClass(/scrolled/);
    await expect(page.locator(".desktop-nav [aria-current]")).toHaveCount(0);
    await page.locator("#app").evaluate(e => e.scrollIntoView({ behavior: "instant" }));
    await expect(page.locator(".nav-shell")).toHaveClass(/scrolled/);
    await page.screenshot({ animations: "disabled", path: `${output}/${width}-scrolled.png` });
    expect(errors).toEqual([]);
  });
  for (const mode of ["reduced", "no-animation", "no-js"] as const) {
    test(`navbar ${width} ${mode}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: width === 360 ? 640 : 900 }, javaScriptEnabled: mode !== "no-js", reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", m => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
      await isolateInstagram(page);
    await page.goto("/");
      if (mode === "no-animation") await page.evaluate(() => { document.documentElement.dataset.motion = "off"; });
      await noOverflow(page);
      if (mode === "no-js") {
        await expect(page.locator(".nav-fallback a")).toHaveCount(6);
        await expect(page.locator(".nav-fallback")).toBeVisible();
        await expect(page.getByRole("button", { name: "فتح القائمة" })).toHaveCount(0);
        await page.locator('.nav-fallback a[href="#meals"]').click();
        await expect(page).toHaveURL(/#meals$/);
      } else {
        expect(await page.locator(".nav-shell").evaluate(e => getComputedStyle(e).transitionDuration)).toBe("0s");
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
        if (width < 981) {
          await page.getByRole("button", { name: "فتح القائمة" }).click();
          await expect(page.getByRole("dialog")).toBeVisible();
          expect(await page.locator(".nav-sheet").evaluate(e => getComputedStyle(e).transitionDuration)).toBe("0s");
        }
      }
      await noOverflow(page);
      await mkdir(output, { recursive: true });
      await page.screenshot({ animations: "disabled", path: `${output}/${width}-${mode}.png` });
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("navbar short landscape and 200% text remain reachable", async ({ page }) => {
  for (const viewport of [{ width: 844, height: 390 }, { width: 360, height: 640 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await isolateInstagram(page);
    await page.goto("/");
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await noOverflow(page);
    const header = await page.locator(".nav-shell").boundingBox();
    for (const control of await page.locator(".nav-shell a:visible, .nav-shell button:visible").all()) {
      const rect = await control.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(header!.x);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(header!.x + header!.width + 1);
    }
    if (viewport.width < 981) {
      await page.getByRole("button", { name: "فتح القائمة" }).click();
      const cta = page.getByRole("dialog").getByRole("link", { name: "حمّل التطبيق" });
      await cta.focus();
      await expect(cta).toBeInViewport();
      await page.screenshot({ animations: "disabled", path: `${output}/${viewport.width}-text-200-open.png` });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await expect.poll(() => page.locator("#app").evaluate(e => e.getBoundingClientRect().top >= document.querySelector(".nav-shell")!.getBoundingClientRect().bottom)).toBe(true);
    }
    await page.screenshot({ animations: "disabled", path: `${output}/${viewport.width}-text-200.png` });
  }
});

test("navbar resize closes modal and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await isolateInstagram(page);
    await page.goto("/");
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".brand")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
});

test("navbar CPU 4x keyboard CTA preserves event and unlocks before scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await isolateInstagram(page);
    await page.goto("/");
  await page.evaluate(() => { window.addEventListener("basicdiet:cta", e => { document.documentElement.dataset.cta = JSON.stringify((e as CustomEvent).detail); }); });
  await page.getByRole("button", { name: "فتح القائمة" }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("dialog").getByRole("link", { name: "حمّل التطبيق" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-cta", JSON.stringify({ location: "header", platform: "desktop", intent: "download" }));
  await expect.poll(() => page.locator("#app").evaluate(e => Math.abs(e.getBoundingClientRect().top - 112) < 2)).toBe(true);
  await session.detach();
});

test("navbar desktop keyboard, focus outline and stable layout on scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await isolateInstagram(page);
    await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".brand")).toBeFocused();
  for (const id of targets) {
    await page.keyboard.press("Tab");
    const link = page.locator(`.desktop-nav a[href="#${id}"]`);
    await expect(link).toBeFocused();
    expect(await link.evaluate(e => getComputedStyle(e).outlineStyle)).toBe("solid");
  }
  await page.waitForTimeout(600);
  const shifts = await page.evaluate(async () => {
    let total = 0;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) total += (entry as PerformanceEntry & { value: number }).value;
    });
    observer.observe({ type: "layout-shift" });
    const initial = document.querySelector("main")!.getBoundingClientRect().height;
    window.scrollTo({ top: 80, behavior: "instant" });
    await new Promise(resolve => setTimeout(resolve, 400));
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise(resolve => setTimeout(resolve, 400));
    observer.disconnect();
    return { total, initial, final: document.querySelector("main")!.getBoundingClientRect().height };
  });
  expect(shifts.total).toBe(0);
  expect(shifts.final).toBe(shifts.initial);
  await page.locator("#meals").evaluate(e => e.scrollIntoView({ behavior: "instant" }));
  await expect(page.locator('.desktop-nav a[href="#meals"]')).toHaveAttribute("aria-current", "location");
  await page.locator(".benefits-section").evaluate(e => e.scrollIntoView({ behavior: "instant" }));
  await expect(page.locator(".desktop-nav [aria-current]")).toHaveCount(0);
});

test("navbar classic scrollbar lock preserves page and header geometry", async () => {
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await isolateInstagram(page);
    await page.goto("http://127.0.0.1:3000");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#app").evaluate(e => e.scrollIntoView({ behavior: "instant" }));
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBeGreaterThan(0);
    const before = await page.locator("#app").boundingBox();
    const header = await page.locator(".nav-shell").boundingBox();
    await page.getByRole("button", { name: "فتح القائمة" }).click();
    await page.waitForTimeout(400);
    expect(await page.locator("#app").boundingBox()).toEqual(before);
    expect(await page.locator(".nav-shell").boundingBox()).toEqual(header);
    const session = await page.context().newCDPSession(page);
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const actions = nodes.filter(n => !n.ignored && ["button", "link"].includes(n.role?.value));
    expect(actions).toHaveLength(8); // close, five section links, download and enquiry
    expect(actions.filter(n => n.name?.value === "حمّل التطبيق")).toHaveLength(1);
    expect(actions.filter(n => n.name?.value === "اسأل المطعم")).toHaveLength(1);
    await page.keyboard.press("Escape");
    expect(await page.locator("#app").boundingBox()).toEqual(before);
    expect(await page.locator(".nav-shell").boundingBox()).toEqual(header);
    expect(await page.evaluate(() => document.documentElement.style.paddingRight)).toBe("");
  } finally {
    await browser.close();
  }
});

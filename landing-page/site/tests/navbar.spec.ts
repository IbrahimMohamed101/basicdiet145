import { isolateInstagram, stubPlanCatalog, stubPresentationAnalytics } from "./helpers";
import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const widths = [360, 390, 430, 768, 1024, 1440];
const expectedHomeLinks = [
  { label: "الوجبات", href: "#meals" },
  { label: "المنيو", href: "/menu" },
  { label: "كيف يعمل", href: "#how-it-works" },
  { label: "التطبيق", href: "#app" },
  { label: "الباقات", href: "#plans" },
  { label: "الأسئلة", href: "#faq" },
] as const;
const targets = ["meals", "how-it-works", "app", "plans", "faq"];
const output = "../../.audit/refinement/final/navbar";
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const width of widths) {
  test(`navbar RTL ${width}: anchors, keyboard, modal and scroll lock`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => {
      if (["error", "warning"].includes(m.type())) {
        errors.push(`${m.text()} [console-location-url=${m.location().url || "unknown"}]`);
      }
    });
    await page.setViewportSize({ width, height: width === 360 ? 640 : 900 });
    await isolateInstagram(page);
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
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
      const cta = dialog.getByRole("button", { name: "سجّل لخصم 15%" });
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
      page.on("console", m => {
      if (["error", "warning"].includes(m.type())) {
        errors.push(`${m.text()} [console-location-url=${m.location().url || "unknown"}]`);
      }
    });
      await isolateInstagram(page);
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
    await page.goto("/");
      if (mode === "no-animation") await page.evaluate(() => { document.documentElement.dataset.motion = "off"; });
      await noOverflow(page);
      if (mode === "no-js") {
        const fallback = page.locator(".nav-fallback a");
        const expectedFallback = [...expectedHomeLinks, { label: "شوف الباقات", href: "#plans" }];
        await expect(fallback).toHaveCount(7);
        for (const [index, entry] of expectedFallback.entries()) {
          await expect(fallback.nth(index)).toHaveAttribute("href", entry.href);
          await expect(fallback.nth(index)).toHaveText(entry.label);
        }
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
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
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
      const navDialog = page.getByRole("dialog", { name: "التنقل الرئيسي" });
      const cta = navDialog.getByRole("button", { name: "سجّل لخصم 15%" });
      await cta.focus();
      await expect(cta).toBeInViewport();
      await page.screenshot({ animations: "disabled", path: `${output}/${viewport.width}-text-200-open.png` });
      await page.keyboard.press("Enter");
      await expect(navDialog).not.toBeVisible();
      await expect(page.getByRole("dialog", { name: "خصم 15% على اشتراكك" })).toBeVisible();
      await page.getByRole("button", { name: "إغلاق النافذة" }).click();
    }
    await page.screenshot({ animations: "disabled", path: `${output}/${viewport.width}-text-200.png` });
  }
});

test("navbar resize closes modal and restores focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await isolateInstagram(page);
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
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
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
    await page.goto("/");
  await page.evaluate(() => { window.addEventListener("basicdiet:cta", e => { document.documentElement.dataset.cta = JSON.stringify((e as CustomEvent).detail); }); });
  await page.getByRole("button", { name: "فتح القائمة" }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "التنقل الرئيسي" })).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "خصم 15% على اشتراكك" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-cta", JSON.stringify({ location: "header", promotion: "BASIC15", placement: "header" }));
  await page.getByRole("button", { name: "إغلاق النافذة" }).click();
  await session.detach();
});

test("navbar desktop keyboard, focus outline and stable layout on scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await isolateInstagram(page);
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
    await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await page.keyboard.press("Tab");
  await expect(page.locator("body > a.skip-link").first()).toBeFocused();
  const consent = page.getByRole("complementary", { name: "تفضيلات ملفات الارتباط والإعلانات" });
  if (await consent.isVisible()) {
    for (const control of [
      consent.getByRole("link", { name: "تفاصيل الخصوصية" }),
      consent.getByRole("button", { name: "السماح بالتتبع" }),
      consent.getByRole("button", { name: "رفض التتبع" }),
    ]) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
    }
  }
  await page.keyboard.press("Tab");
  await expect(page.locator(".brand")).toBeFocused();
  // Include /menu in its real DOM position; skipping it shifts every later Tab.
  for (const { href } of expectedHomeLinks) {
    await page.keyboard.press("Tab");
    const link = page.locator(`.desktop-nav a[href="${href}"]`);
    await expect(link).toBeFocused();
    expect(await link.evaluate(e => getComputedStyle(e).outlineStyle)).toBe("solid");
  }
  await page.waitForTimeout(600);
  const shifts = await page.evaluate(async () => {
    type ShiftSource = {
      node?: Node | null;
      previousRect?: DOMRectReadOnly;
      currentRect?: DOMRectReadOnly;
    };
    type ShiftEntry = PerformanceEntry & {
      value: number;
      hadRecentInput?: boolean;
      sources?: ShiftSource[];
    };
    const entries: Array<{
      value: number;
      hadRecentInput: boolean;
      startTime: number;
      sources: Array<{
        element: string;
        nearestSection: string | null;
        previous: { x: number; y: number; width: number; height: number } | null;
        current: { x: number; y: number; width: number; height: number } | null;
      }>;
    }> = [];
    const rect = (box?: DOMRectReadOnly) => box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : null;
    const selector = (node?: Node | null) => {
      if (!(node instanceof Element)) return node?.nodeName ?? "(unavailable)";
      const classes = [...node.classList].slice(0, 3).map(name => "." + name).join("");
      return node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + classes;
    };
    const nearestSection = (node?: Node | null) => node instanceof Element
      ? node.closest("section[id], main[id], [data-deferred-calculator]")?.getAttribute("id")
        || node.closest("[data-deferred-calculator]")?.getAttribute("data-deferred-calculator")
        || null
      : null;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries() as ShiftEntry[]) {
        entries.push({
          value: entry.value,
          hadRecentInput: Boolean(entry.hadRecentInput),
          startTime: entry.startTime,
          sources: (entry.sources || []).map(source => ({
            element: selector(source.node),
            nearestSection: nearestSection(source.node),
            previous: rect(source.previousRect),
            current: rect(source.currentRect),
          })),
        });
      }
    });
    observer.observe({ type: "layout-shift" });
    const state = () => ({
      mainHeight: document.querySelector("main")!.getBoundingClientRect().height,
      plansHeight: document.getElementById("plans")?.getBoundingClientRect().height ?? null,
      plansBusy: document.getElementById("plans")?.getAttribute("aria-busy") ?? null,
    });
    const before = state();
    window.scrollTo({ top: 80, behavior: "instant" });
    await new Promise(resolve => setTimeout(resolve, 400));
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise(resolve => setTimeout(resolve, 400));
    observer.disconnect();
    const after = state();
    return {
      total: entries.reduce((sum, entry) => sum + entry.value, 0),
      initial: before.mainHeight,
      final: after.mainHeight,
      before,
      after,
      entries,
    };
  });
  await test.info().attach("navbar-cls-layout-shift-sources.json", {
    body: JSON.stringify(shifts, null, 2),
    contentType: "application/json",
  });
  expect(shifts.total).toBe(0);
  expect(shifts.final).toBe(shifts.initial);
  await page.locator("#meals").evaluate(e => e.scrollIntoView({ behavior: "instant" }));
  await expect(page.locator('.desktop-nav a[href="#meals"]')).toHaveAttribute("aria-current", "location");
  // Exercise a current, unlinked section: active navigation must clear.
  await page.locator(".bd-service-clarity").evaluate(e => e.scrollIntoView({ behavior: "instant" }));
  await expect(page.locator(".desktop-nav [aria-current]")).toHaveCount(0);
});

test("navbar classic scrollbar lock preserves page and header geometry", async () => {
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await isolateInstagram(page);
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
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
    // Explicit accessible names and hrefs catch missing/mislabelled navigation controls.
    const expectedActions = ["إغلاق القائمة", ...expectedHomeLinks.map(x => x.label), "سجّل لخصم 15%"];
    expect(actions.map(n => n.name?.value).sort()).toEqual([...expectedActions].sort());
    const sheetLinks = page.locator(".nav-sheet nav a");
    await expect(sheetLinks).toHaveCount(6);
    for (const [index, entry] of expectedHomeLinks.entries()) {
      await expect(sheetLinks.nth(index)).toHaveText(entry.label);
      await expect(sheetLinks.nth(index)).toHaveAttribute("href", entry.href);
    }
    await page.keyboard.press("Escape");
    expect(await page.locator("#app").boundingBox()).toEqual(before);
    expect(await page.locator(".nav-shell").boundingBox()).toEqual(header);
    expect(await page.evaluate(() => document.documentElement.style.paddingRight)).toBe("");
  } finally {
    await browser.close();
  }
});


test("home #app and #plans navigation stays below the sticky header", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await isolateInstagram(page);
    await stubPlanCatalog(page);
    await stubPresentationAnalytics(page);
    await page.goto("/");
    for (const section of ["plans", "app"]) {
      if (width < 981) await page.getByRole("button", { name: "فتح القائمة" }).click();
      const nav = width < 981 ? page.locator(".nav-sheet nav") : page.locator(".desktop-nav");
      await nav.locator(`a[href="#${section}"]`).click();
      await expect.poll(() => page.locator(`#${section}`).evaluate(element => {
        const top = element.getBoundingClientRect().top;
        const headerBottom = document.querySelector(".nav-shell")!.getBoundingClientRect().bottom;
        return top >= headerBottom - 2 && top < window.innerHeight / 2;
      })).toBe(true);
      await expect(page.locator("#mobile-menu")).not.toHaveAttribute("open", "");
    }
  }
});

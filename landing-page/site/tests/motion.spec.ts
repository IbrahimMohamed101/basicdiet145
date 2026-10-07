import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const motionSource = transpileModule(readFileSync("lib/motion.ts", "utf8"), {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 },
}).outputText;

test("motion hooks render on the server without browser globals", () => {
  const exported: Record<string, () => boolean> = {};
  new Function("exports", "require", motionSource)(exported, createRequire(`${process.cwd()}/package.json`));
  function ServerProbe() {
    return createElement("p", null, JSON.stringify({
      reduced: exported.useReducedMotion(),
      fine: exported.usePointerFine(),
      visible: exported.useDocumentVisible(),
    }));
  }
  expect(renderToString(createElement(ServerProbe))).toContain(
    "{&quot;reduced&quot;:true,&quot;fine&quot;:false,&quot;visible&quot;:false}",
  );
});

test("visibility consumers share an observer and release all targets", async ({ page }) => {
  await page.setContent('<div id="first">First</div><div id="second">Second</div>');
  const result = await page.evaluate(async (source) => {
    const exported: Record<string, (el: Element, cb: (visible: boolean) => void) => () => void> = {};
    new Function("exports", "require", source)(exported, () => ({}));
    const NativeObserver = window.IntersectionObserver;
    let instances = 0;
    let disconnects = 0;
    const observed = new Set<Element>();
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback) { super(callback); instances++; }
      observe(target: Element) { observed.add(target); super.observe(target); }
      unobserve(target: Element) { observed.delete(target); super.unobserve(target); }
      disconnect() { observed.clear(); disconnects++; super.disconnect(); }
    };
    const seen: boolean[] = [];
    const seenLater: boolean[] = [];
    const first = document.getElementById("first")!;
    const stopFirst = exported.observeMotionVisibility(first, (visible) => seen.push(visible));
    const stopSecond = exported.observeMotionVisibility(document.getElementById("second")!, () => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stopOtherConsumer = exported.observeMotionVisibility(first, (visible) => seenLater.push(visible));
    await new Promise((resolve) => setTimeout(resolve, 0));
    stopFirst();
    const remainingAfterOneConsumer = observed.size;
    stopOtherConsumer();
    const stopReplacement = exported.observeMotionVisibility(first, () => {});
    stopFirst(); // An old cleanup must not release a later subscription.
    const remainingAfterStaleCleanup = observed.size;
    stopReplacement(); stopSecond();
    window.IntersectionObserver = NativeObserver;
    return { instances, disconnects, remainingAfterOneConsumer, remainingAfterStaleCleanup, remaining: observed.size, seen, seenLater };
  }, motionSource);
  expect(result).toEqual({ instances: 1, disconnects: 1, remainingAfterOneConsumer: 2, remainingAfterStaleCleanup: 2, remaining: 0, seen: [true], seenLater: [true] });
});

test("video pauses outside viewport and responds to reduced motion", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("video[data-motion-video]");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.locator("#app").scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.locator(".hero").scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && !v.querySelector("source")?.hasAttribute("src"))).toBe(true);
  await expect(video).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
});

test("hidden document and explicit animation-free mode stop media", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.evaluate(() => { document.documentElement.dataset.motion = "off"; });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused && !v.querySelector("source")?.hasAttribute("src"))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
});

for (const reduced of [false, true]) {
  test(`poster-only HTML without JavaScript, reduced=${reduced}`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: reduced ? "reduce" : "no-preference", viewport: { width: 360, height: 640 } });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:3000/");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("video")).toBeVisible();
    expect(await page.locator("video").evaluate((v: HTMLVideoElement) => ({ paused: v.paused, source: v.querySelector("source")?.getAttribute("src"), poster: Boolean(v.poster) }))).toEqual({ paused: true, source: null, poster: true });
    await context.close();
  });
}

test("Save-Data prevents video download", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith(".mp4")) mediaRequests.push(request.url()); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: Object.assign(new EventTarget(), { saveData: true }) });
  });
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused && !v.querySelector("source")?.hasAttribute("src"))).toBe(true);
  expect(mediaRequests).toEqual([]);
});

test("initial reduced motion avoids media requests and smooth scrolling", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith(".mp4")) mediaRequests.push(request.url()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator(".button--hero").click();
  await expect(page.locator("#app")).toBeInViewport();
  await page.locator(".button--light").first().hover();
  expect(await page.locator(".button--light").first().evaluate((el) => ({ transform: getComputedStyle(el).transform, scroll: getComputedStyle(document.documentElement).scrollBehavior }))).toEqual({ transform: "none", scroll: "auto" });
  expect(mediaRequests).toEqual([]);
});

test("denied autoplay keeps the poster and avoids unhandled errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException("Autoplay denied", "NotAllowedError"));
  });
  await page.goto("/");
  await expect(page.locator("video")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused && Boolean(v.poster) && !v.querySelector("source")?.hasAttribute("src"))).toBe(true);
  expect(errors).toEqual([]);
});

test("current interactions remain usable with CPU throttled 4x", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "التنقل الرئيسي" })).toBeVisible();
  await page.getByRole("button", { name: "إغلاق القائمة", exact: true }).click();
  const question = page.locator(".faq-item button").nth(1);
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await session.detach();
});

test("reveal CSS shows content without enhancement and caps stagger", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "reveal-test"; fixture.textContent = "محتوى الاختبار";
    fixture.dataset.reveal = ""; document.body.append(fixture);
  });
  const fixture = page.locator("#reveal-test");
  expect(await fixture.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await fixture.evaluate((el: HTMLElement) => { el.style.setProperty("--reveal-index", "20"); el.dataset.revealState = "active"; });
  expect(await fixture.evaluate((el) => ({ duration: getComputedStyle(el).animationDuration, delay: getComputedStyle(el).animationDelay }))).toEqual({ duration: "0.65s", delay: "0.6s" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await fixture.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, animation: getComputedStyle(el).animationName }))).toEqual({ opacity: "1", animation: "none" });
});


test("hero tilt is fine-pointer only, bounded, and returns to rest", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const stage = page.getByTestId("hero-media-stage");
  await expect(stage).toHaveAttribute("data-hero-tilt", "on");

  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(box.x + box.width * 0.92, box.y + box.height * 0.12);
  const card = stage.locator(".hero-media");

  await expect.poll(async () => {
    const values = await card.evaluate((element: HTMLElement) => ({
      x: parseFloat(element.style.getPropertyValue("--hero-tilt-x")) || 0,
      y: parseFloat(element.style.getPropertyValue("--hero-tilt-y")) || 0,
    }));
    return Math.abs(values.x) + Math.abs(values.y);
  }).toBeGreaterThan(0.2);

  const values = await card.evaluate((element: HTMLElement) => ({
    x: Math.abs(parseFloat(element.style.getPropertyValue("--hero-tilt-x")) || 0),
    y: Math.abs(parseFloat(element.style.getPropertyValue("--hero-tilt-y")) || 0),
  }));
  expect(values.x).toBeLessThanOrEqual(2.01);
  expect(values.y).toBeLessThanOrEqual(3.01);

  await page.mouse.move(10, 10);
  await expect.poll(async () => {
    return card.evaluate((element: HTMLElement) => {
      const x = Math.abs(parseFloat(element.style.getPropertyValue("--hero-tilt-x")) || 0);
      const y = Math.abs(parseFloat(element.style.getPropertyValue("--hero-tilt-y")) || 0);
      return x + y;
    });
  }).toBeLessThan(0.05);
});

test("hero has no pointer tilt on touch devices", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/");

  const stage = page.getByTestId("hero-media-stage");
  await expect(stage).toHaveAttribute("data-hero-tilt", "off");
  expect(await stage.locator(".hero-media").evaluate((element: HTMLElement) => ({
    x: element.style.getPropertyValue("--hero-tilt-x"),
    y: element.style.getPropertyValue("--hero-tilt-y"),
  }))).toEqual({ x: "0.000deg", y: "0.000deg" });

  await context.close();
});

test("hero manual pause survives viewport autoplay lifecycle", async ({ page }) => {
  await page.goto("/");
  const video = page.locator("video[data-motion-video]");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);

  await page.getByRole("button", { name: "إيقاف فيديو الوجبات" }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => ({
    paused: element.paused,
    userPaused: element.dataset.userPaused,
  }))).toEqual({ paused: true, userPaused: "true" });

  await page.locator("#app").scrollIntoViewIfNeeded();
  await page.locator(".hero").scrollIntoViewIfNeeded();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);

  await page.getByRole("button", { name: "تشغيل فيديو الوجبات" }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  expect(await video.evaluate((element: HTMLVideoElement) => element.dataset.userPaused)).toBeUndefined();
});

test("reduced motion keeps hero poster static and removes media control", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".mp4")) requests.push(request.url());
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.getByRole("button", { name: /فيديو الوجبات/ })).toHaveCount(0);
  await expect(page.locator(".hero-title-line")).toHaveCount(3);
  expect(await page.locator(".hero-title-line").first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.locator("video[data-motion-video]").evaluate((element: HTMLVideoElement) => ({
    paused: element.paused,
    source: element.querySelector("source")?.getAttribute("src"),
  }))).toEqual({ paused: true, source: null });
  expect(requests).toEqual([]);
});

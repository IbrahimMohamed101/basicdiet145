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
  new Function("exports", "require", motionSource)(
    exported,
    createRequire(`${process.cwd()}/package.json`),
  );

  function ServerProbe() {
    return createElement(
      "p",
      null,
      JSON.stringify({
        reduced: exported.useReducedMotion(),
        fine: exported.usePointerFine(),
        visible: exported.useDocumentVisible(),
      }),
    );
  }

  expect(renderToString(createElement(ServerProbe))).toContain(
    "{&quot;reduced&quot;:true,&quot;fine&quot;:false,&quot;visible&quot;:false}",
  );
});

test("visibility consumers share an observer and release all targets", async ({ page }) => {
  await page.setContent('<div id="first">First</div><div id="second">Second</div>');

  const result = await page.evaluate(async (source) => {
    const exported: Record<
      string,
      (element: Element, callback: (visible: boolean) => void) => () => void
    > = {};

    new Function("exports", "require", source)(exported, () => ({}));

    const NativeObserver = window.IntersectionObserver;
    let instances = 0;
    let disconnects = 0;
    const observed = new Set<Element>();

    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback) {
        super(callback);
        instances++;
      }

      observe(target: Element) {
        observed.add(target);
        super.observe(target);
      }

      unobserve(target: Element) {
        observed.delete(target);
        super.unobserve(target);
      }

      disconnect() {
        observed.clear();
        disconnects++;
        super.disconnect();
      }
    };

    const seen: boolean[] = [];
    const seenLater: boolean[] = [];
    const first = document.getElementById("first")!;

    const stopFirst = exported.observeMotionVisibility(first, (visible) =>
      seen.push(visible),
    );
    const stopSecond = exported.observeMotionVisibility(
      document.getElementById("second")!,
      () => {},
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    const stopOtherConsumer = exported.observeMotionVisibility(first, (visible) =>
      seenLater.push(visible),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    stopFirst();
    const remainingAfterOneConsumer = observed.size;
    stopOtherConsumer();

    const stopReplacement = exported.observeMotionVisibility(first, () => {});
    stopFirst();
    const remainingAfterStaleCleanup = observed.size;

    stopReplacement();
    stopSecond();
    window.IntersectionObserver = NativeObserver;

    return {
      instances,
      disconnects,
      remainingAfterOneConsumer,
      remainingAfterStaleCleanup,
      remaining: observed.size,
      seen,
      seenLater,
    };
  }, motionSource);

  expect(result).toEqual({
    instances: 1,
    disconnects: 1,
    remainingAfterOneConsumer: 2,
    remainingAfterStaleCleanup: 2,
    remaining: 0,
    seen: [true],
    seenLater: [true],
  });
});

test("cinematic hero uses the approved full video and hands off to the interactive app reveal", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("video[data-motion-video]")).toHaveCount(1);
  await expect(page.locator(".hero--cinematic")).toBeVisible();
  await expect(page.getByTestId("hero-visual-stage")).toBeVisible();
  await expect(page.locator(".hero-phone-screen")).toHaveAttribute(
    "src",
    /18\.59\.40/,
  );
  await expect(page.locator(".hero-meal-image")).toHaveAttribute(
    "src",
    "/meals/butter-chicken.png",
  );
  await expect(page.locator(".hero-cinema-title-line")).toHaveCount(3);
  await expect(page.locator(".app-reveal-section")).toHaveCount(1);
});

test("hero pointer parallax is bounded and returns to neutral", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const stage = page.getByTestId("hero-visual-stage");
  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute("data-scene-interactive", "true");

  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  await page.mouse.move(
    box.x + box.width * 0.92,
    box.y + box.height * 0.12,
  );

  await expect.poll(async () => {
    return stage.evaluate((element: HTMLElement) => {
      const x = Math.abs(
        parseFloat(element.style.getPropertyValue("--scene-near-x")) || 0,
      );
      const y = Math.abs(
        parseFloat(element.style.getPropertyValue("--scene-near-y")) || 0,
      );
      return x + y;
    });
  }).toBeGreaterThan(0.25);

  const values = await stage.evaluate((element: HTMLElement) => ({
    x: Math.abs(parseFloat(element.style.getPropertyValue("--scene-near-x")) || 0),
    y: Math.abs(parseFloat(element.style.getPropertyValue("--scene-near-y")) || 0),
  }));

  expect(values.x).toBeLessThanOrEqual(18.01);
  expect(values.y).toBeLessThanOrEqual(12.01);

  await page.mouse.move(10, 10);

  await expect.poll(async () => {
    return stage.evaluate((element: HTMLElement) => {
      const x = Math.abs(
        parseFloat(element.style.getPropertyValue("--scene-near-x")) || 0,
      );
      const y = Math.abs(
        parseFloat(element.style.getPropertyValue("--scene-near-y")) || 0,
      );
      return x + y;
    });
  }).toBeLessThan(0.02);
});

test("touch hero stays static and has no pointer parallax", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  await page.goto("http://127.0.0.1:3000/");

  const stage = page.getByTestId("hero-visual-stage");
  await expect(stage).toHaveAttribute("data-scene-interactive", "false");

  expect(
    await stage.evaluate((element: HTMLElement) => ({
      x: element.style.getPropertyValue("--scene-near-x"),
      y: element.style.getPropertyValue("--scene-near-y"),
    })),
  ).toEqual({ x: "0.00px", y: "0.00px" });

  await context.close();
});

test("reduced motion keeps the layered hero static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const stage = page.getByTestId("hero-visual-stage");
  await expect(stage).toHaveAttribute("data-scene-interactive", "false");

  expect(
    await stage.evaluate((element) => ({
      animation: getComputedStyle(element).animationName,
      x: (element as HTMLElement).style.getPropertyValue("--scene-near-x"),
      y: (element as HTMLElement).style.getPropertyValue("--scene-near-y"),
    })),
  ).toEqual({
    animation: "none",
    x: "0.00px",
    y: "0.00px",
  });

  expect(
    await page.locator(".hero-phone-float").evaluate(
      (element) => getComputedStyle(element).animationName,
    ),
  ).toBe("none");

  expect(
    await page.locator("video[data-motion-video]").evaluate((video: HTMLVideoElement) => ({
      paused: video.paused,
      source: video.querySelector("source")?.getAttribute("src"),
    })),
  ).toEqual({ paused: true, source: null });
});

for (const reduced of [false, true]) {
  test(`hero remains visible without JavaScript, reduced=${reduced}`, async ({ browser }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      reducedMotion: reduced ? "reduce" : "no-preference",
      viewport: { width: 360, height: 640 },
    });

    const page = await context.newPage();
    await page.goto("http://127.0.0.1:3000/");

    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".hero-meal-image")).toBeVisible();
    await expect(page.locator(".hero-phone-screen")).toBeVisible();
    await expect(page.locator("video[data-motion-video]")).toHaveCount(1);
    expect(
      await page.locator("video[data-motion-video]").evaluate((video: HTMLVideoElement) => ({
        paused: video.paused,
        source: video.querySelector("source")?.getAttribute("src"),
        poster: Boolean(video.poster),
      })),
    ).toEqual({ paused: true, source: null, poster: true });

    await context.close();
  });
}

test("initial reduced motion keeps smooth scrolling disabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await page.locator(".button--hero").click();
  await expect(page.locator("#app")).toBeInViewport();

  await page.locator(".app-reveal-cta").hover();

  expect(
    await page.locator(".app-reveal-cta").evaluate((element) => ({
      transform: getComputedStyle(element).transform,
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
    })),
  ).toEqual({ transform: "none", scroll: "auto" });
});

test("current interactions remain usable with CPU throttled 4x", async ({ page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "التنقل الرئيسي" }),
  ).toBeVisible();

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
    fixture.id = "reveal-test";
    fixture.textContent = "محتوى الاختبار";
    fixture.dataset.reveal = "";
    document.body.append(fixture);
  });

  const fixture = page.locator("#reveal-test");

  expect(await fixture.evaluate((element) => getComputedStyle(element).opacity)).toBe(
    "1",
  );

  await fixture.evaluate((element: HTMLElement) => {
    element.style.setProperty("--reveal-index", "20");
    element.dataset.revealState = "active";
  });

  expect(
    await fixture.evaluate((element) => ({
      duration: getComputedStyle(element).animationDuration,
      delay: getComputedStyle(element).animationDelay,
    })),
  ).toEqual({ duration: "0.65s", delay: "0.6s" });

  await page.emulateMedia({ reducedMotion: "reduce" });

  expect(
    await fixture.evaluate((element) => ({
      opacity: getComputedStyle(element).opacity,
      animation: getComputedStyle(element).animationName,
    })),
  ).toEqual({ opacity: "1", animation: "none" });
});
// Layered Hero QA: parallax bounds use rendered pixel offsets.


test("Save-Data keeps the cinematic hero on its poster", async ({ page }) => {
  const mediaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".mp4")) mediaRequests.push(request.url());
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: Object.assign(new EventTarget(), { saveData: true }),
    });
  });

  await page.goto("/");

  expect(
    await page.locator("video[data-motion-video]").evaluate((video: HTMLVideoElement) => ({
      paused: video.paused,
      source: video.querySelector("source")?.getAttribute("src"),
      poster: Boolean(video.poster),
    })),
  ).toEqual({ paused: true, source: null, poster: true });

  expect(mediaRequests).toEqual([]);
});

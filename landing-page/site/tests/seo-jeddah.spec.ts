import { expect, test } from "@playwright/test";

const options = {
  status: true,
  data: [{ planId: "507f1f77bcf86cd799439026", daysCount: 26,
    gramsOptions: [{ grams: 150, mealsPerDay: [1, 2, 3] }] }],
};

test("search-intent page is crawlable, useful and links to the lead enquiry", async ({ page }) => {
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(options),
  }));
  await page.goto("/jeddah/healthy-meals", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(/اشتراك وجبات دايت جدة/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("اشتراك وجبات صحية في جدة");
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", /\/jeddah\/healthy-meals$/);
  await expect(page.getByRole("heading", { name: /باقات اشتراكات وجبات صحية/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /طريقة بدء اشتراك/ })).toBeVisible();

  await page.getByRole("button", { name: /سجّل لخصم 15%/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /26 يوم/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("dialog").getByRole("button", { name: "إغلاق النافذة" }).click();
});

test("sitemap and robots list canonical public content, excluding private lead APIs", async ({ request }) => {
  const [map, robots] = await Promise.all([
    request.get("/sitemap.xml"), request.get("/robots.txt"),
  ]);
  expect(map.status()).toBe(200);
  expect(robots.status()).toBe(200);
  const xml = await map.text();
  expect(xml).toContain("/jeddah/healthy-meals");
  expect(xml).toContain("/jeddah/subscription-prices");
  expect(xml).toContain("/menu");
  expect(xml).toContain("<lastmod>");
  expect(xml).toContain("https://");
  expect(xml).not.toContain("/privacy");
  const text = await robots.text();
  expect(text).toContain("Disallow: /api/");
  expect(text).toContain("Disallow: /privacy");
  expect(text).toContain("Sitemap:");
});

test("search page remains usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/jeddah/healthy-meals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "اشتراكات وجبات صحية جدة" })).toHaveAttribute("href", "/jeddah/healthy-meals");
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(391);
});

test("homepage links contextually to the Jeddah subscriptions guide", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const guide = page.getByRole("link", { name: /قارن باقات بيسك دايت/ });
  await expect(guide).toHaveAttribute("href", "/jeddah/healthy-meals");
});

test("Jeddah page has useful local links, a real meal image and correct breadcrumb JSON-LD", async ({ page }) => {
  await page.goto("/jeddah/healthy-meals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /وجبات دايت في جدة تختارها حسب باقتك/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /موقع المطعم والتواصل/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /سالمون من أصناف منيو بيسك دايت/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /موقع Basic Diet على Google Maps/ })).toHaveAttribute("href", /maps.app.goo.gl/);
  const rawSchemas = await page.locator('script[type="application/ld+json"]').allTextContents();
  const schemas = rawSchemas.map(raw => JSON.parse(raw));
  const breadcrumbSchemas = schemas.filter(schema => schema["@type"] === "BreadcrumbList");
  expect(breadcrumbSchemas).toHaveLength(1);
  const schema = breadcrumbSchemas[0];
  expect(schema.itemListElement).toHaveLength(2);
  expect(schema.itemListElement[1].item).toMatch(/\/jeddah\/healthy-meals$/);
});

test("pricing SEO page has canonical, crawlable server HTML and a safe live-feed fallback", async ({ request, page }) => {
  const response = await request.get("/jeddah/subscription-prices");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("أسعار اشتراك وجبات دايت في جدة");
  expect(html).toContain("/jeddah/subscription-prices");
  expect(html).toContain("وجبات");
  // Both conditions are legitimate: live price feed can be temporarily unavailable in CI.
  expect(html.includes("جدول أسعار باقات الاشتراك")).toBeTruthy();
  expect(html.includes("قائمة الأسعار غير متاحة للعرض الآن") ||
    html.includes("السعر الأساسي")).toBeTruthy();

  await page.goto("/jeddah/subscription-prices", { waitUntil: "domcontentloaded" });
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute("href", /\/jeddah\/subscription-prices$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("أسعار اشتراك وجبات دايت");
  await expect(page.getByRole("link", { name: /تصفّح منيو بيسك دايت/ })).toHaveAttribute("href", "/menu");
});

test("homepage offers crawlable pricing content and consistent local restaurant hours", async ({ request }) => {
  const result = await request.get("/");
  expect(result.status()).toBe(200);
  const html = await result.text();
  expect(html).toContain("قارن أسعار باقات بيسك دايت قبل التسجيل");
  expect(html).toContain("/jeddah/subscription-prices");
  expect(html).toContain('Mo-Su 00:00-23:59');
  expect(html).toContain('"hasMenu"');
});

test("mobile homepage uses a high-priority image instead of the cinematic video", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const poster = page.locator(".hero-cinema-mobile-poster");
  await expect(poster).toBeVisible();
  await expect(poster).toHaveAttribute("loading", "eager");
  await expect(poster).toHaveAttribute("fetchpriority", "high");
  await expect(page.locator(".hero-cinema-video")).toBeHidden();
});

test("menu first featured image is eager and prioritized; noncritical images stay lazy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu", { waitUntil: "domcontentloaded" });
  const featuredImages = page.locator(".menu-featured-card img");
  await expect(featuredImages).toHaveCount(4);
  await expect(featuredImages.nth(0)).toHaveAttribute("loading", "eager");
  await expect(featuredImages.nth(0)).toHaveAttribute("fetchpriority", "high");
  await expect(featuredImages.nth(1)).toHaveAttribute("loading", "eager");
  await expect(featuredImages.nth(2)).toHaveAttribute("loading", "lazy");
});

test("unrelated pages do not preload the homepage cinematic poster", async ({ page }) => {
  for (const path of ["/menu", "/jeddah/subscription-prices"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator('link[rel="preload"][as="image"][href*="hero-poster"]')).toHaveCount(0);
  }
});

test("mobile hero poster paints without a costly blur, mask or duplicate background image", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const styles = await page.locator(".hero-cinema-mobile-poster").evaluate((img) => {
    const poster = getComputedStyle(img);
    const behind = getComputedStyle(img.parentElement!, "::before");
    return {
      filter: poster.filter,
      mask: poster.maskImage,
      webkitMask: poster.getPropertyValue("-webkit-mask-image"),
      behindImage: behind.backgroundImage,
      behindFilter: behind.filter,
    };
  });
  expect(styles.filter).toBe("none");
  expect(styles.mask).toBe("none");
  expect(styles.webkitMask).toBe("none");
  expect(styles.behindImage).not.toContain("hero-poster");
  expect(styles.behindFilter).toBe("none");
});

test("menu helper labels meet 4.5:1 contrast against white", async ({ page }) => {
  await page.goto("/menu", { waitUntil: "domcontentloaded" });
  const contrasts = await page.evaluate(() => {
    const selectors = [
      ".menu-featured-intro .menu-kicker",
      ".menu-catalog-count small",
      ".menu-option-title span",
    ];
    function luminance(rgb: string): number {
      const channels = (rgb.match(/[0-9.]+/g) ?? []).slice(0, 3)
        .map(n => Number(n) / 255)
        .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    return selectors.map(selector => {
      const el = document.querySelector(selector);
      if (!el) return { selector, contrast: 0 };
      const foreground = luminance(getComputedStyle(el).color);
      return { selector, contrast: 1.05 / (foreground + 0.05) };
    });
  });
  for (const result of contrasts) {
    expect(result.contrast, result.selector).toBeGreaterThanOrEqual(4.5);
  }
});

test("DIAGNOSTIC: mobile LCP timeline under throttling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  await client.send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: 210000, uploadThroughput: 100000,
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    const w = window as typeof window & { __lcpAudit?: Record<string, unknown> };
    const start = performance.now();
    const lcp: Array<Record<string, unknown>> = [];
    const tasks: Array<Record<string, unknown>> = [];
    const paints: Array<Record<string, unknown>> = [];
    const changes: Array<Record<string, unknown>> = [];
    w.__lcpAudit = { start, lcp, tasks, paints, changes };
    try {
      new PerformanceObserver((entries) => {
        entries.getEntries().forEach(e => {
          const x = e as PerformanceEntry & { renderTime?: number; loadTime?: number; size?: number; element?: Element };
          lcp.push({ t: e.startTime, render: x.renderTime, load: x.loadTime,
            size: x.size, tag: x.element?.tagName, className: x.element?.getAttribute("class"),
            url: (x.element as HTMLImageElement | undefined)?.currentSrc });
        });
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver(list => list.getEntries().forEach(e => tasks.push({start:e.startTime,duration:e.duration})))
        .observe({type:"longtask",buffered:true});
      new PerformanceObserver(list => list.getEntries().forEach(e => paints.push({name:e.name,t:e.startTime})))
        .observe({type:"paint",buffered:true});
    } catch (e) { changes.push({observerError:String(e)}); }
    document.addEventListener("readystatechange", () => {
      changes.push({event: document.readyState, t: performance.now()});
    });
    window.addEventListener("load", () => changes.push({ event:"load",t:performance.now() }));
  });
  await page.goto("https://basicdietksa.com/", { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(4800);
  const metrics = await page.evaluate(() => {
    const w = window as typeof window & { __lcpAudit?: Record<string,unknown> };
    const img = document.querySelector<HTMLImageElement>(".hero-cinema-mobile-poster");
    const hero = document.querySelector<HTMLElement>(".hero-cinema-media");
    const resources = performance.getEntriesByType("resource").map(x => {
      const y=x as PerformanceResourceTiming;
      return {url:y.name.slice(0,140),t:+y.startTime.toFixed(1),request:+y.requestStart.toFixed(1),
        responseEnd:+y.responseEnd.toFixed(1),dur:+y.duration.toFixed(1),bytes:y.transferSize,decoded:y.decodedBodySize,
        initiator:y.initiatorType};
    }).filter(x=>/hero-poster|\.css|\.woff|\.js|\.mp4/.test(x.url)).sort((a,b)=>a.t-b.t).slice(0,35);
    const css=img?getComputedStyle(img):null;
    const elem=hero?getComputedStyle(hero):null;
    const rect=img?.getBoundingClientRect();
    return {audit:w.__lcpAudit, resources,
      poster: {complete:img?.complete,naturalWidth:img?.naturalWidth,currentSrc:img?.currentSrc,
        visibility:css?.visibility,display:css?.display,opacity:css?.opacity,filter:css?.filter,
        rect:{top:rect?.top,height:rect?.height,width:rect?.width},
        parentOpacity:elem?.opacity,parentDisplay:elem?.display},
      fonts:document.fonts.status,
      nav:performance.getEntriesByType("navigation").map(x=>{const n=x as PerformanceNavigationTiming;return{responseStart:n.responseStart,domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd};}),
      t:performance.now()};
  });
  console.log("HERO_LCP_LIVE_DIAGNOSTIC "+JSON.stringify(metrics));
  await client.detach();
  expect(metrics.poster.complete).toBe(true);
});

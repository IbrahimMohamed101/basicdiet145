import { expect, test } from "@playwright/test";

for (const width of [320, 360, 390, 768, 1440]) {
  test("menu preview remains within viewport at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/menu", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /منيو بيسك دايت/ })).toBeVisible();
    for (const id of ["menu-plans", "menu-custom", "menu-products", "menu-download"]) {
      await expect(page.locator("#" + id)).toBeVisible();
    }
    await expect.poll(async () => page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
    await expect(page.locator("main .menu-product-card")).toHaveCount(12);
    const missingTargets = await page.locator('a[href^="#"]').evaluateAll((links) => links
      .map((link) => link.getAttribute("href") || "")
      .filter((href) => href.length > 1 && !document.getElementById(href.slice(1))));
    expect(missingTargets).toEqual([]);
  });
}

const priceCatalog = { status: true, data: [
  { planId: "6a621995f4f8d0974cebc472", daysCount: 26, gramsOptions: [
    { grams: 150, mealsOptions: [{ mealsPerDay: 2, priceSar: 1186 }] },
    { grams: 200, mealsOptions: [{ mealsPerDay: 2, priceSar: 1421 }] },
  ] },
  { planId: "6a621995f4f8d0974cebc473", daysCount: 7, gramsOptions: [
    { grams: 150, mealsOptions: [{ mealsPerDay: 2, priceSar: 348 }, { mealsPerDay: 3, priceSar: 522 }] },
    { grams: 200, mealsOptions: [{ mealsPerDay: 2, priceSar: 420 }, { mealsPerDay: 3, priceSar: 630 }] },
  ] },
] };

test("shared calculator reads public plan prices and preserves chosen dimensions", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(priceCatalog),
  }));
  await page.goto("/menu");
  const plans = page.locator("#menu-plans");
  await expect(plans.locator(".bd-calculator-price")).toContainText("١٬١٨٦");
  await plans.locator("fieldset").nth(0).getByRole("button", { name: /7/ }).click();
  await expect(plans.locator(".bd-calculator-price")).toContainText("٣٤٨");
  await plans.locator("fieldset").nth(1).getByRole("button", { name: /200/ }).click();
  await expect(plans.locator(".bd-calculator-price")).toContainText("٤٢٠");
  await plans.locator("fieldset").nth(2).getByRole("button", { name: "3" }).click();
  await expect(plans.locator(".bd-calculator-price")).toContainText("٦٣٠");
  await page.goto("/");
  await expect(page.locator("#plans .bd-calculator-price")).toContainText("٦٣٠");
  await expect(page.locator("#plans")).toContainText("وزن حصة البروتين");
});

test("builder and catalog interactions are read-only", async ({ page }) => {
  await page.goto("/menu");
  const builder = page.locator("#menu-custom");
  await builder.getByRole("button", { name: /رز أبيض/ }).click();
  await expect(builder.locator(".menu-summary-data")).toContainText("رز أبيض");
  await builder.getByRole("group", { name: "نوع تجربة التخصيص" })
    .getByRole("button", { name: /اصنع سلطتك/ }).click();
  await builder.getByRole("button", { name: "خس" }).click();
  await builder.getByRole("button", { name: "جرجير" }).click();
  await expect(builder.locator(".menu-summary-data")).toContainText("2");
  const catalog = page.locator("#menu-products");
  await catalog.getByRole("group", { name: "تصنيفات المنيو" })
    .getByRole("button", { name: "السلطات" }).click();
  await expect(catalog).toContainText("18 صنف");
  await catalog.getByRole("searchbox", { name: "ابحث عن صنف" }).fill("90");
  await expect(catalog.locator(".menu-product-card")).toHaveCount(1);
  await catalog.locator(".menu-product-card button").click();
  await expect(page.getByRole("dialog", { name: /سلطه بيسك/ })).toBeVisible();
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("menu robots and sitemap switch correctly between preview and customer build", async ({ page, request }) => {
  await page.goto("/menu");
  const robots = page.locator('meta[name="robots"]');
  const preview = process.env.NEXT_PUBLIC_MENU_PREVIEW_MODE === "true";
  await expect(robots).toHaveAttribute("content", preview ? /noindex/ : /index/);
  const map = await request.get("/sitemap.xml");
  expect(map.status()).toBe(200);
  const xml = await map.text();
  if (preview) expect(xml).not.toContain("https://basicdietksa.com/menu</loc>");
  else expect(xml).toContain("https://basicdietksa.com/menu</loc>");
  await page.goto("/");
  await expect(page.locator('.site-header .desktop-nav a[href="/menu"]')).toHaveCount(1);
});


test("footer callback uses the existing landing lead endpoint and preserves the customer inputs", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: true,
      data: [{ planId: "6a621995f4f8d0974cebc472", daysCount: 26, gramsOptions: [{ grams: 150, mealsPerDay: [2] }] }],
    }),
  }));
  await page.route("**/api/leads", async route => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 202, contentType: "application/json", body: '{"status":true}' });
  });
  await page.goto("/menu");
  const form = page.locator("#menu-quick-contact form");
  await form.getByRole("textbox", { name: "الاسم" }).fill("عميل تجربة");
  await form.getByRole("textbox", { name: "رقم الجوال السعودي" }).fill("0501234567");
  await form.getByRole("button", { name: /سجّل وخلّنا نساعدك توفّر/ }).click();
  const dialog = page.locator(".lead-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "خصم 15% على اشتراكك" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /اسمك/ })).toHaveValue("عميل تجربة");
  await expect(dialog.getByRole("textbox", { name: "رقم الجوال" })).toHaveValue("0501234567");
  await dialog.getByRole("checkbox", { name: /أوافق على التواصل/ }).check();
  await dialog.getByRole("button", { name: "سجّل لخصم 15%" }).click();
  await expect(dialog.getByRole("heading", { name: "وصلنا طلبك!" })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].name).toBe("عميل تجربة");
  expect(sent[0].phone).toBe("+966501234567");
  expect(sent[0].planUnselected).toBe(true);
  expect(sent[0].planId).toBeUndefined();
  expect(sent[0].daysCount).toBeUndefined();
  expect(sent[0].contactConsent).toBe(true);
  expect(sent[0].location).toBe("final");
  expect(String(sent[0].content)).toContain("menu_basic15_footer_form");
  expect(String(sent[0].content)).toContain("offer15");
  expect(String(sent[0].content)).toContain("plan_to_confirm");
});

test("plan contact CTA passes calculator dimensions to existing lead flow", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(priceCatalog),
  }));
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: [{ planId: "6a621995f4f8d0974cebc472", daysCount: 26,
      gramsOptions: [{ grams: 150, mealsPerDay: [2] }, { grams: 200, mealsPerDay: [2] }] }] }),
  }));
  await page.goto("/menu");
  const plans = page.locator("#menu-plans");
  await plans.locator("fieldset").nth(1).getByRole("button", { name: /200/ }).click();
  await plans.getByRole("button", { name: /سجّل للاستفادة من خصم 15%/ }).click();
  const dialog = page.locator(".lead-dialog");
  await expect(dialog.getByRole("heading", { name: "خصم 15% على اشتراكك" })).toBeVisible();
  await expect(dialog.locator(".lead-selection-summary")).toContainText("200 جرام");
});

test("menu offers a visible app download without contact consent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  await expect(page.locator(".menu-mobile-conversion-bar")).toHaveCount(0);
  await expect(page.locator("#menu-quick-contact a[href*='play.google.com']")).toBeVisible();
  await expect(page.locator("#menu-quick-contact a[href*='apps.apple.com']")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});


test("food photos, categories and catalog precede subscription and contact on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  await expect(page.locator(".menu-hero-art img")).toHaveCount(3);
  await expect(page.locator(".menu-featured-card")).toHaveCount(4);
  await expect(page.locator(".menu-quick-lead")).toHaveCount(1);
  await expect(page.locator(".menu-hero .menu-quick-lead")).toHaveCount(0);
  await expect(page.locator(".menu-mobile-conversion-bar")).toHaveCount(0);
  const positions = await page.evaluate(() => ({
    hero: document.querySelector(".menu-hero")?.getBoundingClientRect().top ?? -1,
    categories: document.querySelector(".menu-featured-categories")?.getBoundingClientRect().top ?? -1,
    catalog: document.querySelector("#menu-products")?.getBoundingClientRect().top ?? -1,
    plans: document.querySelector("#menu-plans")?.getBoundingClientRect().top ?? -1,
    builder: document.querySelector("#menu-custom")?.getBoundingClientRect().top ?? -1,
    footer: document.querySelector("#menu-quick-contact")?.getBoundingClientRect().top ?? -1,
  }));
  expect(positions.hero).toBeLessThan(positions.categories);
  expect(positions.categories).toBeLessThan(positions.catalog);
  expect(positions.catalog).toBeLessThan(positions.plans);
  expect(positions.plans).toBeLessThan(positions.builder);
  expect(positions.builder).toBeLessThan(positions.footer);
});

test("photographic category shortcut selects products without opening contact", async ({ page }) => {
  await page.goto("/menu");
  await page.locator(".menu-featured-card").filter({ hasText: "السلطات" }).click();
  const catalog = page.locator("#menu-products");
  await expect(catalog.getByRole("group", { name: "تصنيفات المنيو" })
    .getByRole("button", { name: "السلطات" })).toHaveAttribute("aria-pressed", "true");
  await expect(catalog).toContainText("18 صنف");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("builder asks for callback only when explicitly selected", async ({ page }) => {
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ data: [{
      planId: "6a621995f4f8d0974cebc472", daysCount: 26,
      gramsOptions: [{ grams: 150, mealsPerDay: [2] }],
    }] }),
  }));
  await page.goto("/menu");
  const builder = page.locator("#menu-custom");
  await builder.getByRole("group", { name: "نوع تجربة التخصيص" })
    .getByRole("button", { name: /اصنع سلطتك/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await builder.getByRole("button", { name: /خلّينا نتواصل معك/ }).click();
  await expect(page.locator(".lead-dialog")).toBeVisible();
  await expect(page.locator(".lead-dialog").getByRole("heading", { name: "باقي خطوة ونساعدك تبدأ" })).toBeVisible();
});


test("menu has one navigational header with local menu links", async ({ page }) => {
  await page.goto("/menu");
  await expect(page.locator(".site-header")).toHaveCount(1);
  await expect(page.locator(".menu-jump-nav")).toHaveCount(0);
  const nav = page.locator(".site-header .desktop-nav");
  await expect(nav.locator('a[href="#menu-products"]')).toHaveCount(1);
  await expect(nav.locator('a[href="#menu-plans"]')).toHaveCount(1);
  await expect(nav.locator('a[href="#menu-custom"]')).toHaveCount(1);
  await expect(nav.locator('a[href="#menu-download"]')).toHaveCount(1);
  await expect(page.locator(".menu-hero .menu-quick-lead")).toHaveCount(0);
});

test("menu hides weight variants on cards but shows 48px choices in product details", async ({ page }) => {
  await page.goto("/menu");
  const shrimp = page.locator(".menu-product-card").filter({ has: page.getByRole("heading", { name: "جمبري" }) });
  await expect(shrimp).toHaveCount(1);
  await expect(shrimp.getByRole("button", { name: "150 جم" })).toHaveCount(0);
  await shrimp.locator(".menu-product-bottom button").click();
  const detail = page.getByRole("dialog", { name: "جمبري" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: "150 جم" }).click();
  await expect(detail.getByRole("button", { name: "150 جم" })).toHaveAttribute("aria-pressed", "true");
  await expect(detail.locator(".menu-detail-purchase-row strong")).toContainText("٤٩");
  await expect(detail).toContainText("مسببات الحساسية");
});

test("calculator fails closed without live prices", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"status":false,"data":[]}',
  }));
  await page.goto("/menu");
  const plans = page.locator("#menu-plans");
  await expect(plans.locator(".bd-calculator-price")).toContainText("تعذّر تحميل الأسعار");
  await expect(plans.getByRole("button", { name: /سجّل للاستفادة من خصم 15%/ })).toBeDisabled();
});

test("meal-builder shows photos only for supported matched dishes", async ({ page }) => {
  await page.goto("/menu");
  const builder = page.locator("#menu-custom");
  const shrimp = builder.getByRole("button", { name: /جمبري/ });
  await expect(shrimp.locator("img")).toHaveCount(1);
  const rice = builder.getByRole("button", { name: /رز أبيض/ });
  await expect(rice.locator("img")).toHaveCount(1);
  await rice.click();
  await expect(rice).toHaveAttribute("aria-pressed","true");
  await expect(builder.locator(".menu-summary-data")).toContainText("رز أبيض");
});


test("all 108 cashier items have a picture reference and illustrative exceptions are flagged", async ({ page }) => {
  const { menuPreviewItems } = await import("../lib/menu-preview-items");
  expect(menuPreviewItems).toHaveLength(108);
  expect(menuPreviewItems.filter(item => !item.image)).toHaveLength(0);
  expect(menuPreviewItems.filter(item => item.illustrativeImage === true)).toHaveLength(36);
  expect(menuPreviewItems.filter(item => item.image?.startsWith("/api/menu-art"))).toHaveLength(25);
  const artwork = await page.request.get("/api/menu-art?kind=juice&tone=pink");
  expect(artwork.status()).toBe(200);
  expect(artwork.headers()["content-type"]).toContain("image/svg+xml");
  expect(await artwork.text()).toContain("<svg");
  await page.goto("/menu");
  await page.locator("#menu-products").getByRole("button", { name: "المشروبات" }).click();
  await expect(page.locator(".menu-product-card img")).toHaveCount(12);
  await expect(page.locator(".menu-product-card .menu-photo-disclosure")).toHaveCount(12);
  await expect(page.locator(".menu-product-card .menu-image-fallback")).toHaveCount(0);
});



test("redundant app catalog is removed entirely and only one priced menu is visible", async ({ page }) => {
  let duplicateRequests = 0;
  await page.route("**/api/menu-app-catalog", route => { duplicateRequests += 1; return route.abort(); });
  await page.goto("/menu");
  await expect(page.locator("#menu-app-catalog")).toHaveCount(0);
  await expect(page.locator(".menu-app-catalog-section")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "اختيارات الوجبات من التطبيق." })).toHaveCount(0);
  await expect(page.locator("#menu-products")).toBeVisible();
  await expect(page.locator("#menu-plans")).toBeVisible();
  expect(duplicateRequests).toBe(0);
});

test("below the menu, subscription and builder cards have compact mobile spacing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  const measurements = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return { width: rect?.width ?? 0, height: rect?.height ?? 0, left: rect?.left ?? -1, right: rect?.right ?? -1 };
    };
    return {
      picker: bounds(".bd-calculator-controls"),
      price: bounds(".bd-calculator-summary"),
      editor: bounds(".menu-builder-editor"),
      summary: bounds(".menu-builder-summary"),
      form: bounds(".menu-quick-lead"),
      viewport: document.documentElement.clientWidth,
    };
  });
  for (const key of ["picker", "price", "editor", "summary", "form"] as const) {
    const bounds = measurements[key];
    expect(bounds.width).toBeGreaterThan(250);
    expect(bounds.height).toBeGreaterThan(80);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(measurements.viewport + 1);
  }
  expect(measurements.price.height).toBeLessThan(700);
  await expect(page.locator(".bd-calculator-secondary a")).toHaveCount(2);
  await expect(page.locator(".menu-builder-store a")).toHaveCount(2);
});

test("meal and salad summary show real visual, selections and working reset", async ({ page }) => {
  await page.goto("/menu");
  const builder = page.locator("#menu-custom");
  await expect(builder.locator(".menu-summary-disc")).toHaveCount(0);
  await expect(builder.locator(".menu-summary-visual-photo img")).toHaveCount(1);
  await builder.getByRole("button", { name: /رز أبيض/ }).click();
  await expect(builder.locator(".menu-summary-chips")).toContainText("رز أبيض");
  await builder.getByRole("button", { name: "ابدأ من جديد" }).click();
  await expect(builder.locator(".menu-summary-chips")).not.toContainText("رز أبيض");
  await builder.getByRole("group", { name: "نوع تجربة التخصيص" })
    .getByRole("button", { name: /اصنع سلطتك/ }).click();
  await expect(builder.locator(".menu-summary-chips")).toContainText("ابدأ باختيار مكوناتك");
  await builder.getByRole("button", { name: "خس" }).click();
  await expect(builder.locator(".menu-summary-chips")).toContainText("خس");
  await builder.getByRole("button", { name: "ابدأ من جديد" }).click();
  await expect(builder.locator(".menu-summary-chips")).not.toContainText("خس");
});


test("visual review snapshots of shared calculator and builder", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(priceCatalog),
  }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  await expect(page.locator("#menu-plans .bd-calculator-price")).toContainText("١٬١٨٦");
  await page.locator("#menu-plans").screenshot({ path: "test-results/plans-mobile-390.png", animations: "disabled" });
  await page.locator("#menu-custom").screenshot({ path: "test-results/builder-meal-mobile-390.png", animations: "disabled" });
  await page.locator("#menu-custom").getByRole("group", { name: "نوع تجربة التخصيص" })
    .getByRole("button", { name: /اصنع سلطتك/ }).click();
  await page.locator("#menu-custom").screenshot({ path: "test-results/builder-salad-mobile-390.png", animations: "disabled" });
  await page.locator("#menu-download").screenshot({ path: "test-results/footer-mobile-390.png", animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#menu-plans").screenshot({ path: "test-results/plans-desktop-1440.png", animations: "disabled" });
  await page.locator("#menu-custom").screenshot({ path: "test-results/builder-salad-desktop-1440.png", animations: "disabled" });
});

test("mobile salad builder controls do not clip on either edge", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/menu");
    const builder = page.locator("#menu-custom");
    await builder.getByRole("group", { name: "نوع تجربة التخصيص" })
      .getByRole("button", { name: /اصنع سلطتك/ }).click();
    const clipped = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return Array.from(document.querySelectorAll("#menu-custom .menu-builder-editor button, #menu-custom .menu-builder-summary button, #menu-custom .menu-builder-summary a"))
        .map(element => {
          const r = element.getBoundingClientRect();
          return { text: (element.textContent || "").trim().slice(0, 32), left: r.left, right: r.right };
        })
        .filter(rect => rect.left < -1 || rect.right > viewport + 1);
    });
    expect(clipped).toEqual([]);
    await expect(builder.locator(".menu-salad-tabs button")).toHaveCount(6);
  }
});


test("home leads with food and live calculator before app presentation", async ({ page }) => {
  await page.goto("/");
  const order = await page.evaluate(() => ({
    hero: document.querySelector(".hero")?.getBoundingClientRect().top ?? 0,
    food: document.querySelector("#meals")?.getBoundingClientRect().top ?? 0,
    plans: document.querySelector("#plans")?.getBoundingClientRect().top ?? 0,
    how: document.querySelector("#how-it-works")?.getBoundingClientRect().top ?? 0,
    app: document.querySelector("#app")?.getBoundingClientRect().top ?? 0,
  }));
  expect(order.hero).toBeLessThan(order.food);
  expect(order.food).toBeLessThan(order.plans);
  expect(order.plans).toBeLessThan(order.how);
  expect(order.how).toBeLessThan(order.app);
  await expect(page.getByRole("link", { name: "احسب باقتك" }).first()).toBeVisible();
});

test("mobile menu search and categories are swipeable and option targets exceed 44px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  const controls = page.locator("#menu-products .menu-catalog-tools");
  await expect(controls.getByRole("searchbox")).toBeVisible();
  const rail = controls.getByRole("group", { name: "تصنيفات المنيو" });
  const css = await rail.evaluate(el => ({ nowrap: getComputedStyle(el).flexWrap,
    overflow: getComputedStyle(el).overflowX }));
  expect(css.nowrap).toBe("nowrap");
  expect(["auto", "scroll"]).toContain(css.overflow);
  await page.locator(".menu-product-card").filter({ has: page.getByRole("heading", { name: "جمبري" }) })
    .locator(".menu-product-bottom button").click();
  const heights = await page.getByRole("dialog", { name: "جمبري" }).getByRole("button", { name: /جم/ })
    .evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().height));
  expect(heights.length).toBe(3);
  expect(heights.every(height => height >= 44)).toBeTruthy();
});


test("the 15% savings are displayed without exposing a customer-facing coupon code", async ({ page }) => {
  await page.route("**/api/plan-catalog", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(priceCatalog),
  }));
  await page.goto("/menu");
  const calculator = page.locator("#menu-plans");
  const money = new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await expect(calculator.locator(".bd-calculator-offer-price strong")).toContainText(money.format(1008.1));
  await expect(calculator.locator(".bd-calculator-offer-savings b")).toContainText(money.format(177.9));
  await expect(page.locator("body")).not.toContainText("BASIC15");
  await expect(page.locator(".menu-hero .bd-offer-copy")).toContainText("15%");
  await expect(page.locator(".menu-offer-inline")).toContainText("بدون دفع");
  await expect(page.locator("#menu-download")).toContainText("15%");
});

test("header website offer opens registration directly and submits an unconfirmed plan interest to the same CRM route", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/lead-options", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ status: true, data: [
      { planId: "6a621995f4f8d0974cebc472", daysCount: 26,
        gramsOptions: [{ grams: 150, mealsPerDay: [2] }] },
    ] }),
  }));
  await page.route("**/api/leads", async route => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 202, contentType: "application/json", body: '{"status":true}' });
  });
  await page.goto("/menu");
  await page.locator(".nav-actions").getByRole("button", { name: "سجّل لخصم 15%" }).click();
  const dialog = page.locator(".lead-dialog");
  await expect(dialog.getByRole("heading", { name: "خصم 15% على اشتراكك" })).toBeVisible();
  await expect(dialog.locator(".lead-selection-summary")).toContainText("لم تحدد باقة");
  await dialog.getByRole("textbox", { name: /اسمك/ }).fill("عميل موقع");
  await dialog.getByRole("textbox", { name: "رقم الجوال" }).fill("0501234567");
  await dialog.getByRole("checkbox", { name: /أوافق على التواصل/ }).check();
  await dialog.getByRole("button", { name: "سجّل لخصم 15%" }).click();
  await expect(dialog.getByRole("heading", { name: "وصلنا طلبك!" })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0].name).toBe("عميل موقع");
  expect(sent[0].phone).toBe("+966501234567");
  expect(sent[0].planUnselected).toBe(true);
  expect(sent[0].planId).toBeUndefined();
  expect(sent[0].contactConsent).toBe(true);
  expect(sent[0].location).toBe("header");
  expect(String(sent[0].content)).toContain("plan_to_confirm");
  expect(String(sent[0].content)).toContain("offer15");
});

test("mobile promo bar appears after first scroll and hides at footer form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu");
  await expect(page.locator(".bd-offer-mobile-bar")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 650));
  await expect(page.locator(".bd-offer-mobile-bar")).toBeVisible();
  await page.locator("#menu-download").scrollIntoViewIfNeeded();
  await expect(page.locator(".bd-offer-mobile-bar")).toHaveCount(0);
});

test("homepage promotes website registration but keeps the food and plan paths", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /وجبات تحبها/ })).toBeVisible();
  await expect(page.locator(".hero .bd-offer-copy")).toContainText("15%");
  await expect(page.locator(".hero .bd-offer-copy")).toContainText("بدون دفع الآن");
  await expect(page.locator(".hero a[href='#plans']")).toHaveCount(1);
  await expect(page.locator(".hero a[href='/menu#menu-products']")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("BASIC15");
});


test("no-plan website registration opens before catalog network settles", async ({ page }) => {
  let catalogCalls = 0;
  await page.route("**/api/lead-options", async route => { catalogCalls++; await route.abort(); });
  await page.goto("/menu");
  await page.locator(".nav-actions").getByRole("button", { name: "سجّل لخصم 15%" }).click();
  const dialog = page.locator(".lead-dialog");
  await expect(dialog.getByRole("textbox", { name: /اسمك/ })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "رقم الجوال" })).toBeVisible();
  await expect(dialog).not.toContainText("جاري تحميل الباقات");
  expect(catalogCalls).toBe(0);
  await expect(dialog.locator(".lead-form-actions button[type='submit']")).toBeVisible();
});

test("form submit button remains visible at bottom on short mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 520 });
  await page.goto("/menu");
  await page.locator(".nav-actions").getByRole("button", { name: "سجّل لخصم 15%" }).click();
  const dialog = page.locator(".lead-dialog");
  const button = dialog.locator(".lead-form-actions button[type='submit']");
  await expect(button).toBeVisible();
  const [submitBox, dialogBox] = await Promise.all([button.boundingBox(), dialog.boundingBox()]);
  expect(submitBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(submitBox!.y).toBeGreaterThan(dialogBox!.y);
  expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(520);
  const scroll = await dialog.locator(".lead-form-scroll").evaluate(e => ({
    client: e.clientHeight, scroll: e.scrollHeight, overflow: getComputedStyle(e).overflowY,
  }));
  expect(["auto", "scroll"]).toContain(scroll.overflow);
});

test("double activation of registration CTA sends only one request", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/leads", async route => {
    requests++;
    await route.fulfill({ status: 202, contentType: "application/json", body: '{"status":true}' });
  });
  await page.goto("/menu");
  await page.locator(".nav-actions").getByRole("button", { name: "سجّل لخصم 15%" }).click();
  const dialog = page.locator(".lead-dialog");
  await dialog.getByRole("textbox", { name: /اسمك/ }).fill("عميل تجريبي");
  await dialog.getByRole("textbox", { name: "رقم الجوال" }).fill("0501234567");
  await dialog.getByRole("checkbox", { name: /أوافق على التواصل/ }).check();
  const submit = dialog.locator(".lead-form-actions button[type='submit']");
  await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(dialog.getByRole("heading", { name: "وصلنا طلبك!" })).toBeVisible();
  expect(requests).toBe(1);
  const recorded = await page.evaluate(() => {
    const layer = (window as typeof window & { dataLayer?: Array<{ event?: string; placement?: string }> }).dataLayer || [];
    return layer.filter(e => e.event === "lp_lead_opened" || e.event === "lp_lead_submitted");
  });
  expect(recorded.filter(e => e.event === "lp_lead_opened")).toHaveLength(1);
  expect(recorded.filter(e => e.event === "lp_lead_submitted")).toHaveLength(1);
});

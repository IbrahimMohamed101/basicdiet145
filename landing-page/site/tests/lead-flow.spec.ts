import { expect, test } from "@playwright/test";

const catalog = {
  status: true,
  data: [
    { planId: "507f1f77bcf86cd799439001", daysCount: 7,
      gramsOptions: [{ grams: 100, mealsPerDay: [1, 2] }, { grams: 150, mealsPerDay: [1, 2] }] },
    { planId: "507f1f77bcf86cd799439026", daysCount: 26,
      gramsOptions: [
        { grams: 100, mealsPerDay: [1, 2, 3, 4, 5] },
        { grams: 150, mealsPerDay: [1, 2, 3, 4, 5] },
        { grams: 200, mealsPerDay: [1, 2, 3, 4, 5] },
      ] },
    { planId: "507f1f77bcf86cd799439030", daysCount: 30,
      gramsOptions: [{ grams: 150, mealsPerDay: [1, 2, 3] }] },
  ],
};

test("benefits CTA carries selected grams, meals, delivery and explicit consent into the lead request", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route("**/api/lead-options", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) });
  });
  await page.route("**/api/leads", async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: true }) });
  });
  await page.goto("/?utm_source=instagram&utm_campaign=autumn", { waitUntil: "domcontentloaded" });
  await page.locator('label:has(input[name="grams"][value="200"])').click();
  await page.locator('label:has(input[name="meals"][value="5"])').click();
  await page.locator('label:has(input[name="delivery"][value="استلام"])').click();
  await page.getByRole("button", { name: "اطلب اشتراكك" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "حجم الوجبة" })).toHaveValue("200");
  await expect(dialog.getByRole("combobox", { name: "وجبات يوميًا" })).toHaveValue("5");
  await expect(dialog.getByRole("button", { name: "استلام" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: /متابعة/ }).click();
  await expect(dialog.getByText(/26 يوم · 200 جرام · 5 وجبات يوميًا · استلام/)).toBeVisible();
  await dialog.getByPlaceholder("05xxxxxxxx").fill("0500000000");
  await expect(dialog.getByRole("button", { name: "اطلب تواصل من Basic Diet" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /أوافق على التواصل/ }).check();
  await dialog.getByRole("button", { name: "اطلب تواصل من Basic Diet" }).click();
  await expect(dialog.getByRole("heading", { name: "وصلنا طلبك!" })).toBeVisible();
  expect(submitted).toMatchObject({
    phone: "+966500000000", planId: "507f1f77bcf86cd799439026",
    grams: 200, mealsPerDay: 5, daysCount: 26,
    fulfillmentMethod: "pickup", location: "benefits",
    contactConsent: true, marketingConsent: false,
  });
  // The confirmation remains a lead, not a payment or subscription record.
  await expect(dialog.getByRole("link", { name: /App Store/ })).toBeVisible();
  await dialog.getByRole("button", { name: "رجوع للموقع" }).click();
  await expect(dialog).not.toBeVisible();
});

test("mobile sheet keeps layout within viewport and 7-day plan selection survives", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/lead-options", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) })
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const plan = page.locator('.plan-option').filter({ has: page.getByText("7", { exact: true }) });
  await plan.getByRole("button").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /7 يوم/ })).toHaveAttribute("aria-pressed", "true");
  // The sheet intentionally animates from below the viewport for ~260ms.
  // Poll for the settled position instead of measuring the entrance frame.
  await expect.poll(async () => {
    const box = await dialog.boundingBox();
    return box ? box.y + box.height : Infinity;
  }).toBeLessThanOrEqual(845);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await dialog.getByRole("button", { name: "إغلاق النافذة" }).click();
  await expect(dialog).not.toBeVisible();
});

test("disabled plan catalog displays an app fallback without collecting a phone", async ({ page }) => {
  await page.route("**/api/lead-options", route =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: false, data: [] }) })
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "اطلب اشتراكك" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/تعذر تحميل الباقات/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /متابعة/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "إغلاق النافذة" }).click();
});

test("privacy notice is reachable from required consent and provides the support phone", async ({ page }) => {
  await page.route("**/api/lead-options", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) })
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "اطلب اشتراكك" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /متابعة/ }).click();
  const link = dialog.getByRole("link", { name: "سياسة الخصوصية" });
  await expect(link).toHaveAttribute("href", "/privacy");
  const res = await page.request.get("/privacy");
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body).toContain("180");
  expect(body).toContain("+966 53 533 2639");
});

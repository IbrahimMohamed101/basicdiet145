import { expect, test } from "@playwright/test";

test("a successful registration emits the accepted requestId and keeps Instagram attribution", async ({ page }) => {
  let accepted: Record<string, unknown> | undefined;
  await page.addInitScript(() => {
    const state = window as Window & { __acceptedLead?: Record<string, unknown> };
    window.addEventListener("basicdiet:lead_submitted", (event) => {
      state.__acceptedLead = (event as CustomEvent<Record<string, unknown>>).detail;
    });
  });
  await page.route("**/api/leads", async (route) => {
    accepted = route.request().postDataJSON();
    await route.fulfill({ status: 202, json: { status: true } });
  });
  await page.goto("/?utm_source=instagram&utm_medium=paid_social&utm_campaign=jeddah_test&utm_content=ad_123");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("basicdiet_lp_attribution_v1") || "")).toContain("jeddah_test");
  await page.goto("/menu");
  await page.locator(".nav-actions").getByRole("button", { name: "سجّل لخصم 15%" }).click();
  const dialog = page.locator(".lead-dialog");
  await dialog.getByRole("textbox", { name: /اسمك/ }).fill("Test customer");
  await dialog.getByRole("textbox", { name: "رقم الجوال" }).fill("0500000000");
  await dialog.getByRole("checkbox", { name: /أوافق على التواصل/ }).check();
  await dialog.getByRole("button", { name: "سجّل لخصم 15%" }).click();
  await expect(dialog.getByRole("heading", { name: "وصلنا طلبك!" })).toBeVisible();
  expect(accepted).toMatchObject({
    source: "instagram", medium: "paid_social", campaign: "jeddah_test",
  });
  expect(String(accepted?.content)).toContain("ad_123");
  const emitted = await page.evaluate(() => (window as Window & { __acceptedLead?: Record<string, unknown> }).__acceptedLead);
  expect(emitted?.requestId).toBe(accepted?.requestId);
  expect(String(emitted?.requestId)).toMatch(/^[0-9a-f-]{36}$/);
  expect(emitted).not.toHaveProperty("phone");
  expect(emitted).not.toHaveProperty("name");
});

test("Meta Pixel is not injected when the feature flag is disabled", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_META_PIXEL_ENABLED === "true", "only tests the disabled-by-default setup");
  await page.goto("/menu");
  await expect(page.locator('script[src*="fbevents.js"]')).toHaveCount(0);
  expect(await page.evaluate(() => Boolean((window as Window & { fbq?: unknown }).fbq))).toBe(false);
});

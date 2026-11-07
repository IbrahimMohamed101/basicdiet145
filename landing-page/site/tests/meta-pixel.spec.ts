import { expect, test } from "@playwright/test";

const PIXEL_SCRIPT = "script[data-meta-pixel='2169098140651936']";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("basicdiet_meta_pixel_consent_v1");
  });
  await page.route("https://connect.facebook.net/en_US/fbevents.js", route => route.fulfill({
    status: 200, contentType: "application/javascript", body: "",
  }));
});

test("Meta verification tag is in server HTML, while Pixel waits for consent", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="facebook-domain-verification"]')).toHaveAttribute(
    "content", "3b52rqmckolpiqw6r0dkqrnfuwgovn",
  );
  await expect(page.getByRole("complementary", { name: "تفضيلات ملفات الارتباط والإعلانات" })).toBeVisible();
  await expect(page.locator(PIXEL_SCRIPT)).toHaveCount(0);
  await page.getByRole("button", { name: "رفض التتبع" }).click();
  await expect(page.locator(PIXEL_SCRIPT)).toHaveCount(0);
});

test("consent enables PageView and successful-lead tracking without personal data", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "السماح بالتتبع" }).click();
  await expect(page.locator(PIXEL_SCRIPT)).toHaveCount(1);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("basicdiet:lead_submitted", { detail: { offer: true } }));
  });
  const events = await page.evaluate(() => (window.fbq?.queue || []).map(args => args.slice(0, 3)));
  expect(events).toContainEqual(["track", "PageView"]);
  expect(events).toContainEqual(["track", "Lead", { content_name: "discount_15_signup" }]);
});

test("privacy page can reopen consent settings", async ({ page }) => {
  await page.goto("/privacy", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "رفض التتبع" }).click();
  await page.getByRole("button", { name: "تغيير تفضيلات التتبع" }).click();
  await expect(page.getByRole("button", { name: "السماح بالتتبع" })).toBeVisible();
});

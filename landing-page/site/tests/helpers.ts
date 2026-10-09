import type { Page } from "@playwright/test";

/** Stub services not configured in CI; preserve real first-party page, store and meal behavior. */
export async function isolateInstagram(page: Page) {
  await page.route("**/api/analytics", route => route.fulfill({ status: 204 }));
  await page.route("https://www.instagram.com/**", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html lang="ar"><body style="margin:0;background:#203c2c;color:white">Official embed isolated for deterministic layout QA</body></html>',
  }));
}

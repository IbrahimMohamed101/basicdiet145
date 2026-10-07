import type { Page } from "@playwright/test";

/** Keep third-party widget/network policy noise separate from first-party QA.
 * Live official embeds are also inspected separately; meal images stay real. */
export async function isolateInstagram(page: Page) {
  await page.route("https://www.instagram.com/**", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html lang="ar"><body style="margin:0;background:#203c2c;color:white">Official embed isolated for deterministic layout QA</body></html>',
  }));
}

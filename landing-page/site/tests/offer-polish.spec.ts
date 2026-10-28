import { expect, test } from "@playwright/test";

async function openForm(page: import('@playwright/test').Page) {
  await page.goto('/menu');
  await page.locator('.nav-actions').getByRole('button', { name: 'سجّل لخصم 15%' }).click();
  return page.locator('.lead-dialog');
}

test('Arabic phone input normalizes and failed requests never show success or conversion', async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/leads', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: bodies.length === 1 ? 503 : 202, json: { status: bodies.length > 1 } });
  });
  const dialog = await openForm(page);
  await dialog.getByRole('textbox', { name: /اسمك/ }).fill('QA fixture');
  await dialog.getByRole('textbox', { name: 'رقم الجوال' }).fill('٠٥٠٠٠٠٠٠٠٠');
  await dialog.getByRole('checkbox', { name: /أوافق على التواصل/ }).check();
  await dialog.getByRole('button', { name: 'سجّل لخصم 15%' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'وصلنا طلبك!' })).toHaveCount(0);
  expect(bodies[0].phone).toBe('+966500000000');
  expect(await page.evaluate(() => ((window as any).dataLayer || []).filter((e: any) => e.event === 'lp_lead_submitted').length)).toBe(0);
  await dialog.getByRole('button', { name: 'سجّل لخصم 15%' }).click();
  await expect(dialog.getByRole('heading', { name: 'وصلنا طلبك!' })).toBeVisible();
  expect(bodies[1].requestId).toBe(bodies[0].requestId);
});

test('a late response cannot replace a newly reopened form with an old success', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route('**/api/leads', async route => {
    started = true;
    await gate;
    await route.fulfill({ status: 202, json: { status: true } });
  });
  const dialog = await openForm(page);
  await dialog.getByRole('textbox', { name: /اسمك/ }).fill('QA fixture');
  await dialog.getByRole('textbox', { name: 'رقم الجوال' }).fill('0500000000');
  await dialog.getByRole('checkbox', { name: /أوافق على التواصل/ }).check();
  await dialog.getByRole('button', { name: 'سجّل لخصم 15%' }).click();
  await expect.poll(() => started).toBe(true);
  await dialog.getByRole('button', { name: 'إغلاق النافذة' }).click();
  await page.locator('.nav-actions').getByRole('button', { name: 'سجّل لخصم 15%' }).click();
  release();
  await expect(dialog.getByRole('textbox', { name: /اسمك/ })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'سجّل لخصم 15%' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'وصلنا طلبك!' })).toHaveCount(0);
});

test('calculator outage preserves a working registration route without a fabricated plan', async ({ page }) => {
  await page.route('**/api/plan-catalog', route => route.fulfill({ status: 503, json: { data: [] } }));
  await page.goto('/');
  const calculator = page.locator('#plans');
  await expect(calculator).toContainText('تعذّر تحميل الأسعار');
  await calculator.getByRole('button', { name: /سجّل لخصم 15%/ }).click();
  await expect(page.locator('.lead-dialog .lead-selection-summary')).toContainText('لم تحدد باقة');
});

test('homepage food gallery and final offer use the canonical menu and registration', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#meals .meal-card')).toHaveCount(6);
  await expect(page.locator('#meals .meal-card-price')).toHaveCount(6);
  await expect(page.locator('#meals .meal-soon-ribbon')).toHaveCount(0);
  await expect(page.locator('#meals .food-link')).toHaveAttribute('href', '/menu');
  await expect(page.locator('.final-cta')).toContainText('15%');
  await page.locator('.final-cta').getByRole('button', { name: /سجّل لخصم 15%/ }).click();
  await expect(page.getByRole('dialog', { name: 'خصم 15% على اشتراكك' })).toBeVisible();
});

for (const [width, height] of [[320, 520], [390, 640], [1440, 900]]) {
  test(`registration fields remain reachable and submit stays visible at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const dialog = await openForm(page);
    const button = dialog.locator('button[type="submit"]');
    await expect(button).toBeVisible();
    await expect.poll(async () => {
      const box = await button.boundingBox();
      return box ? box.y + box.height : Infinity;
    }).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `test-results/registration-${width}x${height}.png`, animations: 'disabled' });
    await dialog.getByRole('textbox', { name: 'رقم الجوال' }).fill('0500000000');
    await dialog.getByRole('checkbox', { name: /أوافق على التواصل/ }).check();
    await expect(button).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}


test('legacy plan selection can scroll to continue on a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 520 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/lead-options', route => route.fulfill({ json: { data: [
    { planId: '507f1f77bcf86cd799439026', daysCount: 26, gramsOptions: [{ grams: 150, mealsPerDay: [2] }] }
  ] } }));
  await page.goto('/jeddah/healthy-meals');
  await page.locator('.nav-actions').getByRole('button', { name: 'ابدأ اشتراكك' }).click();
  const dialog = page.locator('.lead-dialog');
  await dialog.getByRole('button', { name: /متابعة/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'رقم الجوال' })).toBeVisible();
});

for (const width of [320, 390]) {
  test(`all five daily meal choices fit one touchable row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/menu');
    const buttons = page.locator('#menu-plans fieldset').nth(2).getByRole('button');
    const boxes = await buttons.evaluateAll(elements => elements.map(element => {
      const b = element.getBoundingClientRect(); return { y: b.y, width: b.width, height: b.height };
    }));
    expect(boxes).toHaveLength(5);
    expect(Math.max(...boxes.map(b => b.y)) - Math.min(...boxes.map(b => b.y))).toBeLessThan(1);
    expect(boxes.every(b => b.width >= 44 && b.height >= 44)).toBe(true);
  });
}

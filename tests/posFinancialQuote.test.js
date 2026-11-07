"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const catalog = require("../src/services/pos/stagingCatalog.json");
const { pricePosCheckout, PosFinancialError } = require("../src/services/pos/financialQuoteService");
const doc = { publishedRevision: 7, published: catalog };
const req = (x = {}) => ({ revision: 7, channel: "restaurant",
  items: [{ productId: "butter", variantId: "150", quantity: 2,
    addons: [{ productId: "extra-chicken", quantity: 3 }] }], ...x });

test("D-086/#86 add-ons with quantity 3 are priced as a separate parent-linked line", () => {
  const q = pricePosCheckout(doc, req());
  assert.equal(q.lines.length, 2);
  assert.equal(q.lines[0].quantity, 2);
  assert.equal(q.lines[1].quantity, 6);
  assert.equal(q.lines[1].parentLineId, q.lines[0].id);
  assert.equal(q.lines[1].perMealAddonQuantity, 3);
  assert.equal(q.lines[1].grossHalalas, 3000);
  assert.equal(q.lines[1].vatHalalas, 391);
  assert.equal(q.totals.grossHalalas, 9400);
});
test("D-088 fixed and percent discounts use server prices, not client totals", () => {
  const q = pricePosCheckout(doc, req({
    items: [{ productId: "butter", variantId: "150", quantity: 1, discount: {
      type: "fixed", value: 200,
    }, addons: [{ productId: "extra-chicken", quantity: 2, discount: {
      type: "percent", value: 10,
    } }] }],
    invoiceDiscount: { type: "percent", value: 10 },
    finalPayableHalalas: 0, unitPriceHalalas: 0, vatHalalas: 0,
  }));
  assert.equal(q.totals.beforeDiscountHalalas, 4200);
  assert.equal(q.totals.lineDiscountHalalas, 300);
  assert.equal(q.totals.invoiceDiscountHalalas, 390);
  assert.equal(q.totals.grossHalalas, 3510);
});
test("rejected stale version and unpriced channel", () => {
  assert.throws(() => pricePosCheckout(doc, req({ revision: 6 })), err =>
    err instanceof PosFinancialError && err.code === "POS_CATALOG_CONFLICT" && err.status === 409);
  assert.throws(() => pricePosCheckout(doc, req({ channel: "other" })), /قناة البيع/);
});
test("reject duplicate IDs, invalid quantity and client attempts to offer unavailable addons", () => {
  assert.throws(() => pricePosCheckout(doc, req({ items: [{
    productId: "butter", variantId: "150", quantity: 1,
    addons: [{ productId: "extra-chicken", quantity: 2 }, { productId: "extra-chicken", quantity: 2 }],
  }] })), /مكررة/);
  assert.throws(() => pricePosCheckout(doc, req({ items: [{
    productId: "butter", variantId: "150", quantity: 1,
    addons: [{ productId: "extra-chicken", quantity: 11 }],
  }] })), /كمية/);
  assert.throws(() => pricePosCheckout(doc, req({ items: [{
    productId: "water", variantId: "bottle", quantity: 1,
    addons: [{ productId: "extra-chicken", quantity: 1 }],
  }] })), /الإضافات غير مسموحة/);
});
test("no cashier discount cap when null; non-null cap is enforced", () => {
  const body = req({ invoiceDiscount: { type: "fixed", value: 500 } });
  assert.ok(pricePosCheckout(doc, body, { cashierDiscountCapHalalas: null }));
  assert.throws(() => pricePosCheckout(doc, body, { cashierDiscountCapHalalas: 499 }), /سقف/);
});

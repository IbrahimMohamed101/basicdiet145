"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fixture = require("../src/services/pos/stagingCatalog.json");
const { quotePosCart, PosQuoteError } = require("../src/services/pos/quoteService");

const doc = { publishedRevision: 4, published: fixture };

function request(overrides = {}) {
  return {
    revision: 4,
    channel: "restaurant",
    items: [{ productId: "butter", variantId: "150", quantity: 2, addonIds: ["extra-chicken"] }],
    ...overrides,
  };
}

test("quote uses published POS channel price and validates add-ons in integer halalas", () => {
  const restaurant = quotePosCart(doc, request());
  assert.equal(restaurant.provisionalSubtotalHalalas, 7400);
  assert.equal(restaurant.lines[0].unitPriceHalalas, 3700);
  assert.equal(restaurant.itemCount, 2);
  assert.equal(restaurant.finalPayableHalalas, null);
  assert.equal(restaurant.canCommit, false);
  assert.equal(restaurant.taxHalalas, null);
  const delivery = quotePosCart(doc, request({ channel: "hungerstation" }));
  assert.equal(delivery.provisionalSubtotalHalalas, 8400);
});

test("rejects stale published price list with HTTP 409", () => {
  assert.throws(
    () => quotePosCart(doc, request({ revision: 3 })),
    (err) => err instanceof PosQuoteError && err.status === 409 && err.code === "POS_CATALOG_CONFLICT"
  );
});

test("rejects channel without a configured price", () => {
  assert.throws(
    () => quotePosCart(doc, request({ channel: "keeta", items: [
      { productId: "tikka", variantId: "200", quantity: 1 },
    ] })),
    (err) => err.code === "POS_PRICE_UNAVAILABLE"
  );
});

test("rejects nonexistent, inactive, or incompatible add-ons", () => {
  const invalid = [{ productId: "butter", variantId: "150", quantity: 1, addonIds: ["water"] }];
  assert.throws(() => quotePosCart(doc, request({ items: invalid })), /الإضافة/);
  const disabled = structuredClone(doc);
  disabled.published.products[0].active = false;
  assert.throws(() => quotePosCart(disabled, request()), (err) => err.code === "POS_PRODUCT_UNAVAILABLE");
  assert.throws(() => quotePosCart(doc, request({ items: [
    { productId: "water", variantId: "bottle", quantity: 1, addonIds: ["extra-chicken"] },
  ] })), /الإضافات غير متاحة/);
});

test("rejects arbitrary prices, duplicate add-ons, invalid quantity and malformed inputs", () => {
  assert.throws(() => quotePosCart(doc, request({ items: [
    { productId: "butter", variantId: "150", quantity: 1, addonIds: ["extra-chicken", "extra-chicken"] },
  ] })), /مكررة/);
  for (const qty of [-1, 0, 1.5, 100, "1"]) {
    assert.throws(() => quotePosCart(doc, request({ items: [
      { productId: "water", variantId: "bottle", quantity: qty },
    ] })), /الكمية/);
  }
  assert.throws(() => quotePosCart(doc, request({ items: [] })), /عدد أصناف/);
  assert.throws(() => quotePosCart(doc, request({ channel: "unknown" })), /قناة/);
  assert.throws(() => quotePosCart(doc, request({ revision: "4" })), /نسخة/);
  assert.equal(quotePosCart(doc, request({ items: [
    { productId: "water", variantId: "bottle", quantity: 1, price: -999 },
  ] })).provisionalSubtotalHalalas, 300);
});

test("totals cannot overflow safe bounded limits", () => {
  const oversized = structuredClone(doc);
  oversized.published.products[0].variants[1].prices.restaurant = 10_000_000;
  const lines = Array.from({ length: 50 }, () => ({
    productId: "butter", variantId: "150", quantity: 99,
  }));
  assert.throws(() => quotePosCart(oversized, request({ items: lines })), (err) => err.code === "POS_QUOTE_LIMIT");
});


test("server quote accepts new configured channel with its own price", () => {
  const expanded = structuredClone(doc);
  expanded.published.channels = [
    { id: "restaurant", label: "المطعم" },
    { id: "hungerstation", label: "HungerStation" },
    { id: "keeta", label: "Keeta" },
    { id: "fourth-channel", label: "تطبيق رابع" },
  ];
  for (const item of expanded.published.products) {
    for (const size of item.variants) size.prices["fourth-channel"] = null;
  }
  expanded.published.products[0].variants[1].prices["fourth-channel"] = 5200;
  const quote = quotePosCart(expanded, request({
    channel: "fourth-channel",
    items: [{ productId: "butter", variantId: "150", quantity: 2, addonIds: [] }],
  }));
  assert.equal(quote.provisionalSubtotalHalalas, 10400);
  assert.equal(quote.canCommit, false);
  assert.throws(() => quotePosCart(expanded, request({ channel: "other" })), /قناة/);
});


test("per-product add-on allowlist prevents invalid protein combinations", () => {
  const restricted = structuredClone(doc);
  restricted.published.products[0].allowedAddonIds = ["extra-chicken"];
  const good = quotePosCart(restricted, request({
    items: [{ productId: "butter", variantId: "150", quantity: 1, addonIds: ["extra-chicken"] }],
  }));
  assert.equal(good.provisionalSubtotalHalalas, 3700);
  assert.throws(() => quotePosCart(restricted, request({
    items: [{ productId: "butter", variantId: "150", quantity: 1, addonIds: ["extra-beef"] }],
  })), (err) => err.code === "POS_ADDON_UNAVAILABLE");
});


test("attached add-ons stay priceable but standalone add-ons require opt-in", () => {
  const attached = quotePosCart(doc, request());
  assert.equal(attached.lines[0].addons[0].productId, "extra-chicken");
  assert.throws(() => quotePosCart(doc, request({ items: [
    { productId: "extra-chicken", variantId: "portion", quantity: 1, addonIds: [] },
  ] })), (err) => err.code === "POS_PRODUCT_UNAVAILABLE");

  const enabled = structuredClone(doc);
  enabled.published.products.find((item) => item.id === "extra-chicken").sellStandalone = true;
  const result = quotePosCart(enabled, request({ items: [
    { productId: "extra-chicken", variantId: "portion", quantity: 2, addonIds: [] },
  ] }));
  assert.equal(result.provisionalSubtotalHalalas, 1000);
  assert.equal(result.canCommit, false);
});

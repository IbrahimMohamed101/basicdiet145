"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizePosCatalog } = require("../src/services/pos/catalogValidation");
const seed = require("../src/services/pos/stagingCatalog.json");

test("independent POS fixture keeps distinct prices, missing prices and extras", () => {
  const catalog = normalizePosCatalog(seed);
  const tikka = catalog.products.find(({ id }) => id === "tikka");
  assert.deepEqual(tikka.variants.find(({ id }) => id === "200").prices, {
    restaurant: 3900, hungerstation: 4500, keeta: null,
  });
  assert.equal(catalog.products.find(({ id }) => id === "extra-chicken").category, "addons");
});

test("rejects invalid prices and references rather than writing a partial draft", () => {
  for (const value of [-1, 0.4, "2500", undefined]) {
    const bad = structuredClone(seed);
    bad.products[0].variants[0].prices.restaurant = value;
    assert.throws(() => normalizePosCatalog(bad), /سعر/);
  }
  const bad = structuredClone(seed);
  bad.products[0].category = "app-menu-category";
  assert.throws(() => normalizePosCatalog(bad), /تصنيف/);
});


test("adds a new POS channel without code changes while requiring every variant price field", () => {
  const copy = structuredClone(seed);
  copy.channels = [
    { id: "restaurant", label: "المطعم" },
    { id: "hungerstation", label: "HungerStation" },
    { id: "keeta", label: "Keeta" },
    { id: "other-app", label: "تطبيق آخر" },
  ];
  for (const product of copy.products) {
    for (const variant of product.variants) variant.prices["other-app"] = null;
  }
  const result = normalizePosCatalog(copy);
  assert.equal(result.channels.length, 4);
  assert.equal(result.products[0].variants[0].prices["other-app"], null);
  copy.products[0].variants[0].prices["other-app"] = 3500;
  assert.equal(normalizePosCatalog(copy).products[0].variants[0].prices["other-app"], 3500);
  delete copy.products[0].variants[0].prices["other-app"];
  assert.throws(() => normalizePosCatalog(copy), /سعر/);
  copy.channels[3].id = "keeta";
  assert.throws(() => normalizePosCatalog(copy), /مكرر/);
  copy.channels[3].id = "other-app";
  copy.channels = copy.channels.filter((channel) => channel.id !== "restaurant");
  assert.throws(() => normalizePosCatalog(copy), /المطعم/);
});


test("product-specific add-on allowlist references only valid add-on items", () => {
  const scoped = structuredClone(seed);
  scoped.products[0].allowedAddonIds = ["extra-chicken"];
  assert.deepEqual(normalizePosCatalog(scoped).products[0].allowedAddonIds, ["extra-chicken"]);
  scoped.products[0].allowedAddonIds = ["butter"];
  assert.throws(() => normalizePosCatalog(scoped), /إضافة/);
  scoped.products[0].allowedAddonIds = ["missing-extra"];
  assert.throws(() => normalizePosCatalog(scoped), /إضافة/);
  scoped.products[0].allowedAddonIds = ["extra-chicken", "extra-chicken"];
  assert.throws(() => normalizePosCatalog(scoped), /مكرر/);
});


test("standalone add-on sales require explicit manager catalog authorization", () => {
  const input = structuredClone(seed);
  const result = normalizePosCatalog(input);
  const addon = result.products.find((item) => item.id === "extra-chicken");
  assert.equal(addon.sellStandalone, false, "legacy add-ons default to attached-only");
  input.products.find((item) => item.id === "extra-chicken").sellStandalone = true;
  assert.equal(normalizePosCatalog(input).products.find((item) => item.id === "extra-chicken").sellStandalone, true);
  input.products[0].sellStandalone = true;
  assert.throws(() => normalizePosCatalog(input), /منفردة/);
  delete input.products[0].sellStandalone;
  input.products.find((item) => item.id === "extra-chicken").sellStandalone = "yes";
  assert.throws(() => normalizePosCatalog(input), /منفردة/);
});

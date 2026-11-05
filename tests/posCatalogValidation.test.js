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

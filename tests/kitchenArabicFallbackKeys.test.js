"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  mergeLocalizedPair,
} = require("../src/services/dashboard/installKitchenArabicCatalogAuthority");

assert.deepStrictEqual(
  mergeLocalizedPair(null, { ar: "beef", en: "beef" }, "beef"),
  { ar: "لحم بقري", en: "beef" },
  "English beef snapshots must never be mirrored into Arabic"
);

assert.deepStrictEqual(
  mergeLocalizedPair(null, "chicken", "chicken"),
  { ar: "دجاج", en: "chicken" },
  "English chicken snapshots must resolve to an Arabic label"
);

assert.deepStrictEqual(
  mergeLocalizedPair(null, "", "white_rice"),
  { ar: "أرز أبيض", en: "white_rice" },
  "An empty carb snapshot must resolve from its canonical key"
);

assert.deepStrictEqual(
  mergeLocalizedPair(null, { ar: "red_sauce_pasta", en: "Red Sauce Pasta" }, "red_sauce_pasta"),
  { ar: "مكرونة بالصلصة الحمراء", en: "Red Sauce Pasta" },
  "An English-only carb snapshot must receive the Arabic canonical fallback"
);

console.log("Kitchen Arabic fallback key checks passed");

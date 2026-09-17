"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  attachPremiumLargeSaladGroups,
  attachPremiumLargeSaladMembership,
  canonicalSaladGroupKey,
  containsPremiumLargeSalad,
} = require("../src/services/installFlutterPremiumLargeSaladOptionGroups");

const PRODUCT_ID = "6a6227bc79ee075a57f7026e";
const groupDefinitions = [
  ["leafy_greens", 3, 0, 2],
  ["vegetables", 19, 0, 19],
  ["protein", 11, 1, 1],
  ["cheese_nuts", 5, 0, 2],
  ["fruits", 9, 0, 4],
  ["sauce", 8, 1, 1],
];

function buildGroups() {
  let optionSequence = 0;
  return groupDefinitions.map(([key, count, minSelections, maxSelections], groupIndex) => ({
    id: `group-${groupIndex + 1}`,
    groupId: `group-${groupIndex + 1}`,
    key,
    sourceKey: key,
    name: key,
    nameI18n: { ar: key, en: key },
    minSelections,
    maxSelections,
    required: minSelections > 0,
    isRequired: minSelections > 0,
    sortOrder: (groupIndex + 1) * 10,
    options: Array.from({ length: count }, (_, optionIndex) => {
      optionSequence += 1;
      return {
        id: `option-${optionSequence}`,
        optionId: `option-${optionSequence}`,
        key: `${key}-${optionIndex + 1}`,
        name: `${key}-${optionIndex + 1}`,
        sortOrder: optionIndex + 1,
      };
    }),
  }));
}

const configuration = {
  productId: PRODUCT_ID,
  productKey: "premium_large_salad",
  groups: buildGroups(),
};

const originalCatalog = {
  contractVersion: "meal_planner_menu.v3",
  currency: "SAR",
  catalogHash: "sha256:before",
  sections: [
    {
      id: "section:premium",
      key: "premium",
      type: "configurable_product",
      products: [
        {
          id: PRODUCT_ID,
          productId: PRODUCT_ID,
          key: "premium_large_salad",
          selectionType: "premium_large_salad",
          action: { type: "open_builder", requiresBuilder: true },
          optionGroups: [],
        },
      ],
    },
  ],
};

assert.strictEqual(containsPremiumLargeSalad(originalCatalog), true);
assert.strictEqual(canonicalSaladGroupKey("vegetables_legumes"), "vegetables");
assert.strictEqual(canonicalSaladGroupKey("proteins"), "protein");
assert.strictEqual(canonicalSaladGroupKey("sauces"), "sauce");
assert.strictEqual(canonicalSaladGroupKey("extra_protein_50g"), "");

const hydratedCatalog = attachPremiumLargeSaladGroups(
  originalCatalog,
  configuration
);
const hydratedProduct = hydratedCatalog.sections[0].products[0];
assert.deepStrictEqual(
  hydratedProduct.optionGroups.map((group) => group.key),
  ["leafy_greens", "vegetables", "protein", "cheese_nuts", "fruits", "sauce"]
);
assert.strictEqual(hydratedProduct.optionGroups.length, 6);
assert.strictEqual(
  hydratedProduct.optionGroups.reduce(
    (total, group) => total + group.options.length,
    0
  ),
  55
);
assert.strictEqual(hydratedProduct.action.type, "open_builder");
assert.strictEqual(hydratedProduct.action.requiresBuilder, true);
assert.strictEqual(hydratedProduct.action.treatAsFullMeal, false);
assert.notStrictEqual(hydratedCatalog.catalogHash, originalCatalog.catalogHash);
assert.deepStrictEqual(originalCatalog.sections[0].products[0].optionGroups, []);

const membershipResult = attachPremiumLargeSaladMembership(
  {
    hasPublishedConfig: true,
    membership: {
      bySelectionType: new Map(),
      products: new Set(),
      groups: new Set(),
      options: new Set(),
    },
  },
  configuration
);
const saladMembership = membershipResult.membership.bySelectionType.get(
  "premium_large_salad"
);
assert(saladMembership.products.has(PRODUCT_ID));
assert.strictEqual(saladMembership.groups.size, 6);
assert.strictEqual(saladMembership.options.size, 55);
assert.strictEqual(membershipResult.membership.groups.size, 6);
assert.strictEqual(membershipResult.membership.options.size, 55);

const routesSource = fs.readFileSync(
  path.join(__dirname, "../src/routes/index.js"),
  "utf8"
);
assert(
  routesSource.includes(
    'require("../services/installFlutterPremiumLargeSaladOptionGroups")'
  ),
  "Flutter premium large salad group hydration must be installed before route controllers"
);

console.log(
  "Flutter premium large salad exposes six configured groups and 55 authorized options"
);

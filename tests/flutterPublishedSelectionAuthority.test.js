"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  pruneCatalogToPublishedSelections,
  pruneMembershipToPublishedSelections,
} = require("../src/services/installFlutterPublishedSelectionAuthority");

const config = {
  sections: [
    {
      key: "ready_meals",
      sectionType: "product_list",
      includeMode: "selected",
      selectionType: "full_meal_product",
      selectedProductIds: ["meal-1", "meal-2", "meal-3"],
      metadata: {
        cardType: "direct_product",
        configuredExplicitly: true,
        dashboardManaged: true,
      },
    },
    {
      key: "chicken",
      sectionType: "option_group",
      includeMode: "selected",
      selectionType: "standard_meal",
      productContextId: "basic-meal",
      sourceGroupId: "proteins",
      selectedOptionIds: ["chicken-1", "chicken-3"],
      metadata: {
        cardType: "option_family",
        dashboardManaged: true,
      },
    },
    {
      key: "premium",
      sectionType: "option_group",
      includeMode: "selected",
      selectionType: "premium_meal",
      productContextId: "basic-meal",
      sourceGroupId: "proteins",
      selectedOptionIds: ["steak", "shrimp", "salmon"],
      metadata: {
        cardType: "system_premium",
        systemManaged: true,
      },
    },
  ],
};

const catalog = {
  contractVersion: "meal_planner_menu.v3",
  catalogHash: "sha256:stale",
  sections: [
    {
      key: "ready_meals",
      products: [
        { id: "meal-1", action: { type: "direct_add" } },
        { id: "meal-2", action: { type: "direct_add" } },
        { id: "meal-3", action: { type: "direct_add" } },
        { id: "meal-4", action: { type: "direct_add" } },
        { id: "meal-5", action: { type: "direct_add" } },
      ],
    },
    {
      key: "chicken",
      products: [
        {
          id: "basic-meal",
          optionGroups: [
            {
              id: "proteins",
              options: [
                { id: "chicken-1", key: "chicken_1", proteinFamilyKey: "chicken" },
                { id: "chicken-2", key: "chicken_2", proteinFamilyKey: "chicken" },
                { id: "chicken-3", key: "chicken_3", proteinFamilyKey: "chicken" },
              ],
              optionSections: [
                {
                  key: "chicken",
                  optionIds: ["chicken-1", "chicken-2", "chicken-3"],
                  optionKeys: ["chicken_1", "chicken_2", "chicken_3"],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      key: "premium",
      products: [
        {
          id: "basic-meal",
          optionGroups: [
            {
              id: "proteins",
              options: [
                { id: "steak", key: "beef_steak", isPremium: true },
                { id: "shrimp", key: "shrimp", isPremium: true },
                { id: "salmon", key: "salmon", isPremium: true },
                { id: "old-premium", key: "old_premium", isPremium: true },
              ],
            },
          ],
        },
        {
          id: "premium-large-salad",
          selectionType: "premium_large_salad",
          action: { type: "open_builder" },
        },
      ],
    },
  ],
};

const pruned = pruneCatalogToPublishedSelections(catalog, config, "ar");
const readyMeals = pruned.sections.find((section) => section.key === "ready_meals");
assert.deepStrictEqual(
  readyMeals.products.map((product) => product.id),
  ["meal-1", "meal-2", "meal-3"]
);

const chicken = pruned.sections.find((section) => section.key === "chicken");
const chickenGroup = chicken.products[0].optionGroups[0];
assert.deepStrictEqual(
  chickenGroup.options.map((option) => option.id),
  ["chicken-1", "chicken-3"]
);
assert.deepStrictEqual(
  chickenGroup.optionSections[0].optionIds,
  ["chicken-1", "chicken-3"]
);

const premium = pruned.sections.find((section) => section.key === "premium");
assert.deepStrictEqual(
  premium.products[0].optionGroups[0].options.map((option) => option.id),
  ["steak", "shrimp", "salmon"]
);
assert.strictEqual(
  premium.products.some((product) => product.id === "premium-large-salad"),
  true,
  "automatic Premium large salad product must remain visible"
);
assert.notStrictEqual(pruned.catalogHash, "sha256:stale");
assert.strictEqual(
  pruned.selectionAuthority,
  "published_meal_builder_selected_ids"
);

const membershipResult = {
  membership: {
    products: new Set(["meal-1", "meal-2", "meal-3", "meal-4", "basic-meal"]),
    groups: new Set(["basic-meal:proteins"]),
    options: new Set([
      "basic-meal:proteins:chicken-1",
      "basic-meal:proteins:chicken-2",
      "basic-meal:proteins:chicken-3",
      "basic-meal:proteins:steak",
      "basic-meal:proteins:shrimp",
      "basic-meal:proteins:salmon",
      "basic-meal:proteins:old-premium",
    ]),
    bySelectionType: new Map([
      [
        "full_meal_product",
        {
          products: new Set(["meal-1", "meal-2", "meal-3", "meal-4"]),
          groups: new Set(),
          options: new Set(),
        },
      ],
      [
        "standard_meal",
        {
          products: new Set(["basic-meal"]),
          groups: new Set(["basic-meal:proteins"]),
          options: new Set([
            "basic-meal:proteins:chicken-1",
            "basic-meal:proteins:chicken-2",
            "basic-meal:proteins:chicken-3",
          ]),
        },
      ],
      [
        "premium_meal",
        {
          products: new Set(["basic-meal"]),
          groups: new Set(["basic-meal:proteins"]),
          options: new Set([
            "basic-meal:proteins:steak",
            "basic-meal:proteins:shrimp",
            "basic-meal:proteins:salmon",
            "basic-meal:proteins:old-premium",
          ]),
        },
      ],
    ]),
  },
};

const membership = pruneMembershipToPublishedSelections(
  membershipResult,
  config
).membership;
assert.deepStrictEqual(
  [...membership.bySelectionType.get("full_meal_product").products],
  ["meal-1", "meal-2", "meal-3"]
);
assert.deepStrictEqual(
  [...membership.bySelectionType.get("standard_meal").options],
  [
    "basic-meal:proteins:chicken-1",
    "basic-meal:proteins:chicken-3",
  ]
);
assert.deepStrictEqual(
  [...membership.bySelectionType.get("premium_meal").options],
  [
    "basic-meal:proteins:steak",
    "basic-meal:proteins:shrimp",
    "basic-meal:proteins:salmon",
  ]
);

console.log("flutterPublishedSelectionAuthority.test.js passed");

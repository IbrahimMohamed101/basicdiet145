process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  buildBuilderGroups,
} = require("../src/services/subscription/dashboardMealBuilderAuthoringCatalogService");

function readyStatus() {
  return {
    active: true,
    visible: true,
    available: true,
    published: true,
    subscriptionEnabled: true,
    catalogItemAvailable: true,
    customerReady: true,
    reasonCodes: [],
  };
}

function optionNode({ id, key, familyKey }) {
  return {
    relation: { id: `relation-${id}`, sortOrder: 10 },
    relationStatus: {
      exists: true,
      active: true,
      visible: true,
      available: true,
      effective: true,
    },
    effectiveStatus: {
      active: true,
      visible: true,
      available: true,
      customerReady: true,
    },
    option: {
      id,
      _id: id,
      key,
      name: { ar: key, en: key },
      proteinFamilyKey: familyKey,
      displayCategoryKey: familyKey,
      selectionType: "standard_meal",
      status: readyStatus(),
    },
  };
}

const catalog = {
  products: [
    {
      id: "product-basic",
      _id: "product-basic",
      key: "basic_meal",
      name: { ar: "وجبة بيسك", en: "Basic Meal" },
      status: readyStatus(),
      mealPlanner: {
        composedMeal: { compatible: true, eligible: true },
      },
      optionGroups: [
        {
          relation: { id: "product-group-proteins", sortOrder: 10 },
          relationStatus: {
            active: true,
            visible: true,
            available: true,
            effective: true,
          },
          group: {
            id: "group-proteins",
            _id: "group-proteins",
            key: "proteins",
            name: { ar: "البروتين", en: "Proteins" },
            status: readyStatus(),
          },
          groupStatus: readyStatus(),
          effectiveStatus: {
            active: true,
            visible: true,
            available: true,
            customerReady: true,
          },
          rules: { minSelections: 1, maxSelections: 1, isRequired: true },
          options: [
            optionNode({ id: "fish-1", key: "fish_fillet", familyKey: "fish" }),
            optionNode({ id: "fish-2", key: "tuna", familyKey: "fish" }),
            optionNode({ id: "chicken-1", key: "grilled_chicken", familyKey: "chicken" }),
          ],
        },
      ],
    },
  ],
};

const groups = buildBuilderGroups(catalog);
assert.strictEqual(groups.length, 1);
assert.strictEqual(groups[0].productContextId, "product-basic");
assert.strictEqual(groups[0].sourceGroupId, "group-proteins");
assert.strictEqual(groups[0].optionRole, "protein");
assert.strictEqual(groups[0].selectionType, "standard_meal");
assert.strictEqual(groups[0].eligible, true);
assert.deepStrictEqual(groups[0].families.sort(), ["chicken", "fish"]);
assert.deepStrictEqual(
  groups[0].options.map((option) => option.key),
  ["fish_fillet", "tuna", "grilled_chicken"]
);

console.log("dashboard Meal Builder authoring catalog passed");

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  hydratePremiumCardsDeep,
  isSystemPremiumSection,
  normalizePremiumItems,
} = require("../src/services/installDashboardPremiumCardHydration");

const premiumRows = [
  {
    id: "6a621992f4f8d0974cebc463",
    key: "beef_steak",
    name: {
      ar: "وجبة ستيك لحم 150 جرام",
      en: "150g Beef Steak Meal",
    },
    kind: "option",
    sourceId: "6a62198579ee075a57f7014c",
    priceHalala: 2000,
    priceSar: 20,
    currency: "SAR",
    status: "active",
    health: "ready",
    sortOrder: 100,
    revision: 1,
  },
  {
    id: "6a621992f4f8d0974cebc466",
    key: "shrimp",
    name: { ar: "وجبة جمبري 100 جرام", en: "100g Shrimp Meal" },
    kind: "option",
    sourceId: "6a62198579ee075a57f7014e",
    priceHalala: 2000,
    priceSar: 20,
    currency: "SAR",
    status: "active",
    health: "ready",
    sortOrder: 110,
    revision: 1,
  },
  {
    id: "6a621993f4f8d0974cebc469",
    key: "salmon",
    name: { ar: "وجبة سالمون 100 جرام", en: "100g Salmon Meal" },
    kind: "option",
    sourceId: "6a62198679ee075a57f70150",
    priceHalala: 2000,
    priceSar: 20,
    currency: "SAR",
    status: "active",
    health: "ready",
    sortOrder: 120,
    revision: 1,
  },
  {
    id: "6a621c1279ee075a57f701ab",
    key: "premium_large_salad",
    name: { ar: "سلطة كبيرة + بروتين", en: "Large Salad + Protein" },
    kind: "product",
    sourceId: "6a6227bc79ee075a57f7026e",
    priceHalala: 1000,
    priceSar: 10,
    currency: "SAR",
    status: "active",
    health: "ready",
    sortOrder: 130,
    revision: 3,
  },
];

const premiumItems = normalizePremiumItems(premiumRows);
assert.strictEqual(premiumItems.length, 4);
assert.deepStrictEqual(
  premiumItems.map((item) => item.premiumKey),
  ["beef_steak", "shrimp", "salmon", "premium_large_salad"]
);
assert.deepStrictEqual(
  premiumItems.map((item) => item.priceHalala),
  [2000, 2000, 2000, 1000]
);

const premiumSection = {
  key: "premium",
  sectionType: "option_group",
  sourceKind: "premium_visual",
  selectionType: "premium_meal",
  selectedOptionIds: [],
  selectedProductIds: [],
  items: [],
  titleOverride: { ar: "الوجبات المميزة", en: "Premium Meals" },
  metadata: {
    cardType: "system_premium",
    systemManaged: true,
  },
};
assert.strictEqual(isSystemPremiumSection(premiumSection), true);

const directSection = {
  key: "sandwich",
  sectionType: "product_list",
  sourceKind: "product_list",
  selectionType: "full_meal_product",
  selectedProductIds: ["507f191e810c19729de860ea"],
  items: [{ id: "507f191e810c19729de860ea", key: "sandwich_1" }],
  cardType: "direct_product",
  systemManaged: false,
  metadata: {
    cardType: "direct_product",
    systemManaged: false,
  },
};

const hydrated = hydratePremiumCardsDeep(
  {
    draft: { sections: [premiumSection, directSection] },
    published: { sections: [premiumSection, directSection] },
    premiumSection: {
      automatic: true,
      source: "premium_upgrade_configs",
      items: [],
    },
  },
  premiumItems
);

for (const config of [hydrated.draft, hydrated.published]) {
  const premium = config.sections.find((section) => section.key === "premium");
  const direct = config.sections.find((section) => section.key === "sandwich");

  assert.strictEqual(premium.cardType, "system_premium");
  assert.strictEqual(premium.systemManaged, true);
  assert.strictEqual(premium.itemEntity, "PremiumUpgradeConfig");
  assert.strictEqual(premium.completeByItself, false);
  assert.strictEqual(premium.items.length, 4);
  assert.strictEqual(premium.premiumItems.length, 4);
  assert.strictEqual(premium.itemCount, 4);
  assert.strictEqual(premium.configuredItemCount, 4);
  assert.strictEqual(premium.selectedItemCount, 4);
  assert.strictEqual(premium.metadata.source, "premium_upgrade_configs");

  assert.strictEqual(direct.cardType, "direct_product");
  assert.strictEqual(direct.systemManaged, false);
  assert.strictEqual(direct.items.length, 1);
}

assert.strictEqual(hydrated.premiumSection.items.length, 4);
assert.strictEqual(hydrated.premiumSection.itemCount, 4);
assert.strictEqual(hydrated.premiumSection.total, 4);

console.log("dashboardPremiumCardHydration.test.js passed");

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  CARD_TYPES,
  isExplicitDirectSection,
  isIntrinsicPremiumSection,
  repairStoredSection,
  resolvedCardType,
  sanitizeDashboardSection,
  sanitizeDashboardValue,
} = require("../src/services/installDashboardDirectPickerClassificationGuard");

const staleDirectCard = {
  key: "sandwich",
  sectionType: "product_list",
  sourceKind: "product_list",
  selectionType: "full_meal_product",
  selectedProductIds: ["507f191e810c19729de860ea"],
  titleOverride: { ar: "ساندوتشات", en: "Sandwiches" },
  systemManaged: true,
  cardType: "system_premium",
  itemEntity: "PremiumUpgradeConfig",
  completeByItself: false,
  metadata: {
    cardType: "direct_product",
    cardKind: "full_meal_product",
    systemManaged: true,
  },
};

assert.strictEqual(isIntrinsicPremiumSection(staleDirectCard), false);
assert.strictEqual(isExplicitDirectSection(staleDirectCard), true);
assert.strictEqual(
  resolvedCardType(staleDirectCard),
  CARD_TYPES.DIRECT_PRODUCT
);

const sanitized = sanitizeDashboardSection(staleDirectCard);
assert.strictEqual(sanitized.cardType, "direct_product");
assert.strictEqual(sanitized.systemManaged, false);
assert.strictEqual(sanitized.itemEntity, "MenuProduct");
assert.strictEqual(sanitized.completeByItself, true);
assert.strictEqual(sanitized.metadata.cardType, "direct_product");
assert.strictEqual(sanitized.metadata.systemManaged, false);
assert.strictEqual(sanitized.metadata.cardKind, "full_meal_product");

const repaired = repairStoredSection({
  ...staleDirectCard,
  selectionType: "sandwich",
});
assert.strictEqual(repaired.selectionType, "full_meal_product");
assert.strictEqual(repaired.metadata.systemManaged, false);
assert.strictEqual(repaired.metadata.dashboardManaged, true);

const nested = sanitizeDashboardValue({
  draft: { sections: [staleDirectCard] },
  published: { sections: [staleDirectCard] },
});
for (const config of [nested.draft, nested.published]) {
  assert.strictEqual(config.sections[0].cardType, "direct_product");
  assert.strictEqual(config.sections[0].systemManaged, false);
}

const premiumCard = {
  key: "premium",
  sectionType: "option_group",
  sourceKind: "premium_visual",
  selectionType: "premium_meal",
  selectedOptionIds: ["507f1f77bcf86cd799439011"],
  titleOverride: { ar: "مميز", en: "Premium" },
  metadata: { systemManaged: true },
};
assert.strictEqual(isIntrinsicPremiumSection(premiumCard), true);
assert.strictEqual(
  resolvedCardType(premiumCard),
  CARD_TYPES.SYSTEM_PREMIUM
);
assert.strictEqual(sanitizeDashboardSection(premiumCard).systemManaged, true);

const staleOptionCard = {
  key: "chicken",
  sectionType: "option_group",
  selectionType: "standard_meal",
  selectedOptionIds: ["507f1f77bcf86cd799439012"],
  productContextId: "507f191e810c19729de860eb",
  sourceGroupId: "507f191e810c19729de860ec",
  titleOverride: { ar: "دجاج", en: "Chicken" },
  metadata: { cardType: "option_family", systemManaged: true },
};
const sanitizedOption = sanitizeDashboardSection(staleOptionCard);
assert.strictEqual(sanitizedOption.cardType, "option_family");
assert.strictEqual(sanitizedOption.systemManaged, false);
assert.strictEqual(sanitizedOption.itemEntity, "MenuOption");

console.log("dashboardDirectCardSystemManagedRepair.test.js passed");

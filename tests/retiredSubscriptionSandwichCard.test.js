"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  sanitizePublicData,
} = require("../src/controllers/subscriptionMealPlannerV4Controller");
const {
  CARD_TYPES,
  isPremiumSection,
  isRetiredLegacySandwichSection,
  sanitizePayload,
  sanitizeSections,
} = require("../src/services/subscription/retiredLegacySandwichPolicy");

const routesPath = path.join(__dirname, "../src/routes/index.js");
const injectorPath = path.join(
  __dirname,
  "../src/services/installDynamicDirectMealCatalogPolicy.js"
);
const finalGuardPath = path.join(
  __dirname,
  "../src/services/installDashboardDirectPickerClassificationGuard.js"
);

const routesSource = fs.readFileSync(routesPath, "utf8");
const injectorSource = fs.readFileSync(injectorPath, "utf8");
const finalGuardSource = fs.readFileSync(finalGuardPath, "utf8");

assert(
  injectorSource.includes('const DYNAMIC_SECTION_KEY = "sandwich"'),
  "fixture must continue to identify the legacy app-only sandwich injector"
);
assert(
  injectorSource.includes("nextSections.push"),
  "fixture must prove the legacy policy can append an un-authored public section"
);
assert(
  !routesSource.includes(
    'require("../services/installDynamicDirectMealCatalogPolicy")'
  ),
  "the app-only live-catalog sandwich injector must not be installed"
);
assert(
  routesSource.includes(
    'require("../services/installDashboardMealBuilderExplicitDirectCardPolicy")'
  ),
  "dashboard-authored direct product cards must remain supported"
);
assert(
  routesSource.includes(
    'require("../services/installDashboardDirectPickerClassificationGuard")'
  ),
  "dashboard direct-product catalog classification must remain installed"
);
assert(
  finalGuardSource.includes('require("./installRetiredLegacySandwichCard")'),
  "legacy sandwich retirement must install after the final Meal Builder picker guard"
);

const retiredLegacySandwich = {
  key: "sandwich",
  sectionType: "product_list",
  selectionType: "full_meal_product",
  selectedProductIds: ["product-1"],
  cardType: "system_premium",
  systemManaged: true,
  metadata: {
    cardType: "direct_product",
    systemManaged: true,
    requiresBuilder: false,
    treatAsFullMeal: true,
  },
};
assert.strictEqual(
  isRetiredLegacySandwichSection(retiredLegacySandwich),
  true,
  "the historical fixed sandwich card must be retired"
);
assert.deepStrictEqual(
  sanitizeSections([retiredLegacySandwich]),
  [],
  "the historical fixed sandwich card must disappear from dashboard/public sections"
);

const futureDashboardSandwich = {
  key: "sandwich",
  sectionType: "product_list",
  selectionType: "full_meal_product",
  selectedProductIds: ["product-2"],
  metadata: {
    cardType: "direct_product",
    dashboardManaged: true,
    configuredExplicitly: true,
    configuredBy: "dashboard_user",
  },
};
const futureSections = sanitizeSections([futureDashboardSandwich]);
assert.strictEqual(
  futureSections.length,
  1,
  "a future dashboard-authored card may reuse the sandwich key"
);
assert.strictEqual(futureSections[0].systemManaged, false);
assert.strictEqual(futureSections[0].cardType, CARD_TYPES.DIRECT_PRODUCT);
assert.strictEqual(futureSections[0].itemEntity, "MenuProduct");
assert.strictEqual(futureSections[0].completeByItself, true);

const staleOrdinaryCard = {
  key: "ready_meals",
  sectionType: "product_list",
  selectedProductIds: ["product-3"],
  systemManaged: true,
  metadata: {
    systemManaged: true,
    cardType: "direct_product",
    dashboardManaged: true,
  },
};
const [normalizedOrdinaryCard] = sanitizeSections([staleOrdinaryCard]);
assert.strictEqual(
  normalizedOrdinaryCard.systemManaged,
  false,
  "every non-Premium card must remain editable and deletable"
);
assert.strictEqual(
  normalizedOrdinaryCard.metadata.systemManaged,
  undefined,
  "stale system-managed metadata must be removed from ordinary cards"
);
assert.strictEqual(
  normalizedOrdinaryCard.cardType,
  CARD_TYPES.DIRECT_PRODUCT
);

const premiumCard = {
  key: "premium",
  sectionType: "option_group",
  sourceKind: "premium_visual",
  selectionType: "premium_meal",
  systemManaged: true,
  metadata: { cardType: "system_premium", systemManaged: true },
};
assert.strictEqual(isPremiumSection(premiumCard), true);
assert.deepStrictEqual(
  sanitizeSections([premiumCard]),
  [premiumCard],
  "Premium must remain the only system-managed fixed card"
);

const payload = sanitizePayload({
  createdAt: new Date("2026-07-25T00:00:00.000Z"),
  plannerCatalog: { sections: [retiredLegacySandwich, futureDashboardSandwich] },
});
assert(payload.createdAt instanceof Date, "dates must survive response sanitization");
assert.strictEqual(payload.plannerCatalog.sections.length, 1);
assert.strictEqual(payload.plannerCatalog.sections[0].systemManaged, false);

const intentionallyEmptyCatalog = {
  contractVersion: "meal_planner_menu.v3",
  currency: "SAR",
  sections: [],
  rules: { source: "meal_builder_config" },
};
const emptyPublicData = sanitizePublicData({
  plannerCatalog: intentionallyEmptyCatalog,
  builderCatalogV2: {
    catalogVersion: "meal_planner_menu.v2",
    currency: "SAR",
    sections: [],
  },
  addonCatalog: {
    items: [],
    byCategory: {},
    totalCount: 0,
    entitlementResolved: false,
    source: "empty_catalog",
  },
});
assert.deepStrictEqual(
  emptyPublicData.plannerCatalog.sections,
  [],
  "removing the last ordinary card must return a valid empty catalog instead of 503"
);
assert.deepStrictEqual(emptyPublicData.builderCatalog.sections, []);
assert.deepStrictEqual(emptyPublicData.builderCatalogV2.sections, []);

console.log(
  "legacy sandwich card is retired; empty authored catalog and future cards are supported"
);

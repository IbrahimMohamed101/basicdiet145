"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  sanitizePublicData,
} = require("../src/controllers/subscriptionMealPlannerV4Controller");
const {
  removeRetiredSections,
  sanitizeValue,
} = require("../src/services/installRetiredSandwichCardRemoval");

const routesPath = path.join(__dirname, "../src/routes/index.js");
const injectorPath = path.join(
  __dirname,
  "../src/services/installDynamicDirectMealCatalogPolicy.js"
);

const routesSource = fs.readFileSync(routesPath, "utf8");
const injectorSource = fs.readFileSync(injectorPath, "utf8");

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
  routesSource.includes(
    'require("../services/installDashboardPremiumCardHydration")'
  ),
  "dashboard system Premium cards must mirror active PremiumUpgradeConfig rows"
);
assert(
  routesSource.includes(
    'require("../services/installRetiredSandwichCardRemoval")'
  ),
  "the legacy sandwich card removal must be installed after final card composition"
);

const sandwichCard = {
  key: "sandwich",
  sectionType: "product_list",
  products: [{ id: "sandwich-1" }],
};
const futureDashboardSandwichCard = {
  key: "sandwich",
  sectionType: "product_list",
  products: [{ id: "sandwich-2" }],
  metadata: {
    configuredExplicitly: true,
    configuredBy: "dashboard_user",
    cardType: "direct_product",
  },
};
const ordinaryCard = {
  key: "ready_meals",
  sectionType: "product_list",
  products: [{ id: "meal-1" }],
};
const premiumCard = {
  key: "premium",
  sectionType: "option_group",
  systemManaged: true,
};

assert.deepStrictEqual(
  removeRetiredSections([sandwichCard, ordinaryCard, premiumCard]),
  [ordinaryCard, premiumCard],
  "only the historical sandwich card must be removed"
);
assert.deepStrictEqual(
  removeRetiredSections([futureDashboardSandwichCard]),
  [futureDashboardSandwichCard],
  "a future explicitly dashboard-authored replacement card may reuse the key"
);

const sanitized = sanitizeValue({
  draft: { sections: [sandwichCard, ordinaryCard, premiumCard] },
  published: { sections: [sandwichCard, ordinaryCard, premiumCard] },
  plannerCatalog: { sections: [sandwichCard, ordinaryCard] },
  builderCatalogV2: { sections: [sandwichCard, ordinaryCard] },
  legacyBuilderCatalog: { sandwiches: [{ id: "sandwich-1" }] },
});
for (const config of [sanitized.draft, sanitized.published]) {
  assert.deepStrictEqual(
    config.sections.map((section) => section.key),
    ["ready_meals", "premium"]
  );
}
assert.deepStrictEqual(
  sanitized.plannerCatalog.sections.map((section) => section.key),
  ["ready_meals"]
);
assert.deepStrictEqual(
  sanitized.builderCatalogV2.sections.map((section) => section.key),
  ["ready_meals"]
);
assert.deepStrictEqual(sanitized.legacyBuilderCatalog.sandwiches, []);

const emptyPlannerCatalog = {
  contractVersion: "meal_planner_menu.v3",
  currency: "SAR",
  sections: [],
};
const emptyPublicData = sanitizePublicData({
  plannerCatalog: emptyPlannerCatalog,
  builderCatalogV2: {
    catalogVersion: "meal_planner_menu.v2",
    currency: "SAR",
    sections: [],
  },
});
assert.deepStrictEqual(
  emptyPublicData.plannerCatalog.sections,
  [],
  "an intentional empty authoring state must return successfully instead of 503"
);

require("./dashboardPremiumCardHydration.test");

console.log(
  "historical sandwich card is removed; Premium stays fixed and future cards stay editable"
);

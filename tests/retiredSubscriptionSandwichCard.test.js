"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  isRetiredSandwichSection,
  stripRetiredSandwichCardDeep,
  stripRetiredSections,
} = require("../src/services/installRetiredSubscriptionSandwichCard");

const automaticCard = {
  key: "sandwich",
  selectionType: "full_meal_product",
  metadata: {
    systemManaged: true,
    membershipSource: "live_catalog",
  },
};
const historicalCard = {
  key: "legacy_ready_meals",
  selectionType: "sandwich",
};
const explicitDashboardCard = {
  key: "sandwiches",
  selectionType: "full_meal_product",
  cardType: "direct_product",
  titleOverride: { ar: "ساندويتشات", en: "Sandwiches" },
  selectedProductIds: ["507f191e810c19729de860ea"],
};
const proteinCard = {
  key: "chicken",
  selectionType: "standard_meal",
};

assert.strictEqual(isRetiredSandwichSection(automaticCard), true);
assert.strictEqual(isRetiredSandwichSection(historicalCard), true);
assert.strictEqual(
  isRetiredSandwichSection(explicitDashboardCard),
  false,
  "dashboard-managed full_meal_product cards must remain supported"
);

assert.deepStrictEqual(
  stripRetiredSections([
    automaticCard,
    historicalCard,
    explicitDashboardCard,
    proteinCard,
  ]).map((section) => section.key),
  ["sandwiches", "chicken"]
);

const payload = {
  data: {
    builderCatalog: {
      sections: [automaticCard, explicitDashboardCard, proteinCard],
    },
  },
  draft: {
    sections: [historicalCard, explicitDashboardCard],
  },
  published: {
    sections: [automaticCard, proteinCard],
  },
  plannerCatalog: {
    sections: [automaticCard, explicitDashboardCard],
  },
};
const stripped = stripRetiredSandwichCardDeep(payload);

assert.deepStrictEqual(
  stripped.data.builderCatalog.sections.map((section) => section.key),
  ["sandwiches", "chicken"]
);
assert.deepStrictEqual(
  stripped.draft.sections.map((section) => section.key),
  ["sandwiches"]
);
assert.deepStrictEqual(
  stripped.published.sections.map((section) => section.key),
  ["chicken"]
);
assert.deepStrictEqual(
  stripped.plannerCatalog.sections.map((section) => section.key),
  ["sandwiches"]
);
assert.strictEqual(payload.data.builderCatalog.sections.length, 3, "normalization must not mutate source responses");

const routesSource = fs.readFileSync(
  path.join(__dirname, "../src/routes/index.js"),
  "utf8"
);
assert(
  !routesSource.includes('require("../services/installDynamicDirectMealCatalogPolicy")'),
  "the live-catalog sandwich injector must not be installed"
);
assert(
  routesSource.includes('require("../services/installRetiredSubscriptionSandwichCard")'),
  "the retired-card boundary must be installed before routes capture services"
);

const coreService = require("../src/services/subscription/mealBuilderConfigService");
const dashboardService = require("../src/services/subscription/dashboardMealPlannerDashboardService");
const CatalogService = require("../src/services/catalog/CatalogService");

for (const [label, fn] of [
  ["core planner catalog", coreService.buildPlannerCatalogFromPublishedBuilder],
  ["core published contract", coreService.buildPublishedContract],
  ["dashboard state", dashboardService.getDashboardState],
  ["public catalog", CatalogService.getSubscriptionBuilderCatalogWithV2],
]) {
  assert.strictEqual(
    Boolean(fn && fn.__retiredSubscriptionSandwichCard),
    true,
    `${label} must pass through the retired sandwich-card boundary`
  );
}

console.log("retired subscription sandwich card contract passed");

const CatalogService = require("../catalog/CatalogService");

async function getMealPlannerCatalog({ lang, includeV3 = false, includeV2 = false }) {
  // V3 responses retain the V2 catalog as an explicit compatibility mirror.
  // This keeps existing dashboard/mobile consumers safe while plannerCatalog v3
  // remains the canonical source of truth.
  return CatalogService.getSubscriptionBuilderCatalogWithV2({
    lang,
    includeV3,
    includeV2: includeV2 || includeV3,
  });
}

async function invalidateMealPlannerCatalogCache() {
  return true;
}

module.exports = {
  getMealPlannerCatalog,
  invalidateMealPlannerCatalogCache,
};

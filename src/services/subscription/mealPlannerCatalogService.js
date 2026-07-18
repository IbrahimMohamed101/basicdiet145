const CatalogService = require("../catalog/CatalogService");

async function getMealPlannerCatalog({
  lang,
  includeV3 = false,
  includeV2 = false,
}) {
  return CatalogService.getSubscriptionBuilderCatalogWithV2({
    lang,
    includeV3,
    includeV2,
  });
}

async function invalidateMealPlannerCatalogCache() {
  return true;
}

module.exports = {
  getMealPlannerCatalog,
  invalidateMealPlannerCatalogCache,
};

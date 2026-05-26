const CatalogService = require("../catalog/CatalogService");

async function getMealPlannerCatalog({ lang }) {
  return CatalogService.getSubscriptionBuilderCatalogWithV2({ lang });
}

async function invalidateMealPlannerCatalogCache() {
  return true;
}

module.exports = {
  getMealPlannerCatalog,
  invalidateMealPlannerCatalogCache,
};

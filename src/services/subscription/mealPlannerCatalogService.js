const CatalogService = require("../catalog/CatalogService");

async function getMealPlannerCatalog({ lang }) {
  return CatalogService.getSubscriptionBuilderCatalog({ lang });
}

async function invalidateMealPlannerCatalogCache() {
  return true;
}

module.exports = {
  getMealPlannerCatalog,
  invalidateMealPlannerCatalogCache,
};

const PLANNER_CATALOG_V3_VERSION = "meal_planner_menu.v3";
const PRIMARY_DIRECT_SELECTION_TYPES = new Set(["sandwich", "full_meal_product"]);

function hasSelectableOptionGroup(product) {
  return Array.isArray(product.optionGroups)
    && product.optionGroups.some((group) => Array.isArray(group?.options) && group.options.length > 0);
}

function isSelectablePlannerProduct(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return false;
  return product.action?.type === "direct_add"
    || product.action?.treatAsFullMeal === true
    || hasSelectableOptionGroup(product);
}

function hasSelectablePlannerContent(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return false;
  if (catalog.contractVersion !== PLANNER_CATALOG_V3_VERSION) return false;
  if (!Array.isArray(catalog.sections) || catalog.sections.length === 0) return false;

  return catalog.sections.some((section) => (
    Array.isArray(section?.products) && section.products.some(isSelectablePlannerProduct)
  ));
}

function plannerProducts(catalog) {
  return (catalog?.sections || []).flatMap((section) => section?.products || []);
}

function proteinOptionCount(product) {
  return (product.optionGroups || [])
    .filter((group) => group?.key === "protein" || group?.key === "proteins")
    .reduce((total, group) => total + (Array.isArray(group.options) ? group.options.length : 0), 0);
}

function isDirectPrimaryMeal(product) {
  return PRIMARY_DIRECT_SELECTION_TYPES.has(product?.selectionType)
    && (product.action?.type === "direct_add" || product.action?.treatAsFullMeal === true);
}

function summarizeFlutterPrimaryMealPickerContent(catalog) {
  const catalogProducts = plannerProducts(catalog);
  const standardProducts = catalogProducts.filter((product) => product?.selectionType === "standard_meal");

  return {
    standardProductCount: standardProducts.length,
    standardProteinOptionCount: standardProducts.reduce((total, product) => total + proteinOptionCount(product), 0),
    directMealCount: catalogProducts.filter(isDirectPrimaryMeal).length,
    premiumLargeSaladCount: catalogProducts.filter((product) => product?.selectionType === "premium_large_salad").length,
  };
}

function hasFlutterPrimaryMealPickerContent(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return false;
  if (catalog.contractVersion !== PLANNER_CATALOG_V3_VERSION) return false;
  const summary = summarizeFlutterPrimaryMealPickerContent(catalog);
  return summary.standardProteinOptionCount > 0 || summary.directMealCount > 0;
}

module.exports = {
  PLANNER_CATALOG_V3_VERSION,
  hasFlutterPrimaryMealPickerContent,
  hasSelectablePlannerContent,
  summarizeFlutterPrimaryMealPickerContent,
};

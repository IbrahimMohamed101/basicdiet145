const CatalogItem = require("../../models/CatalogItem");
const MenuOption = require("../../models/MenuOption");
const MenuProduct = require("../../models/MenuProduct");

const LIVE_QUERY = Object.freeze({
  isActive: true,
  isVisible: { $ne: false },
  isAvailable: { $ne: false },
  publishedAt: { $ne: null },
});

function verifiedApproval(source) {
  return source?.nutritionDataStatus === "verified"
    && Boolean(String(source.nutritionSource || "").trim())
    && Boolean(source.nutritionVerifiedAt)
    && Boolean(source.nutritionVerifiedBy);
}

function inspectNutrition(row, catalogItem, { entityType = "option" } = {}) {
  const issues = [];
  const linked = Boolean(row.catalogItemId);
  const source = linked ? catalogItem : row;
  if (linked && !catalogItem) issues.push("BROKEN_CATALOG_LINK");
  if (entityType === "product" && !linked) issues.push("PRODUCT_WITHOUT_CANONICAL_NUTRITION");
  const nutrition = source?.nutrition;
  const hasNutrition = nutrition && typeof nutrition === "object";
  const keys = ["calories", "proteinGrams", "fatGrams"];
  const carbsValue = nutrition?.carbGrams ?? nutrition?.carbsGrams;
  const allValues = [nutrition?.calories, nutrition?.proteinGrams, carbsValue, nutrition?.fatGrams];
  const valid = hasNutrition && allValues.every((value) =>
    value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0
  );
  const zeroOnly = valid && allValues.every((value) => Number(value) === 0);
  if (!valid || (zeroOnly && !verifiedApproval(source))) issues.push("NUTRITION_MISSING_OR_DEFAULT_ZERO");
  if (!verifiedApproval(source)) issues.push("NUTRITION_NOT_APPROVED");
  if (catalogItem && catalogItem.nutritionBasis) {
    if (entityType === "product"
      && row.pricingModel === "per_100g"
      && catalogItem.nutritionBasis !== "per_100g") {
      issues.push("NUTRITION_BASIS_MISMATCH");
    }
  }
  let statedCalories = null;
  let macroCalories = null;
  if (valid) {
    statedCalories = Number(nutrition.calories);
    macroCalories = 4 * Number(nutrition.proteinGrams)
      + 4 * Number(carbsValue)
      + 9 * Number(nutrition.fatGrams);
    // Triage only: macro Atwater arithmetic is not nutritional verification.
    if (Math.abs(statedCalories - macroCalories) > 40
      && Math.abs(statedCalories - macroCalories) / Math.max(statedCalories, 1) > 0.15) {
      issues.push("KCAL_MACRO_DISCREPANCY_REVIEW");
    }
  }
  return {
    entityType,
    id: String(row._id),
    key: String(row.key || ""),
    catalogItemId: linked ? String(row.catalogItemId) : null,
    nutritionDataStatus: verifiedApproval(source) ? "verified" : "unknown",
    nutritionBasis: source?.nutritionBasis || null,
    statedCalories,
    macroCalories,
    issues,
  };
}

function buildReport({ products = [], options = [], catalogItems = [] } = {}) {
  const byCatalogId = new Map(catalogItems.map((item) => [String(item._id), item]));
  const items = [
    ...products.map((p) => inspectNutrition(p, byCatalogId.get(String(p.catalogItemId || "")), { entityType: "product" })),
    ...options.map((o) => inspectNutrition(o, byCatalogId.get(String(o.catalogItemId || "")), { entityType: "option" })),
  ];
  const issueCounts = {};
  for (const item of items) {
    for (const issue of item.issues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  }
  return {
    status: Object.keys(issueCounts).length ? "action_required" : "ready_for_platform_reconciliation",
    generatedAt: new Date().toISOString(),
    source: "mongo_live_published_catalog",
    disclaimer: "Read-only data quality scan. Platform values, portion weights, recipes and allergens require separate verification.",
    totals: {
      publishedProducts: products.length,
      publishedOptions: options.length,
      ready: items.filter((item) => item.issues.length === 0).length,
      needingReview: items.filter((item) => item.issues.length !== 0).length,
    },
    issueCounts,
    items,
  };
}

async function getNutritionAudit({ includeDrafts = false } = {}) {
  const query = includeDrafts
    ? { isActive: true, isVisible: { $ne: false }, isAvailable: { $ne: false } }
    : LIVE_QUERY;
  const [products, options] = await Promise.all([
    MenuProduct.find(query).select("_id key catalogItemId pricingModel").lean(),
    MenuOption.find(query).select("_id key catalogItemId nutrition nutritionDataStatus nutritionSource nutritionVerifiedAt nutritionVerifiedBy").lean(),
  ]);
  const catalogIds = [...new Set([...products, ...options].filter((r) => r.catalogItemId).map((r) => String(r.catalogItemId)))];
  const catalogItems = catalogIds.length
    ? await CatalogItem.find({ _id: { $in: catalogIds } }).select("_id nutrition nutritionDataStatus nutritionSource nutritionBasis nutritionVerifiedAt nutritionVerifiedBy").lean()
    : [];
  return buildReport({ products, options, catalogItems });
}

module.exports = { inspectNutrition, buildReport, getNutritionAudit };

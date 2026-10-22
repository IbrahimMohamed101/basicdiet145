process.env.NODE_ENV = "test";
const assert = require("assert");
const mongoose = require("mongoose");
const CatalogItem = require("../src/models/CatalogItem");
const MenuOption = require("../src/models/MenuOption");
const catalogService = require("../src/services/catalog/catalogItemService");
const { buildReport, inspectNutrition } = require("../src/services/catalog/menuNutritionAuditService");
const { serializePublicOption, serializePublicProduct } = require("../src/services/orders/menuCatalogPresenter");
const { buildPublicMenuV2 } = require("../src/services/orders/orderMenuService");

const id = () => new mongoose.Types.ObjectId();
const sourceId = id();
const optionId = id();
const productId = id();
const categoryId = id();
const reviewerId = id();

const freshCatalog = new CatalogItem({
  key: "test_sauce",
  itemKind: "addon",
  nameI18n: { en: "Test Sauce" },
});
assert.strictEqual(freshCatalog.nutritionDataStatus, "unknown");
assert.strictEqual(freshCatalog.nutritionSource, "");
assert.strictEqual(freshCatalog.nutritionVerifiedAt, null);

const freshOption = new MenuOption({
  groupId: id(), key: "test_sauce", name: { en: "Sauce" },
});
assert.strictEqual(freshOption.nutritionDataStatus, "unknown");

const zeroCatalog = {
  _id: sourceId,
  nutrition: { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
  nutritionDataStatus: "verified", // Legacy stale verified value is not proof.
};
const unverifiedOption = {
  _id: optionId, groupId: id(), key: "ranch", name: { en: "Ranch" },
  catalogItemId: sourceId,
  nutrition: { calories: 999, proteinGrams: 11, carbGrams: 10, fatGrams: 1 },
};
const legacyFinding = inspectNutrition(unverifiedOption, zeroCatalog);
assert(legacyFinding.issues.includes("NUTRITION_NOT_APPROVED"));
assert(legacyFinding.issues.includes("NUTRITION_MISSING_OR_DEFAULT_ZERO"));
const legacyPayload = serializePublicOption({}, unverifiedOption, "en", { catalogItem: zeroCatalog });
assert.strictEqual(legacyPayload.calories, 0, "canonical linked catalog item must win");
assert.strictEqual(legacyPayload.nutritionVerified, false);
assert.strictEqual(legacyPayload.nutritionDataStatus, "unknown");

const verifiedCatalog = {
  _id: sourceId,
  nutrition: { calories: 360, proteinGrams: 30, carbsGrams: 30, fatGrams: 13 },
  nutritionDataStatus: "verified",
  nutritionSource: "Kitchen recipe rev 2026-10-22, dietitian signed",
  nutritionBasis: "per_serving",
  nutritionServingSizeGrams: 250,
  nutritionVerifiedAt: new Date("2026-10-22T12:00:00Z"),
  nutritionVerifiedBy: reviewerId,
};
const product = {
  _id: productId, categoryId, key: "approved_product", name: { en: "Approved" },
  catalogItemId: sourceId, pricingModel: "fixed", priceHalala: 1000,
};
const report = buildReport({ products: [product], options: [unverifiedOption], catalogItems: [verifiedCatalog] });
assert.strictEqual(report.totals.needingReview, 0);
assert.strictEqual(report.totals.ready, 2);
const publicProduct = serializePublicProduct(product, "en", [], categoryId, { catalogItem: verifiedCatalog });
assert.strictEqual(publicProduct.calories, 360);
assert.strictEqual(publicProduct.nutritionVerified, true);
assert.strictEqual(publicProduct.nutritionServingSizeGrams, 250);
const publicOption = serializePublicOption({}, unverifiedOption, "en", { catalogItem: verifiedCatalog });
assert.strictEqual(publicOption.nutritionVerified, true);
assert.strictEqual(publicOption.calories, 360);
const projected = buildPublicMenuV2({
  categories: [{ id: String(categoryId), key: "meals", name: "Meals", products: [publicProduct] }],
});
assert.strictEqual(projected.sections[0].products[0].calories, 360);
assert.strictEqual(projected.sections[0].products[0].nutritionVerified, true);
assert.strictEqual(projected.sections[0].products[0].nutritionBasis, "per_serving");

const mismatched = inspectNutrition({ ...product, pricingModel: "per_100g" }, verifiedCatalog, { entityType: "product" });
assert(mismatched.issues.includes("NUTRITION_BASIS_MISMATCH"));

const outlier = inspectNutrition(product, {
  ...verifiedCatalog, nutrition: { calories: 400, proteinGrams: 10, carbsGrams: 10, fatGrams: 10 }
}, { entityType: "product" });
assert(outlier.issues.includes("KCAL_MACRO_DISCREPANCY_REVIEW"));
const legitimateZero = inspectNutrition(unverifiedOption, {
  ...verifiedCatalog, nutrition: { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 }
});
assert(!legitimateZero.issues.includes("NUTRITION_MISSING_OR_DEFAULT_ZERO"));

async function checkValidationBeforeDb() {
  await assert.rejects(
    () => catalogService.approveCatalogItemNutrition(String(sourceId), {}, { role: "restaurant", userId: String(reviewerId) }),
    (e) => e.code === "NUTRITION_APPROVAL_FORBIDDEN"
  );
  await assert.rejects(
    () => catalogService.approveCatalogItemNutrition(String(sourceId), { nutrition: { calories: 10 } }, { role: "admin", userId: String(reviewerId) }),
    (e) => e.code === "NUTRITION_FIELDS_REQUIRED"
  );
  await assert.rejects(
    () => catalogService.approveCatalogItemNutrition(String(sourceId), {
      nutrition: { calories: 10, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
      nutritionSource: "Kitchen",
      nutritionBasis: "per_100g",
      nutritionServingSizeGrams: 250,
    }, { role: "admin", userId: String(reviewerId) }),
    (e) => e.code === "NUTRITION_SERVING_MISMATCH"
  );
}
checkValidationBeforeDb().then(() => {
  console.log("nutritionIntegrityContract: passed");
}).catch((error) => { console.error(error); process.exitCode = 1; });

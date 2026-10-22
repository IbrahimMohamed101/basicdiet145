process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "nutrition-isolated-jwt";
process.env.DASHBOARD_JWT_SECRET ||= "nutrition-isolated-dashboard";
const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const CatalogItem = require("../src/models/CatalogItem");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const MenuAuditLog = require("../src/models/MenuAuditLog");
const catalogService = require("../src/services/catalog/catalogItemService");
const menuService = require("../src/services/orders/menuCatalogService");

const reviewedNutrition = {
  calories: 360,
  proteinGrams: 30,
  carbsGrams: 30,
  fatGrams: 13,
};
const optionNutrition = {
  calories: 25,
  proteinGrams: 1,
  carbGrams: 2,
  fatGrams: 1,
};
const reviewer = { role: "admin", userId: String(new mongoose.Types.ObjectId()) };

async function main() {
  const db = await MongoMemoryServer.create();
  try {
    process.env.MONGO_URI = db.getUri("nutrition_approval_isolated_test");
    await mongoose.connect(process.env.MONGO_URI);
    const item = await CatalogItem.create({
      key: "approved_dish", nameI18n: { en: "Approved Dish" },
      itemKind: "product",
    });
    assert.strictEqual(item.nutritionDataStatus, "unknown");
    const approved = await catalogService.approveCatalogItemNutrition(String(item._id), {
      nutrition: reviewedNutrition,
      nutritionSource: "Kitchen recipe v1, 250g complete portion",
      nutritionBasis: "per_serving",
      nutritionServingSizeGrams: 250,
    }, reviewer);
    assert.strictEqual(approved.nutritionDataStatus, "verified");
    assert.strictEqual(approved.nutrition.calories, 360);
    assert.strictEqual(String(approved.nutritionVerifiedBy), reviewer.userId);
    assert(await MenuAuditLog.exists({ entityType: "catalog_item", entityId: item._id, action: "nutrition_verified" }));
    await catalogService.updateCatalogItem(String(item._id), {
      descriptionI18n: { en: "New description" },
    });
    assert.strictEqual((await CatalogItem.findById(item._id)).nutritionDataStatus, "verified");

    // A published product cannot receive an unreviewed ordinary nutritional edit.
    await MenuProduct.create({
      categoryId: new mongoose.Types.ObjectId(),
      catalogItemId: item._id,
      key: "approved_dish",
      name: { en: "Approved Dish" },
      pricingModel: "fixed",
      priceHalala: 1000,
      publishedAt: new Date(),
    });
    await assert.rejects(
      () => catalogService.updateCatalogItem(String(item._id), { nutrition: { calories: 1 } }),
      (e) => e.code === "PUBLISHED_NUTRITION_REQUIRES_APPROVAL"
    );

    const group = await MenuOptionGroup.create({ key: "sauces", name: { en: "Sauces" } });
    const sauce = await MenuOption.create({
      key: "garlic_honey",
      groupId: group._id,
      name: { en: "Garlic Honey" },
      publishedAt: new Date(),
    });
    assert.strictEqual(sauce.nutritionDataStatus, "unknown");
    await assert.rejects(
      () => menuService.updateOption(String(sauce._id), { nutrition: optionNutrition }, reviewer),
      (e) => e.code === "PUBLISHED_NUTRITION_REQUIRES_APPROVAL"
    );
    const sauceApproved = await menuService.approveOptionNutrition(String(sauce._id), {
      nutrition: optionNutrition,
      nutritionSource: "Kitchen weighed sauce recipe 20g",
      nutritionBasis: "per_serving",
      nutritionServingSizeGrams: 20,
    }, reviewer);
    assert.strictEqual(sauceApproved.nutritionDataStatus, "verified");
    assert.strictEqual(sauceApproved.nutrition.calories, 25);
    assert(await MenuAuditLog.exists({ entityType: "menu_option", entityId: sauce._id, action: "nutrition_verified" }));
    console.log("nutritionApprovalIsolatedDb: passed");
  } finally {
    await mongoose.disconnect();
    await db.stop();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

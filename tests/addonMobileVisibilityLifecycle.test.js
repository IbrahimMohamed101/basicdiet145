process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Addon = require("../src/models/Addon");
const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuProduct = require("../src/models/MenuProduct");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const {
  buildAddonChoicesCatalog,
} = require("../src/services/subscription/subscriptionAddonChoicesService");

async function main() {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(`addon_mobile_visibility_test_${Date.now()}`));

  try {
    const mealsCategory = await MenuCategory.create({
      key: "meals",
      name: { ar: "الوجبات", en: "Meals" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    const archivedCategory = await MenuCategory.create({
      key: "archived_meals",
      name: { ar: "وجبات مؤرشفة", en: "Archived Meals" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });

    const canonicalActive = await CatalogItem.create({
      key: "visibility_canonical_active",
      nameI18n: { ar: "نشط", en: "Active" },
      itemKind: "product",
      isActive: true,
      isAvailable: true,
    });
    const canonicalArchived = await CatalogItem.create({
      key: "visibility_canonical_archived",
      nameI18n: { ar: "مؤرشف", en: "Archived" },
      itemKind: "product",
      isActive: true,
      isAvailable: true,
    });

    const [activeProduct, inactiveProduct, archivedProduct, deletedProduct, archivedCategoryProduct, archivedCanonicalProduct] = await MenuProduct.create([
      {
        categoryId: mealsCategory._id,
        catalogItemId: canonicalActive._id,
        key: "visibility_active_meal",
        name: { ar: "وجبة نشطة", en: "Active Meal" },
        priceHalala: 2500,
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
      {
        categoryId: mealsCategory._id,
        key: "visibility_inactive_meal",
        name: { ar: "وجبة غير نشطة", en: "Inactive Meal" },
        priceHalala: 2600,
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: false,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
      {
        categoryId: mealsCategory._id,
        key: "visibility_archived_meal",
        name: { ar: "وجبة مؤرشفة", en: "Archived Meal" },
        priceHalala: 2700,
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isArchived: true,
        archivedAt: new Date(),
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
      {
        categoryId: mealsCategory._id,
        key: "visibility_deleted_meal",
        name: { ar: "وجبة محذوفة", en: "Deleted Meal" },
        priceHalala: 2800,
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isDeleted: true,
        deletedAt: new Date(),
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
      {
        categoryId: archivedCategory._id,
        key: "visibility_archived_category_meal",
        name: { ar: "وجبة تصنيف مؤرشف", en: "Archived Category Meal" },
        priceHalala: 2900,
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
      {
        categoryId: mealsCategory._id,
        catalogItemId: canonicalArchived._id,
        key: "visibility_archived_canonical_meal",
        name: { ar: "وجبة مرجع مؤرشف", en: "Archived Canonical Meal" },
        priceHalala: 3000,
        itemType: "meal",
        availableFor: ["one_time"],
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: new Date(),
      },
    ]);

    await MenuCategory.updateOne(
      { _id: archivedCategory._id },
      { $set: { isArchived: true, archivedAt: new Date() } }
    );
    await CatalogItem.updateOne(
      { _id: canonicalArchived._id },
      { $set: { isArchived: true, archivedAt: new Date() } }
    );

    const client = await User.create({
      phone: `+155599${Date.now()}`,
      name: "Visibility Client",
      role: "client",
      isActive: true,
    });
    const basePlan = await Plan.create({
      name: { ar: "خطة اختبار", en: "Visibility Plan" },
      daysCount: 7,
      durationDays: 7,
      active: true,
      available: true,
      isAvailable: true,
      isActive: true,
      currency: "SAR",
      gramsOptions: [{
        grams: 150,
        isActive: true,
        mealsOptions: [{ mealsPerDay: 2, priceHalala: 70000, isActive: true }],
      }],
    });
    const addonPlanId = new mongoose.Types.ObjectId();
    const productIds = [
      activeProduct,
      inactiveProduct,
      archivedProduct,
      deletedProduct,
      archivedCategoryProduct,
      archivedCanonicalProduct,
    ].map((row) => row._id);
    const subscription = await Subscription.create({
      userId: client._id,
      clientId: new mongoose.Types.ObjectId(),
      planId: basePlan._id,
      status: "active",
      totalMeals: 7,
      remainingMeals: 7,
      duration: 7,
      deliveryMode: "pickup",
      addonSubscriptions: [{
        addonPlanId,
        addonPlanName: "Meal Add-on",
        category: "meal",
        maxPerDay: 2,
        includedTotalQty: 5,
        menuProductIds: productIds,
      }],
      addonBalance: [{
        addonPlanId,
        category: "meal",
        includedTotalQty: 5,
        remainingQty: 5,
      }],
    });

    const choices = await buildAddonChoicesCatalog({
      lang: "en",
      subscriptionId: String(subscription._id),
      userId: String(client._id),
    });
    assert.deepStrictEqual(
      choices.meal.choices.map((choice) => choice.id),
      [String(activeProduct._id)],
      "mobile add-on choices must exclude inactive, archived, deleted, archived-category, and archived-canonical products"
    );

    const productToArchive = await MenuProduct.create({
      categoryId: mealsCategory._id,
      key: "visibility_archive_update_meal",
      name: { ar: "وجبة ستؤرشف", en: "Meal To Archive" },
      priceHalala: 3100,
      itemType: "meal",
      availableFor: ["one_time"],
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: new Date(),
    });
    await MenuProduct.updateOne(
      { _id: productToArchive._id },
      { $set: { isArchived: true, archivedAt: new Date() } }
    );
    const rawArchivedProduct = await MenuProduct.collection.findOne({ _id: productToArchive._id });
    assert.strictEqual(rawArchivedProduct.isArchived, true);
    assert.strictEqual(rawArchivedProduct.isActive, false);
    assert.strictEqual(rawArchivedProduct.isVisible, false);
    assert.strictEqual(rawArchivedProduct.isAvailable, false);

    const activeAddonPlan = await Addon.create({
      name: { ar: "إضافة نشطة", en: "Active Add-on" },
      priceHalala: 0,
      kind: "plan",
      category: "snack",
      billingMode: "per_day",
      menuProductIds: [activeProduct._id],
      isActive: true,
    });
    const archivedAddonPlan = await Addon.create({
      name: { ar: "إضافة مؤرشفة", en: "Archived Add-on" },
      priceHalala: 0,
      kind: "plan",
      category: "snack",
      billingMode: "per_day",
      menuProductIds: [activeProduct._id],
      isActive: true,
      isArchived: true,
      archivedAt: new Date(),
    });
    const activePlans = await Addon.find({ kind: "plan", isActive: true }).lean();
    assert(activePlans.some((row) => String(row._id) === String(activeAddonPlan._id)));
    assert(!activePlans.some((row) => String(row._id) === String(archivedAddonPlan._id)),
      "active mobile plan queries must not return archived add-on plans");

    console.log("Add-on mobile visibility lifecycle test passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

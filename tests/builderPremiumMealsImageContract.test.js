"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const CatalogItem = require("../src/models/CatalogItem");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");

async function createProduct({ categoryId, key, catalogItemId = null, imageUrl = "", itemType = "product" }) {
  return MenuProduct.create({
    categoryId,
    catalogItemId,
    key,
    name: { ar: key, en: key },
    description: { ar: "", en: "" },
    imageUrl,
    itemType,
    pricingModel: "fixed",
    priceHalala: 0,
    currency: "SAR",
    availableFor: ["one_time", "subscription"],
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: new Date(),
  });
}

async function run() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "builder_premium_images" },
  });
  const uri = replSet.getUri("builder_premium_images");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    const now = new Date();
    const category = await MenuCategory.create({
      key: "premium_image_contract",
      name: { ar: "اختبار الصور", en: "Image Contract" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    const group = await MenuOptionGroup.create({
      key: "premium_image_contract_proteins",
      name: { ar: "البروتين", en: "Protein" },
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    const basicMeal = await createProduct({
      categoryId: category._id,
      key: "premium_image_contract_basic_meal",
      itemType: "basic_meal",
    });

    const steakProduct = await createProduct({
      categoryId: category._id,
      key: "premium_image_contract_steak_product",
      imageUrl: "https://cdn.example.test/premium/steak.jpg",
    });
    const steakCatalog = await CatalogItem.create({
      key: "premium_image_contract_steak_option",
      nameI18n: { ar: "ستيك", en: "Steak" },
      imageUrl: "",
      itemKind: "protein",
    });
    const steakOption = await MenuOption.create({
      groupId: group._id,
      catalogItemId: steakCatalog._id,
      key: "premium_image_contract_steak",
      name: { ar: "ستيك", en: "Steak" },
      imageUrl: "",
      availableFor: ["subscription"],
      availableForSubscription: true,
      premiumKey: "premium_image_contract_steak",
      selectionType: "premium_meal",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    await PremiumUpgradeConfig.create({
      sourceType: "menu_option",
      sourceId: steakOption._id,
      sourceProductId: basicMeal._id,
      sourceGroupId: group._id,
      selectionType: "premium_meal",
      premiumKey: "premium_image_contract_steak",
      upgradeDeltaHalala: 2000,
      currency: "SAR",
      isEnabled: true,
      isVisible: true,
      status: "active",
      sortOrder: 10,
      metadata: { workbookSourceProductKey: steakProduct.key },
      sourceSnapshot: {
        key: steakOption.key,
        name: steakOption.name,
        context: { productKey: basicMeal.key, groupKey: group.key },
      },
    });

    const shrimpCatalog = await CatalogItem.create({
      key: "premium_image_contract_shrimp_option",
      nameI18n: { ar: "جمبري", en: "Shrimp" },
      imageUrl: "https://cdn.example.test/premium/shrimp-catalog.jpg",
      itemKind: "protein",
    });
    const shrimpProduct = await createProduct({
      categoryId: category._id,
      key: "premium_image_contract_shrimp_product",
      imageUrl: "https://cdn.example.test/premium/shrimp-product.jpg",
    });
    const shrimpOption = await MenuOption.create({
      groupId: group._id,
      catalogItemId: shrimpCatalog._id,
      key: "premium_image_contract_shrimp",
      name: { ar: "جمبري", en: "Shrimp" },
      imageUrl: "",
      availableFor: ["subscription"],
      availableForSubscription: true,
      premiumKey: "premium_image_contract_shrimp",
      selectionType: "premium_meal",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      publishedAt: now,
    });
    await PremiumUpgradeConfig.create({
      sourceType: "menu_option",
      sourceId: shrimpOption._id,
      sourceProductId: basicMeal._id,
      sourceGroupId: group._id,
      selectionType: "premium_meal",
      premiumKey: "premium_image_contract_shrimp",
      upgradeDeltaHalala: 2000,
      currency: "SAR",
      isEnabled: true,
      isVisible: true,
      status: "active",
      sortOrder: 20,
      metadata: { workbookSourceProductKey: shrimpProduct.key },
      sourceSnapshot: {
        key: shrimpOption.key,
        name: shrimpOption.name,
        context: { productKey: basicMeal.key, groupKey: group.key },
      },
    });

    const saladCatalog = await CatalogItem.create({
      key: "premium_image_contract_salad",
      nameI18n: { ar: "سلطة كبيرة", en: "Large Salad" },
      imageUrl: "https://cdn.example.test/premium/large-salad.jpg",
      itemKind: "product",
    });
    const saladProduct = await createProduct({
      categoryId: category._id,
      catalogItemId: saladCatalog._id,
      key: "premium_image_contract_large_salad",
      imageUrl: "",
      itemType: "premium_large_salad",
    });
    await PremiumUpgradeConfig.create({
      sourceType: "menu_product",
      sourceId: saladProduct._id,
      sourceProductId: saladProduct._id,
      sourceGroupId: null,
      selectionType: "premium_large_salad",
      premiumKey: "premium_image_contract_large_salad",
      upgradeDeltaHalala: 2900,
      currency: "SAR",
      isEnabled: true,
      isVisible: true,
      status: "active",
      sortOrder: 30,
      sourceSnapshot: {
        key: saladProduct.key,
        name: saladProduct.name,
        context: { productKey: saladProduct.key },
      },
    });

    const response = await request(createApp())
      .get("/api/builder/premium-meals?lang=en")
      .expect(200);

    assert.strictEqual(response.body.status, true);
    const byKey = new Map(response.body.data.map((row) => [row.premiumKey, row]));
    assert.strictEqual(
      byKey.get("premium_image_contract_steak").imageUrl,
      "https://cdn.example.test/premium/steak.jpg",
      "option-backed Premium meal falls back to the original workbook MenuProduct image"
    );
    assert.strictEqual(
      byKey.get("premium_image_contract_shrimp").imageUrl,
      "https://cdn.example.test/premium/shrimp-catalog.jpg",
      "source CatalogItem image takes priority over the fallback product image"
    );
    assert.strictEqual(
      byKey.get("premium_image_contract_large_salad").imageUrl,
      "https://cdn.example.test/premium/large-salad.jpg",
      "product-backed Premium meal falls back to its CatalogItem image"
    );

    console.log("builderPremiumMealsImageContract.test.js passed");
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
    await replSet.stop();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

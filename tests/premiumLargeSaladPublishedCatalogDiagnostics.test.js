"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "premium-large-salad-diagnostics-secret";
process.env.DASHBOARD_JWT_SECRET =
  process.env.DASHBOARD_JWT_SECRET || "premium-large-salad-dashboard-secret";

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { createApp } = require("../src/app");
const MenuCategory = require("../src/models/MenuCategory");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const PremiumUpgradeConfig = require("../src/models/PremiumUpgradeConfig");
const mealBuilderConfigService = require(
  "../src/services/subscription/mealBuilderConfigService"
);

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: "premium_salad_diagnostics" },
  });
  const uri = mongoServer.getUri("premium_salad_diagnostics");
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function seedFixture() {
  const now = new Date();
  const category = await MenuCategory.create({
    key: "custom_order",
    name: { en: "Custom Order", ar: "طلب مخصص" },
    publishedAt: now,
  });
  const proteinsGroup = await MenuOptionGroup.create({
    key: "proteins",
    name: { en: "Protein", ar: "بروتين" },
    publishedAt: now,
  });
  const salad = await MenuProduct.create({
    categoryId: category._id,
    key: "premium_large_salad",
    itemType: "premium_large_salad",
    name: { en: "Premium Large Salad", ar: "سلطة كبيرة مميزة" },
    pricingModel: "fixed",
    priceHalala: 2900,
    availableFor: ["subscription"],
    publishedAt: now,
  });
  await PremiumUpgradeConfig.create({
    sourceType: "menu_product",
    sourceId: salad._id,
    sourceProductId: salad._id,
    sourceGroupId: null,
    selectionType: "premium_large_salad",
    premiumKey: "premium_large_salad",
    displayGroupKey: "premium",
    upgradeDeltaHalala: 2900,
    currency: "SAR",
    isEnabled: true,
    isVisible: true,
    status: "active",
    sortOrder: 99,
    sourceSnapshot: {
      key: salad.key,
      name: salad.name,
      context: { productKey: salad.key },
    },
  });
  const grilledChicken = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "grilled_chicken",
    name: { en: "Grilled Chicken", ar: "دجاج مشوي" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  const beef = await MenuOption.create({
    groupId: proteinsGroup._id,
    key: "beef",
    name: { en: "Beef", ar: "لحم" },
    availableFor: ["subscription"],
    availableForSubscription: true,
    publishedAt: now,
  });
  await ProductOptionGroup.create({
    productId: salad._id,
    groupId: proteinsGroup._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
  });
  for (const option of [grilledChicken, beef]) {
    await ProductGroupOption.create({
      productId: salad._id,
      groupId: proteinsGroup._id,
      optionId: option._id,
    });
  }
  return { salad };
}

function summarize(catalog) {
  return {
    hasCatalog: Boolean(catalog),
    sectionCount: Array.isArray(catalog?.sections) ? catalog.sections.length : -1,
    sections: (catalog?.sections || []).map((section) => ({
      key: section.key || null,
      selectionType: section.selectionType || null,
      sourceKind: section.source?.kind || section.sourceKind || null,
      products: (section.products || []).map((product) => ({
        id: String(product.id || product.productId || product._id || ""),
        key: product.key || null,
        selectionType: product.selectionType || null,
        optionGroups: (product.optionGroups || []).map((group) => ({
          id: String(group.id || group.groupId || ""),
          key: group.key || null,
          optionKeys: (group.options || []).map((option) => option.key),
        })),
      })),
    })),
  };
}

function wrapperName(fn, index) {
  const markers = Object.getOwnPropertyNames(fn)
    .filter((key) => key.startsWith("__") && key !== "__original")
    .sort();
  return {
    index,
    name: fn.name || "anonymous",
    markers,
  };
}

async function run() {
  // Force the exact production route-composition order.
  if (typeof createApp !== "function") throw new Error("createApp unavailable");
  await connect();
  try {
    const { salad } = await seedFixture();
    const config = {
      source: "dashboard",
      status: "published",
      isCurrent: true,
      revisionHash: "premium-salad-diagnostics",
      publishedAt: new Date(),
      sections: [{
        key: "premium_large_salad",
        sectionType: "product_list",
        includeMode: "selected",
        selectedProductIds: [salad._id],
        selectionType: "premium_large_salad",
        visible: true,
        availableFor: ["subscription"],
        rules: {
          premium_large_salad: {
            linkedProductKey: "premium_large_salad",
            groups: [{
              groupKey: "proteins",
              allowedOptionKeys: ["grilled_chicken", "beef"],
            }],
          },
        },
      }],
    };

    const seen = new Set();
    let fn = mealBuilderConfigService.buildPlannerCatalogFromPublishedBuilder;
    let index = 0;
    while (typeof fn === "function" && !seen.has(fn) && index < 30) {
      seen.add(fn);
      let catalog;
      let error = null;
      try {
        catalog = await fn.call(mealBuilderConfigService, { config, lang: "en" });
      } catch (caught) {
        error = {
          name: caught?.name,
          code: caught?.code,
          message: caught?.message,
          stack: caught?.stack,
        };
      }
      console.log(JSON.stringify({
        wrapper: wrapperName(fn, index),
        error,
        summary: error ? null : summarize(catalog),
      }, null, 2));
      fn = fn.__original;
      index += 1;
    }

    console.log("premiumLargeSaladPublishedCatalogDiagnostics.test.js complete");
  } finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnect();
  }
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

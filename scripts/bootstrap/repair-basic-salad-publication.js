#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const CatalogItem = require("../../src/models/CatalogItem");
const MenuProduct = require("../../src/models/MenuProduct");
const { getPublishedMenu } = require("../../src/services/orders/menuCatalogService");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

const BASIC_SALAD_KEY = "basic_salad";
const CUSTOM_ORDER_KEY = "custom_order";

async function repairBasicSaladPublication() {
  const product = await MenuProduct.findOne({ key: BASIC_SALAD_KEY });
  if (!product) {
    throw new Error("basic_salad is missing. Run ensure-custom-order-compatibility first.");
  }

  const catalogItem = await CatalogItem.findOneAndUpdate(
    { key: BASIC_SALAD_KEY },
    {
      $set: {
        nameI18n: { ar: "سلطة بيسك", en: "Basic Salad" },
        descriptionI18n: {
          ar: "اختر البروتين والمكونات المتاحة وحدد الكمية المناسبة.",
          en: "Choose your protein and available ingredients, then select the quantity.",
        },
        imageUrl: product.imageUrl || "",
        itemKind: "product",
        nutrition: {
          calories: 0,
          proteinGrams: 0,
          carbsGrams: 0,
          fatGrams: 0,
        },
        isActive: true,
        isAvailable: true,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  await MenuProduct.updateOne(
    { _id: product._id },
    {
      $set: {
        catalogItemId: catalogItem._id,
        availableFor: ["one_time", "subscription"],
        isCustomizable: true,
        isActive: true,
        isVisible: true,
        isAvailable: true,
        publishedAt: product.publishedAt || new Date(),
      },
    },
    { runValidators: true }
  );

  const menu = await getPublishedMenu({ lang: "ar" });
  const category = (menu.categories || []).find((row) => row.key === CUSTOM_ORDER_KEY);
  const productKeys = (category?.products || []).map((row) => row.key);

  if (!productKeys.includes("basic_meal") || !productKeys.includes(BASIC_SALAD_KEY)) {
    const error = new Error(
      `Published custom_order section is incomplete. Returned products: ${productKeys.join(", ") || "none"}`
    );
    error.code = "CUSTOM_ORDER_PUBLICATION_INCOMPLETE";
    throw error;
  }

  return {
    categoryKey: category.key,
    productKeys,
    basicSalad: {
      id: product._id.toString(),
      catalogItemId: catalogItem._id.toString(),
      catalogItemActive: catalogItem.isActive,
      catalogItemAvailable: catalogItem.isAvailable,
    },
  };
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await repairBasicSaladPublication();
    console.log("[repair-basic-salad-publication] completed", result);
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[repair-basic-salad-publication:error] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  repairBasicSaladPublication,
};

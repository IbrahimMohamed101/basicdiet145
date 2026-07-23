#!/usr/bin/env node

"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const CatalogItem = require("../../src/models/CatalogItem");
const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const { getPublishedMenu } = require("../../src/services/orders/menuCatalogService");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");

const BASIC_SALAD_KEY = "basic_salad";
const SOURCE_SALAD_KEY = "salads_build_your_own_salad_100g_protein";
const CUSTOM_ORDER_KEY = "custom_order";

async function cloneSaladBuilderRelations(sourceProduct, targetProduct) {
  const sourceGroupRelations = await ProductOptionGroup.find({
    productId: sourceProduct._id,
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  }).sort({ sortOrder: 1 }).lean();

  if (!sourceGroupRelations.length) {
    throw new Error(
      `${SOURCE_SALAD_KEY} has no active builder groups. The workbook salad configuration must be imported first.`
    );
  }

  const sourceGroupIds = sourceGroupRelations.map((row) => row.groupId);
  const groups = await MenuOptionGroup.find({
    _id: { $in: sourceGroupIds },
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  }).lean();
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));

  const sourceOptionRelations = await ProductGroupOption.find({
    productId: sourceProduct._id,
    groupId: { $in: sourceGroupIds },
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  }).sort({ sortOrder: 1 }).lean();

  const optionIds = sourceOptionRelations.map((row) => row.optionId);
  const options = await MenuOption.find({
    _id: { $in: optionIds },
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  }).lean();
  const optionsById = new Map(options.map((option) => [String(option._id), option]));

  const activeTargetGroupRelationIds = [];
  const activeTargetOptionRelationIds = [];
  const summary = [];

  for (const sourceRelation of sourceGroupRelations) {
    const group = groupsById.get(String(sourceRelation.groupId));
    if (!group) continue;

    const targetRelation = await ProductOptionGroup.findOneAndUpdate(
      { productId: targetProduct._id, groupId: sourceRelation.groupId },
      {
        $set: {
          productId: targetProduct._id,
          groupId: sourceRelation.groupId,
          minSelections: Number(sourceRelation.minSelections || 0),
          maxSelections: Number(sourceRelation.maxSelections || 0),
          isRequired: Boolean(sourceRelation.isRequired),
          isActive: true,
          isVisible: true,
          isAvailable: true,
          sortOrder: Number(sourceRelation.sortOrder || group.sortOrder || 0),
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    activeTargetGroupRelationIds.push(targetRelation._id);

    const groupSourceOptions = sourceOptionRelations.filter(
      (row) => String(row.groupId) === String(sourceRelation.groupId)
    );
    let copiedOptions = 0;

    for (const sourceOptionRelation of groupSourceOptions) {
      const option = optionsById.get(String(sourceOptionRelation.optionId));
      if (!option || String(option.groupId) !== String(sourceRelation.groupId)) continue;

      await MenuOption.updateOne(
        { _id: option._id },
        {
          $set: {
            availableFor: ["one_time", "subscription"],
            availableForSubscription: true,
          },
        },
        { runValidators: true }
      );

      const targetOptionRelation = await ProductGroupOption.findOneAndUpdate(
        {
          productId: targetProduct._id,
          groupId: sourceOptionRelation.groupId,
          optionId: sourceOptionRelation.optionId,
        },
        {
          $set: {
            productId: targetProduct._id,
            groupId: sourceOptionRelation.groupId,
            optionId: sourceOptionRelation.optionId,
            extraPriceHalala: Number(sourceOptionRelation.extraPriceHalala || 0),
            extraWeightUnitGrams: Number(sourceOptionRelation.extraWeightUnitGrams || 0),
            extraWeightPriceHalala: Number(sourceOptionRelation.extraWeightPriceHalala || 0),
            isActive: true,
            isVisible: true,
            isAvailable: true,
            sortOrder: Number(sourceOptionRelation.sortOrder || option.sortOrder || 0),
          },
        },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      );
      activeTargetOptionRelationIds.push(targetOptionRelation._id);
      copiedOptions += 1;
    }

    summary.push({
      key: group.key,
      name: group.name,
      minSelections: Number(sourceRelation.minSelections || 0),
      maxSelections: Number(sourceRelation.maxSelections || 0),
      options: copiedOptions,
    });
  }

  if (!summary.length || !activeTargetOptionRelationIds.length) {
    throw new Error("No usable salad builder groups/options were found on the source salad product.");
  }

  await ProductOptionGroup.updateMany(
    {
      productId: targetProduct._id,
      _id: { $nin: activeTargetGroupRelationIds },
    },
    { $set: { isActive: false, isVisible: false, isAvailable: false } }
  );

  await ProductGroupOption.updateMany(
    {
      productId: targetProduct._id,
      _id: { $nin: activeTargetOptionRelationIds },
    },
    { $set: { isActive: false, isVisible: false, isAvailable: false } }
  );

  return summary;
}

async function repairBasicSaladPublication() {
  const [product, sourceProduct] = await Promise.all([
    MenuProduct.findOne({ key: BASIC_SALAD_KEY }),
    MenuProduct.findOne({ key: SOURCE_SALAD_KEY }),
  ]);

  if (!product) {
    throw new Error("basic_salad is missing. Run ensure-custom-order-compatibility first.");
  }
  if (!sourceProduct) {
    throw new Error(`${SOURCE_SALAD_KEY} is missing. Run the workbook production import first.`);
  }

  const saladName = {
    ar: "سلطة على مزاجك – 100جرام بروتين",
    en: "Build Your Own Salad – 100g Protein",
  };
  const saladDescription = {
    ar: "كوّن سلطتك من المكونات المتاحة واختر البروتين والصوص والإضافات على مزاجك.",
    en: "Build your salad from the available ingredients, protein, sauces, and extras.",
  };
  const imageUrl = sourceProduct.imageUrl || product.imageUrl || "";

  const catalogItem = await CatalogItem.findOneAndUpdate(
    { key: BASIC_SALAD_KEY },
    {
      $set: {
        nameI18n: saladName,
        descriptionI18n: saladDescription,
        imageUrl,
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
        name: saladName,
        description: saladDescription,
        imageUrl,
        itemType: "basic_salad",
        pricingModel: "fixed",
        priceHalala: 2900,
        baseUnitGrams: 100,
        defaultWeightGrams: 100,
        minWeightGrams: 100,
        maxWeightGrams: 100,
        weightStepGrams: 0,
        weightStepPriceHalala: 0,
        currency: "SAR",
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

  const refreshedTarget = await MenuProduct.findById(product._id);
  const builderGroups = await cloneSaladBuilderRelations(sourceProduct, refreshedTarget);

  const menu = await getPublishedMenu({ lang: "ar" });
  const category = (menu.categories || []).find((row) => row.key === CUSTOM_ORDER_KEY);
  const publicProduct = (category?.products || []).find((row) => row.key === BASIC_SALAD_KEY);
  const productKeys = (category?.products || []).map((row) => row.key);

  if (!productKeys.includes("basic_meal") || !publicProduct) {
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
      name: saladName,
      priceHalala: 2900,
      imageUrl,
      catalogItemId: catalogItem._id.toString(),
      catalogItemActive: catalogItem.isActive,
      catalogItemAvailable: catalogItem.isAvailable,
    },
    builderGroups,
  };
}

async function main() {
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await repairBasicSaladPublication();
    console.log("[repair-basic-salad-publication] completed", JSON.stringify(result, null, 2));
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
  cloneSaladBuilderRelations,
  repairBasicSaladPublication,
};

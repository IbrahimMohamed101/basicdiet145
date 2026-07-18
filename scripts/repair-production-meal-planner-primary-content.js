#!/usr/bin/env node
"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const MenuOption = require("../src/models/MenuOption");
const MenuOptionGroup = require("../src/models/MenuOptionGroup");
const MenuProduct = require("../src/models/MenuProduct");
const ProductGroupOption = require("../src/models/ProductGroupOption");
const ProductOptionGroup = require("../src/models/ProductOptionGroup");
const CatalogService = require("../src/services/catalog/CatalogService");
const {
  hasFlutterPrimaryMealPickerContent,
  summarizeFlutterPrimaryMealPickerContent,
} = require("../src/services/catalog/plannerCatalogContentValidator");
const { resolveMongoUri } = require("../src/utils/mongoUriResolver");

const APPLY_ENV = "ALLOW_PRODUCTION_MEAL_PLANNER_PRIMARY_REPAIR";
const PRIMARY_PRODUCT_KEY = "basic_meal";
const CURRENT_ITEM_TYPE = "product";
const REQUIRED_ITEM_TYPE = "basic_meal";

const DEFAULT_MODELS = {
  MenuOption,
  MenuOptionGroup,
  MenuProduct,
  ProductGroupOption,
  ProductOptionGroup,
};

function parseArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) return { applyRequested: false };
  if (argv.length === 1 && argv[0] === "--apply") return { applyRequested: true };
  throw new Error(`Unknown argument(s): ${argv.join(" ")}`);
}

function resolveApplyMode(applyRequested, env = process.env) {
  if (!applyRequested) return false;
  if (String(env[APPLY_ENV] || "").toLowerCase() !== "true") {
    throw new Error(`--apply requires ${APPLY_ENV}=true`);
  }
  return true;
}

function activePublishedQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...extra,
  };
}

function activeRelationQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    ...extra,
  };
}

function assertPrimaryProduct(products) {
  if (products.length !== 1) {
    throw new Error(`Expected exactly one ${PRIMARY_PRODUCT_KEY} product; found ${products.length}`);
  }
  const product = products[0];
  const eligible = product.isActive === true
    && product.isVisible !== false
    && product.isAvailable !== false
    && Boolean(product.publishedAt)
    && Array.isArray(product.availableFor)
    && product.availableFor.includes("subscription");
  if (!eligible) throw new Error(`${PRIMARY_PRODUCT_KEY} is not published and subscription-eligible`);
  if (![CURRENT_ITEM_TYPE, REQUIRED_ITEM_TYPE].includes(product.itemType)) {
    throw new Error(`Refusing unexpected ${PRIMARY_PRODUCT_KEY} itemType: ${product.itemType || "(missing)"}`);
  }
  return product;
}

async function uniqueProteinGroup(MenuOptionGroupModel) {
  const groups = await MenuOptionGroupModel.find(activePublishedQuery({ key: "proteins" })).lean();
  if (groups.length !== 1) {
    throw new Error(`Expected exactly one active published proteins group; found ${groups.length}`);
  }
  return groups[0];
}

async function assertProductGroupRelation(productId, groupId, ProductOptionGroupModel) {
  const relations = await ProductOptionGroupModel.find(activeRelationQuery({ productId, groupId })).lean();
  if (relations.length !== 1) {
    throw new Error(`Expected one active basic_meal proteins relation; found ${relations.length}`);
  }
}

async function selectableProteinOptionCount(productId, groupId, models) {
  const relations = await models.ProductGroupOption.find(
    activeRelationQuery({ productId, groupId })
  ).lean();
  if (relations.length === 0) throw new Error("basic_meal proteins relation has no active options");
  return models.MenuOption.countDocuments(activePublishedQuery({
    _id: { $in: relations.map((relation) => relation.optionId) },
    groupId,
    availableFor: "subscription",
    availableForSubscription: { $ne: false },
  }));
}

async function primaryProductPreflight(models) {
  const products = await models.MenuProduct.find({ key: PRIMARY_PRODUCT_KEY }).lean();
  const product = assertPrimaryProduct(products);
  const proteinGroup = await uniqueProteinGroup(models.MenuOptionGroup);
  await assertProductGroupRelation(product._id, proteinGroup._id, models.ProductOptionGroup);
  const proteinOptionCount = await selectableProteinOptionCount(product._id, proteinGroup._id, models);
  if (proteinOptionCount < 1) throw new Error("basic_meal has no selectable subscription protein options");
  return { product, proteinOptionCount };
}

async function loadCanonicalPlannerCatalog() {
  const bundle = await CatalogService.getSubscriptionBuilderCatalogWithV2({
    lang: "en",
    includeV3: true,
    includeV2: false,
    ignorePublishedMealBuilder: true,
  });
  return bundle.plannerCatalog;
}

async function validatedPrimaryContent(loadPlannerCatalog) {
  const plannerCatalog = await loadPlannerCatalog();
  const summary = summarizeFlutterPrimaryMealPickerContent(plannerCatalog);
  if (!hasFlutterPrimaryMealPickerContent(plannerCatalog)) {
    throw new Error(`Canonical planner still lacks Flutter primary content: ${JSON.stringify(summary)}`);
  }
  return summary;
}

async function applyItemTypeRepair(product, MenuProductModel) {
  const updateResult = await MenuProductModel.updateOne(
    activePublishedQuery({
      _id: product._id,
      key: PRIMARY_PRODUCT_KEY,
      itemType: CURRENT_ITEM_TYPE,
      availableFor: "subscription",
    }),
    { $set: { itemType: REQUIRED_ITEM_TYPE } }
  );
  if (updateResult.matchedCount !== 1 || updateResult.modifiedCount !== 1) {
    throw new Error("basic_meal changed or disappeared before the itemType repair");
  }
}

async function repairMealPlannerPrimaryContent({
  apply = false,
  models = DEFAULT_MODELS,
  loadPlannerCatalog = loadCanonicalPlannerCatalog,
} = {}) {
  const { product, proteinOptionCount } = await primaryProductPreflight(models);
  const report = {
    mode: apply ? "apply" : "dry_run",
    productId: String(product._id),
    productKey: PRIMARY_PRODUCT_KEY,
    previousItemType: product.itemType,
    nextItemType: REQUIRED_ITEM_TYPE,
    selectableProteinOptionCount: proteinOptionCount,
  };
  if (product.itemType === REQUIRED_ITEM_TYPE) {
    return { ...report, status: "already_current", primaryContent: await validatedPrimaryContent(loadPlannerCatalog) };
  }
  if (!apply) return { ...report, status: "would_update" };
  await applyItemTypeRepair(product, models.MenuProduct);
  return { ...report, status: "updated", primaryContent: await validatedPrimaryContent(loadPlannerCatalog) };
}

async function main() {
  const { applyRequested } = parseArgs();
  const apply = resolveApplyMode(applyRequested);
  await mongoose.connect(resolveMongoUri(), {
    serverSelectionTimeoutMS: 10000,
    autoCreate: false,
    autoIndex: false,
  });
  try {
    const report = await repairMealPlannerPrimaryContent({ apply });
    console.log(JSON.stringify({ database: mongoose.connection.name, ...report }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[meal-planner-primary-repair] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exitCode = 1;
  });
}

module.exports = {
  APPLY_ENV,
  parseArgs,
  repairMealPlannerPrimaryContent,
  resolveApplyMode,
};

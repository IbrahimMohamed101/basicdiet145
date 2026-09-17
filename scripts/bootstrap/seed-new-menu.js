#!/usr/bin/env node

require("dotenv").config();

const mongoose = require("mongoose");

const CatalogItem = require("../../src/models/CatalogItem");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuProduct = require("../../src/models/MenuProduct");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuOption = require("../../src/models/MenuOption");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const source = require("./fixtures/menu-workbook-source");

const READY_STATUS = "Ready";

function localized(value = {}) {
  return {
    ar: String(value.ar || "").trim(),
    en: String(value.en || "").trim(),
  };
}

function normalizeChannels(value) {
  const channels = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(
    channels
      .map((item) => String(item || "").trim())
      .filter((item) => ["one_time", "subscription"].includes(item))
  )];
}

function rowStatus(status) {
  const isReady = String(status || "").trim() === READY_STATUS;
  return {
    isReady,
    isActive: isReady,
    isVisible: isReady,
    isAvailable: isReady,
    publishedAt: isReady ? new Date() : null,
  };
}

function productItemType(categoryKey) {
  if (categoryKey === "sandwiches") return "sandwich";
  if (categoryKey === "carbs") return "carb";
  if (categoryKey === "desserts" || categoryKey === "ice_cream") return "dessert";
  if (categoryKey === "juices") return "juice";
  if (categoryKey === "drinks") return "drink";
  return "product";
}

function catalogItemKind(categoryKey) {
  if (categoryKey === "sandwiches") return "sandwich";
  if (categoryKey === "carbs") return "carb";
  if (categoryKey === "desserts" || categoryKey === "ice_cream") return "dessert";
  if (categoryKey === "juices" || categoryKey === "drinks") return "drink";
  return "product";
}

function optionCatalogItemKind(groupKey) {
  return groupKey === "carbs" ? "carb" : "protein";
}

function allBuilderOptions() {
  return source.builderGroups.flatMap((group) => (
    group.options.map((option) => ({ group, option }))
  ));
}

function productSortOrders(rows) {
  const counters = new Map();
  return rows.map((row) => {
    const next = (counters.get(row.categoryKey) || 0) + 1;
    counters.set(row.categoryKey, next);
    return next;
  });
}

async function writeInitial(Model, query, payload, { replaceExisting = false } = {}) {
  const existing = await Model.findOne(query);
  if (!existing) return { document: await Model.create(payload), status: "created" };
  if (!replaceExisting) return { document: existing, status: "skipped" };

  const updatePayload = { ...payload };
  delete updatePayload.key;
  await Model.updateOne({ _id: existing._id }, { $set: updatePayload }, { runValidators: true });
  return { document: await Model.findById(existing._id), status: "updated" };
}

function increment(stats, label, status) {
  if (!stats[label]) stats[label] = { created: 0, skipped: 0, updated: 0 };
  stats[label][status] += 1;
}

function validateSource() {
  const builderOptions = allBuilderOptions();
  const categoryKeys = new Set(source.categories.map((row) => row.key));
  const productKeys = new Set(source.products.map((row) => row.key));
  const groupKeys = new Set(source.builderGroups.map((row) => row.key));
  const optionKeys = new Set(builderOptions.map(({ option }) => option.key));

  if (categoryKeys.size !== source.categories.length) throw new Error("Workbook source contains duplicate category keys");
  if (productKeys.size !== source.products.length) throw new Error("Workbook source contains duplicate product keys");
  if (groupKeys.size !== source.builderGroups.length) throw new Error("Workbook source contains duplicate builder group keys");
  if (optionKeys.size !== builderOptions.length) throw new Error("Workbook source contains duplicate builder option keys");

  for (const product of source.products) {
    if (!categoryKeys.has(product.categoryKey)) {
      throw new Error(`Workbook product ${product.key} references unknown category ${product.categoryKey}`);
    }
    if (!Number.isInteger(Number(product.priceHalala)) || Number(product.priceHalala) < 0) {
      throw new Error(`Workbook product ${product.key} has invalid priceHalala`);
    }
  }

  const metadata = source.metadata || {};
  const expected = {
    categoryCount: source.categories.length,
    productCount: source.products.length,
    builderOptionCount: builderOptions.length,
    productCandidateCount: source.productCandidates.length,
    readyProductCount: source.products.filter((row) => row.status === READY_STATUS).length,
    draftProductCount: source.products.filter((row) => row.status !== READY_STATUS).length,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (Number(metadata[field]) !== value) {
      throw new Error(`Workbook metadata ${field} mismatch: expected ${value}, got ${metadata[field]}`);
    }
  }
  return expected;
}

async function seedNewMenu({ sync = false, replaceExisting = false, log = console } = {}) {
  if (sync) {
    throw new Error(
      "Workbook menu import is create-missing-only. Existing database/dashboard rows are never synchronized."
    );
  }

  const counts = validateSource();
  const stats = {};
  const categoryByKey = new Map();
  const productMap = new Map();
  const optionGroupByKey = new Map();
  const optionMap = new Map();
  const productOrders = productSortOrders(source.products);

  for (const row of source.categories) {
    const active = row.isActive !== false;
    const visible = row.isVisible !== false;
    const available = row.isAvailable !== false;
    const result = await writeInitial(MenuCategory, { key: row.key }, {
      key: row.key,
      name: localized(row.name),
      description: localized(row.description),
      imageUrl: "",
      isActive: active,
      isVisible: visible,
      isAvailable: available,
      sortOrder: Number(row.sortOrder || 0),
      ui: { ...row.ui },
      availability: { branchIds: [] },
      publishedAt: active && visible && available ? new Date() : null,
    }, { replaceExisting });
    categoryByKey.set(row.key, result.document);
    increment(stats, "categories", result.status);
  }

  for (let index = 0; index < source.products.length; index += 1) {
    const row = source.products[index];
    const category = categoryByKey.get(row.categoryKey);
    if (!category) throw new Error(`Missing workbook category ${row.categoryKey}`);

    const state = rowStatus(row.status);
    const catalogResult = await writeInitial(CatalogItem, { key: row.key }, {
      key: row.key,
      nameI18n: localized(row.name),
      descriptionI18n: localized(row.description),
      imageUrl: "",
      itemKind: catalogItemKind(row.categoryKey),
      nutrition: {
        calories: Number(row.nutrition?.calories || 0),
        proteinGrams: Number(row.nutrition?.proteinGrams || 0),
        carbsGrams: Number(row.nutrition?.carbGrams || 0),
        fatGrams: Number(row.nutrition?.fatGrams || 0),
      },
      isActive: state.isActive,
      isAvailable: state.isAvailable,
    }, { replaceExisting });
    increment(stats, "catalogItems", catalogResult.status);

    const channels = normalizeChannels(row.availableFor);
    const productResult = await writeInitial(MenuProduct, { key: row.key }, {
      categoryId: category._id,
      catalogItemId: catalogResult.document._id,
      key: row.key,
      name: localized(row.name),
      description: localized(row.description),
      imageUrl: "",
      itemType: productItemType(row.categoryKey),
      pricingModel: row.pricingModel || "fixed",
      priceHalala: Number(row.priceHalala || 0),
      currency: row.currency || "SAR",
      availableFor: channels.length ? channels : ["one_time", "subscription"],
      isCustomizable: row.isCustomizable === true,
      isActive: state.isActive,
      isVisible: state.isVisible,
      isAvailable: state.isAvailable,
      sortOrder: productOrders[index],
      ui: {},
      branchAvailability: [],
      publishedAt: state.publishedAt,
    }, { replaceExisting });
    productMap.set(row.key, productResult.document);
    increment(stats, "products", productResult.status);
  }

  for (let groupIndex = 0; groupIndex < source.builderGroups.length; groupIndex += 1) {
    const groupRow = source.builderGroups[groupIndex];
    const anyReady = groupRow.options.some((row) => row.status === READY_STATUS);
    const groupResult = await writeInitial(MenuOptionGroup, { key: groupRow.key }, {
      key: groupRow.key,
      name: localized(groupRow.name),
      description: localized({}),
      isActive: anyReady,
      isVisible: anyReady,
      isAvailable: anyReady,
      sortOrder: groupIndex + 1,
      ui: { displayStyle: "radio_cards" },
      publishedAt: anyReady ? new Date() : null,
    }, { replaceExisting });
    optionGroupByKey.set(groupRow.key, groupResult.document);
    increment(stats, "optionGroups", groupResult.status);

    for (let optionIndex = 0; optionIndex < groupRow.options.length; optionIndex += 1) {
      const row = groupRow.options[optionIndex];
      const state = rowStatus(row.status);
      const optionCatalogResult = await writeInitial(CatalogItem, { key: row.key }, {
        key: row.key,
        nameI18n: localized(row.name),
        descriptionI18n: localized({}),
        imageUrl: "",
        itemKind: optionCatalogItemKind(groupRow.key),
        nutrition: {},
        isActive: state.isActive,
        isAvailable: state.isAvailable,
      }, { replaceExisting });
      increment(stats, "catalogItems", optionCatalogResult.status);

      const channels = normalizeChannels(row.availableFor);
      const optionResult = await writeInitial(
        MenuOption,
        { groupId: groupResult.document._id, key: row.key },
        {
          groupId: groupResult.document._id,
          catalogItemId: optionCatalogResult.document._id,
          key: row.key,
          name: localized(row.name),
          description: localized({}),
          imageUrl: "",
          extraPriceHalala: 0,
          extraFeeHalala: 0,
          extraWeightUnitGrams: 0,
          extraWeightPriceHalala: 0,
          currency: "SAR",
          availableFor: channels.length ? channels : ["subscription"],
          availableForSubscription: channels.includes("subscription"),
          nutrition: {},
          proteinFamilyKey: groupRow.key === "carbs" ? "" : groupRow.key,
          displayCategoryKey: groupRow.key,
          premiumKey: "",
          ruleTags: [],
          selectionType: row.selectionType || "",
          isActive: state.isActive,
          isVisible: state.isVisible,
          isAvailable: state.isAvailable,
          sortOrder: optionIndex + 1,
          publishedAt: state.publishedAt,
        },
        { replaceExisting }
      );
      optionMap.set(row.key, optionResult.document);
      increment(stats, "options", optionResult.status);
    }
  }

  log.log(
    `Workbook menu import: categories=${counts.categoryCount} products=${counts.productCount} `
    + `ready=${counts.readyProductCount} review=${counts.draftProductCount} `
    + `builderOptions=${counts.builderOptionCount} candidatesNotSeeded=${counts.productCandidateCount}`
  );
  for (const [label, value] of Object.entries(stats)) {
    log.log(`${label}: created=${value.created} skipped=${value.skipped} updated=${value.updated}`);
  }

  return {
    sourceMetadata: source.metadata,
    counts,
    stats,
    categoryByKey,
    productMap,
    optionGroupByKey,
    optionMap,
  };
}

async function main() {
  if (process.argv.includes("--sync") || process.env.BOOTSTRAP_SYNC) {
    throw new Error("Workbook menu import never supports sync mode");
  }
  await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
  try {
    await seedNewMenu({ sync: false, log: console });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[seed-new-menu] ${error.message}`);
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  allBuilderOptions,
  catalogItemKind,
  normalizeChannels,
  productItemType,
  rowStatus,
  seedNewMenu,
  validateSource,
  writeInitial,
};

#!/usr/bin/env node

require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");

const Addon = require("../../src/models/Addon");
const AddonPlanPrice = require("../../src/models/AddonPlanPrice");
const CatalogItem = require("../../src/models/CatalogItem");
const MealBuilderConfig = require("../../src/models/MealBuilderConfig");
const MenuCategory = require("../../src/models/MenuCategory");
const MenuOption = require("../../src/models/MenuOption");
const MenuOptionGroup = require("../../src/models/MenuOptionGroup");
const MenuProduct = require("../../src/models/MenuProduct");
const PremiumUpgradeConfig = require("../../src/models/PremiumUpgradeConfig");
const ProductGroupOption = require("../../src/models/ProductGroupOption");
const ProductOptionGroup = require("../../src/models/ProductOptionGroup");
const Setting = require("../../src/models/Setting");
const Subscription = require("../../src/models/Subscription");
const { publishMenu } = require("../../src/services/orders/menuCatalogService");
const {
  CONTRACT_VERSION,
  computeRevisionHash,
  getReadinessReport,
  validateConfigObject,
} = require("../../src/services/subscription/mealBuilderConfigService");
const { resolveMongoUri } = require("../../src/utils/mongoUriResolver");
const source = require("./fixtures/menu-workbook-source");
const {
  seedSubscriptionPlans,
  subscriptionPlanKeys,
} = require("./seed-subscription-plans");

const IMPORT_KEY = "workbook_production_import_v1";
const SOURCE_SNAPSHOT_KEY = "workbook_menu_source_snapshot_v1";
const MEAL_BUILDER_KEY = "workbook_subscription_meal_builder_v1";
const IMPORT_VERSION = 1;
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_WAIT_MS = 2 * 60 * 1000;
const LOCK_POLL_MS = 2000;
const SYSTEM_CURRENCY = "SAR";
const READY_BUILDER_BLOCKED_STATUSES = new Set(["Needs Builder Setup"]);
const PREMIUM_BASE_PRICE_HALALA = 1900;

const PREMIUM_PRODUCT_DEFINITIONS = Object.freeze([
  { productKey: "meals_150g_beef_steak_meal", optionKey: "beef_steak", familyKey: "beef", sortOrder: 100 },
  { productKey: "meals_100g_shrimp_meal", optionKey: "shrimp", familyKey: "fish", sortOrder: 110 },
  { productKey: "meals_100g_salmon_meal", optionKey: "salmon", familyKey: "fish", sortOrder: 120 },
]);

const OPTION_KEY_OVERRIDES = Object.freeze({
  chicken_mexican_chicken: "mexican_chicken",
  chicken_creamy_chicken: "creamy_chicken",
  chicken_chicken_fajita: "chicken_fajita",
  chicken_chicken_strips: "chicken_strips",
  chicken_asian_chicken: "asian_chicken",
  chicken_chicken_tikka: "chicken_tikka",
  chicken_grilled_chicken: "grilled_chicken",
  carbs_white_rice: "white_rice",
  carbs_red_sauce_pasta: "red_sauce_pasta",
});

const ADDON_PLAN_DEFINITIONS = Object.freeze({
  juice: {
    name: { ar: "اشتراك العصير والمشروبات", en: "Juice & Drinks Subscription" },
    categories: ["juices", "drinks"],
    menuCategoryKeys: ["juices", "drinks"],
    dailyPriceHalala: 1100,
    sortOrder: 1,
    matrix: { 7: 10000, 26: 18000, 30: 30000 },
  },
  snack: {
    name: { ar: "اشتراك السناك", en: "Snack Subscription" },
    categories: ["desserts", "ice_cream", "greek_yogurt"],
    menuCategoryKeys: ["desserts", "ice_cream", "greek_yogurt"],
    dailyPriceHalala: 1200,
    sortOrder: 2,
    matrix: { 7: 8000, 26: 15000, 30: 25000 },
  },
  small_salad: {
    name: { ar: "اشتراك السلطة الصغيرة", en: "Small Salad Subscription" },
    categories: ["salads"],
    menuCategoryKeys: ["salads"],
    dailyPriceHalala: 1200,
    sortOrder: 3,
    matrix: { 7: 9000, 26: 16000, 30: 27000 },
  },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function logLine(log, level, message, details) {
  const target = log && (log[level] || log.log || log.info);
  if (typeof target !== "function") return;
  if (details === undefined) target.call(log, message);
  else target.call(log, message, details);
}

function localized(value = {}) {
  return {
    ar: String(value.ar || "").trim(),
    en: String(value.en || "").trim(),
  };
}

function normalizeCategory(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function productRuntimeState(row, { candidate = false } = {}) {
  const active = !candidate && !READY_BUILDER_BLOCKED_STATUSES.has(String(row.status || ""));
  return {
    isActive: active,
    isVisible: active,
    isAvailable: active,
    publishedAt: active ? new Date() : null,
  };
}

function productItemType(categoryKey) {
  if (categoryKey === "sandwiches") return "sandwich";
  if (categoryKey === "carbs") return "carb";
  if (["desserts", "ice_cream"].includes(categoryKey)) return "dessert";
  if (categoryKey === "juices") return "juice";
  if (categoryKey === "drinks") return "drink";
  return "product";
}

function catalogItemKind(categoryKey) {
  if (categoryKey === "sandwiches") return "sandwich";
  if (categoryKey === "carbs") return "carb";
  if (["desserts", "ice_cream"].includes(categoryKey)) return "dessert";
  if (["juices", "drinks"].includes(categoryKey)) return "drink";
  return "product";
}

function productUi(row) {
  const customizable = row.isCustomizable === true;
  return {
    cardVariant: row.categoryKey === "sandwiches"
      ? "sandwich_card"
      : customizable
        ? "ready_meal_customizable"
        : ["desserts", "ice_cream", "juices", "drinks", "greek_yogurt", "carbs"].includes(row.categoryKey)
          ? "compact_product"
          : "ready_meal",
    cardSize: "medium",
    showDescription: true,
    showPrice: true,
    priceLabelMode: customizable ? "final_depends_on_options" : "fixed",
    behaviorHint: customizable ? "open_builder" : "direct_add",
  };
}

function canonicalOptionKey(groupKey, sourceKey) {
  if (OPTION_KEY_OVERRIDES[sourceKey]) return OPTION_KEY_OVERRIDES[sourceKey];
  const prefix = `${groupKey}_`;
  return sourceKey.startsWith(prefix) ? sourceKey.slice(prefix.length) : sourceKey;
}

function buildCanonicalBuilderRows() {
  const rows = [];
  let proteinSort = 0;
  let carbSort = 0;

  for (const group of source.builderGroups) {
    for (const option of group.options) {
      if (group.key === "carbs") {
        carbSort += 1;
        rows.push({
          sourceGroupKey: group.key,
          sourceOptionKey: option.key,
          groupKey: "carbs",
          key: canonicalOptionKey(group.key, option.key),
          name: localized(option.name),
          selectionType: "standard_meal",
          proteinFamilyKey: "",
          displayCategoryKey: "standard_carbs",
          extraPriceHalala: 0,
          sortOrder: carbSort,
          premium: false,
        });
      } else {
        proteinSort += 1;
        rows.push({
          sourceGroupKey: group.key,
          sourceOptionKey: option.key,
          groupKey: "proteins",
          key: canonicalOptionKey(group.key, option.key),
          name: localized(option.name),
          selectionType: "standard_meal",
          proteinFamilyKey: group.key,
          displayCategoryKey: group.key,
          extraPriceHalala: 0,
          sortOrder: proteinSort,
          premium: false,
        });
      }
    }
  }

  const productByKey = new Map(source.products.map((row) => [row.key, row]));
  for (const definition of PREMIUM_PRODUCT_DEFINITIONS) {
    const product = productByKey.get(definition.productKey);
    if (!product) throw new Error(`Missing workbook premium product ${definition.productKey}`);
    rows.push({
      sourceGroupKey: "premium",
      sourceOptionKey: definition.productKey,
      sourceProductKey: definition.productKey,
      groupKey: "proteins",
      key: definition.optionKey,
      name: localized(product.name),
      description: localized(product.description),
      nutrition: clone(product.nutrition || {}),
      selectionType: "premium_meal",
      proteinFamilyKey: definition.familyKey,
      displayCategoryKey: "premium",
      extraPriceHalala: Math.max(0, Number(product.priceHalala || 0) - PREMIUM_BASE_PRICE_HALALA),
      sortOrder: definition.sortOrder,
      premium: true,
    });
  }

  const seen = new Set();
  for (const row of rows) {
    const identity = `${row.groupKey}:${row.key}`;
    if (seen.has(identity)) throw new Error(`Duplicate canonical builder option ${identity}`);
    seen.add(identity);
  }
  return rows;
}

function buildExpectedKeys() {
  const optionRows = buildCanonicalBuilderRows();
  return {
    categoryKeys: new Set(source.categories.map((row) => row.key)),
    workbookProductKeys: new Set(source.products.map((row) => row.key)),
    candidateProductKeys: new Set(source.productCandidates.map((row) => row.key)),
    productKeys: new Set([
      ...source.products.map((row) => row.key),
      ...source.productCandidates.map((row) => row.key),
      "basic_meal",
    ]),
    groupKeys: new Set(["proteins", "carbs"]),
    optionKeys: new Set(optionRows.map((row) => row.key)),
    optionRows,
  };
}

async function upsertDocument(Model, query, payload) {
  return Model.findOneAndUpdate(
    query,
    { $set: payload },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function updateMarker(value) {
  await Setting.updateOne(
    { key: IMPORT_KEY },
    {
      $set: {
        value: { version: IMPORT_VERSION, sourceSha256: source.metadata.sha256, updatedAt: nowIso(), ...value },
        description: "One-time production workbook menu, subscription, and add-on import state.",
      },
    },
    { upsert: true }
  );
}

async function readMarker() {
  const row = await Setting.findOne({ key: IMPORT_KEY }).lean();
  return row?.value && typeof row.value === "object" ? row.value : null;
}

async function waitForRunningImport(log) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(LOCK_POLL_MS);
    const marker = await readMarker();
    if (marker?.status === "completed" && marker.sourceSha256 === source.metadata.sha256) {
      logLine(log, "log", "[workbook-production-import] another instance completed the import");
      return marker;
    }
    if (marker?.status === "failed") {
      throw new Error(`Concurrent workbook import failed: ${marker.error?.message || "unknown error"}`);
    }
  }
  throw new Error("Timed out waiting for the running workbook production import");
}

async function acquireImportLock({ log = console } = {}) {
  const attemptId = crypto.randomUUID();
  const marker = await readMarker();
  if (marker?.status === "completed" && marker.sourceSha256 === source.metadata.sha256) {
    return { acquired: false, completed: true, attemptId, marker };
  }

  if (marker?.status === "running") {
    const updatedAt = Date.parse(marker.updatedAt || marker.startedAt || 0);
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt < LOCK_STALE_MS) {
      const completedMarker = await waitForRunningImport(log);
      return { acquired: false, completed: true, attemptId, marker: completedMarker };
    }
  }

  await updateMarker({ status: "running", attemptId, startedAt: nowIso(), phase: "lock_acquired" });
  return { acquired: true, completed: false, attemptId, marker: null };
}

async function heartbeat(attemptId, phase, details = {}) {
  const current = await readMarker();
  if (current?.attemptId && current.attemptId !== attemptId && current.status === "running") {
    throw new Error("Workbook production import lock ownership changed");
  }
  await updateMarker({ ...current, status: "running", attemptId, phase, ...details });
}

async function storeSourceSnapshot() {
  await Setting.updateOne(
    { key: SOURCE_SNAPSHOT_KEY },
    {
      $set: {
        value: {
          metadata: clone(source.metadata),
          categories: clone(source.categories),
          products: clone(source.products),
          builderGroups: clone(source.builderGroups),
          productCandidates: clone(source.productCandidates),
          reviewItems: clone(source.reviewItems),
          storedAt: nowIso(),
        },
        description: "Immutable source snapshot used for the production workbook import.",
      },
    },
    { upsert: true }
  );
}

async function seedCategories(now) {
  const categoryByKey = new Map();
  for (const row of source.categories) {
    const doc = await upsertDocument(MenuCategory, { key: row.key }, {
      key: row.key,
      name: localized(row.name),
      description: localized(row.description),
      imageUrl: "",
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: Number(row.sortOrder || 0),
      ui: clone(row.ui || {}),
      availability: { branchIds: [] },
      publishedAt: now,
    });
    categoryByKey.set(row.key, doc);
  }
  await MenuCategory.updateMany(
    { key: { $nin: [...categoryByKey.keys()] } },
    { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } }
  );
  return categoryByKey;
}

async function seedCatalogItemForProduct(row, state, { candidate = false } = {}) {
  return upsertDocument(CatalogItem, { key: row.key }, {
    key: row.key,
    nameI18n: localized(row.name),
    descriptionI18n: localized(row.description),
    imageUrl: "",
    itemKind: catalogItemKind(row.categoryKey || "desserts"),
    nutrition: {
      calories: Number(row.nutrition?.calories || 0),
      proteinGrams: Number(row.nutrition?.proteinGrams || 0),
      carbsGrams: Number(row.nutrition?.carbGrams || 0),
      fatGrams: Number(row.nutrition?.fatGrams || 0),
    },
    isActive: state.isActive && !candidate,
    isAvailable: state.isAvailable && !candidate,
  });
}

async function seedProducts(categoryByKey, now) {
  const productByKey = new Map();
  const productSortByCategory = new Map();

  for (const row of source.products) {
    const category = categoryByKey.get(row.categoryKey);
    if (!category) throw new Error(`Missing category ${row.categoryKey} for ${row.key}`);
    const state = productRuntimeState(row);
    const catalog = await seedCatalogItemForProduct(row, state);
    const sortOrder = (productSortByCategory.get(row.categoryKey) || 0) + 1;
    productSortByCategory.set(row.categoryKey, sortOrder);
    const doc = await upsertDocument(MenuProduct, { key: row.key }, {
      categoryId: category._id,
      catalogItemId: catalog._id,
      key: row.key,
      name: localized(row.name),
      description: localized(row.description),
      imageUrl: "",
      itemType: productItemType(row.categoryKey),
      pricingModel: row.pricingModel || "fixed",
      priceHalala: Number(row.priceHalala || 0),
      defaultWeightGrams: 0,
      currency: row.currency || SYSTEM_CURRENCY,
      availableFor: Array.isArray(row.availableFor) && row.availableFor.length
        ? [...new Set(row.availableFor)]
        : ["one_time", "subscription"],
      isCustomizable: row.isCustomizable === true,
      isActive: state.isActive,
      isVisible: state.isVisible,
      isAvailable: state.isAvailable,
      sortOrder,
      ui: productUi(row),
      branchAvailability: [],
      publishedAt: state.publishedAt,
    });
    productByKey.set(row.key, doc);
  }

  const dessertsCategory = categoryByKey.get("desserts");
  for (let index = 0; index < source.productCandidates.length; index += 1) {
    const candidate = source.productCandidates[index];
    const row = {
      categoryKey: "desserts",
      key: candidate.key,
      name: candidate.name,
      description: { ar: "", en: "" },
      nutrition: {},
      status: candidate.status || "Draft",
      pricingModel: "fixed",
      priceHalala: 0,
      currency: SYSTEM_CURRENCY,
      availableFor: ["one_time", "subscription"],
      isCustomizable: false,
    };
    const state = productRuntimeState(row, { candidate: true });
    const catalog = await seedCatalogItemForProduct(row, state, { candidate: true });
    const doc = await upsertDocument(MenuProduct, { key: row.key }, {
      categoryId: dessertsCategory._id,
      catalogItemId: catalog._id,
      key: row.key,
      name: localized(row.name),
      description: localized(row.description),
      imageUrl: "",
      itemType: "dessert",
      pricingModel: "fixed",
      priceHalala: 0,
      currency: SYSTEM_CURRENCY,
      availableFor: ["one_time", "subscription"],
      isCustomizable: false,
      isActive: false,
      isVisible: false,
      isAvailable: false,
      sortOrder: 1000 + index,
      ui: productUi(row),
      branchAvailability: [],
      publishedAt: null,
    });
    productByKey.set(row.key, doc);
  }

  const basicCatalog = await upsertDocument(CatalogItem, { key: "basic_meal" }, {
    key: "basic_meal",
    nameI18n: { ar: "وجبة حسب اختيارك", en: "Build Your Meal" },
    descriptionI18n: { ar: "اختر البروتين والنشويات من قائمة الاشتراك.", en: "Choose protein and carbs from the subscription menu." },
    imageUrl: "",
    itemKind: "product",
    nutrition: {},
    isActive: true,
    isAvailable: true,
  });
  const basicMeal = await upsertDocument(MenuProduct, { key: "basic_meal" }, {
    categoryId: categoryByKey.get("meals")._id,
    catalogItemId: basicCatalog._id,
    key: "basic_meal",
    name: { ar: "وجبة حسب اختيارك", en: "Build Your Meal" },
    description: { ar: "اختر البروتين والنشويات من قائمة الاشتراك.", en: "Choose protein and carbs from the subscription menu." },
    imageUrl: "",
    itemType: "basic_meal",
    pricingModel: "fixed",
    priceHalala: 0,
    currency: SYSTEM_CURRENCY,
    availableFor: ["subscription"],
    isCustomizable: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 0,
    ui: {
      cardVariant: "hero_builder",
      cardSize: "large",
      showDescription: true,
      showPrice: false,
      priceLabelMode: "final_depends_on_options",
      behaviorHint: "open_builder",
    },
    branchAvailability: [],
    publishedAt: now,
  });
  productByKey.set("basic_meal", basicMeal);

  const expected = buildExpectedKeys();
  const extraProducts = await MenuProduct.find({ key: { $nin: [...expected.productKeys] } }).select("_id catalogItemId").lean();
  await MenuProduct.updateMany(
    { _id: { $in: extraProducts.map((row) => row._id) } },
    { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } }
  );
  const extraCatalogIds = extraProducts.map((row) => row.catalogItemId).filter(Boolean);
  if (extraCatalogIds.length) {
    await CatalogItem.updateMany(
      { _id: { $in: extraCatalogIds } },
      { $set: { isActive: false, isAvailable: false } }
    );
  }

  return { productByKey, basicMeal };
}

async function seedBuilderCatalog({ basicMeal, now }) {
  const proteins = await upsertDocument(MenuOptionGroup, { key: "proteins" }, {
    key: "proteins",
    name: { ar: "البروتين", en: "Protein" },
    description: { ar: "خيارات البروتين من ملف المنيو.", en: "Protein choices from the menu workbook." },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 1,
    ui: { displayStyle: "radio_cards" },
    publishedAt: now,
  });
  const carbs = await upsertDocument(MenuOptionGroup, { key: "carbs" }, {
    key: "carbs",
    name: { ar: "النشويات", en: "Carbs" },
    description: { ar: "خيارات النشويات من ملف المنيو.", en: "Carb choices from the menu workbook." },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 2,
    ui: { displayStyle: "checkbox_grid" },
    publishedAt: now,
  });
  const groupByKey = new Map([["proteins", proteins], ["carbs", carbs]]);
  const optionRows = buildCanonicalBuilderRows();
  const optionByKey = new Map();

  for (const row of optionRows) {
    const group = groupByKey.get(row.groupKey);
    const itemKind = row.groupKey === "carbs" ? "carb" : "protein";
    const catalog = await upsertDocument(CatalogItem, { key: row.key }, {
      key: row.key,
      nameI18n: row.name,
      descriptionI18n: row.description || row.name,
      imageUrl: "",
      itemKind,
      nutrition: {
        calories: Number(row.nutrition?.calories || 0),
        proteinGrams: Number(row.nutrition?.proteinGrams || 0),
        carbsGrams: Number(row.nutrition?.carbGrams || 0),
        fatGrams: Number(row.nutrition?.fatGrams || 0),
      },
      isActive: true,
      isAvailable: true,
    });
    const option = await upsertDocument(MenuOption, { groupId: group._id, key: row.key }, {
      groupId: group._id,
      catalogItemId: catalog._id,
      key: row.key,
      name: row.name,
      description: row.description || row.name,
      imageUrl: "",
      extraPriceHalala: Number(row.extraPriceHalala || 0),
      extraFeeHalala: Number(row.extraPriceHalala || 0),
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: 0,
      currency: SYSTEM_CURRENCY,
      availableFor: ["subscription"],
      availableForSubscription: true,
      nutrition: {
        calories: Number(row.nutrition?.calories || 0),
        proteinGrams: Number(row.nutrition?.proteinGrams || 0),
        carbGrams: Number(row.nutrition?.carbGrams || 0),
        fatGrams: Number(row.nutrition?.fatGrams || 0),
      },
      proteinFamilyKey: row.proteinFamilyKey,
      displayCategoryKey: row.displayCategoryKey,
      premiumKey: row.premium ? row.key : "",
      ruleTags: [],
      selectionType: row.selectionType,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: row.sortOrder,
      publishedAt: now,
    });
    optionByKey.set(row.key, option);
  }

  await MenuOptionGroup.updateMany(
    { key: { $nin: ["proteins", "carbs"] } },
    { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } }
  );
  const expectedOptionIds = [...optionByKey.values()].map((row) => row._id);
  const extraOptions = await MenuOption.find({ _id: { $nin: expectedOptionIds } }).select("_id catalogItemId").lean();
  if (extraOptions.length) {
    await MenuOption.updateMany(
      { _id: { $in: extraOptions.map((row) => row._id) } },
      { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } }
    );
    await CatalogItem.updateMany(
      { _id: { $in: extraOptions.map((row) => row.catalogItemId).filter(Boolean) } },
      { $set: { isActive: false, isAvailable: false } }
    );
  }

  const proteinRelation = await upsertDocument(ProductOptionGroup, {
    productId: basicMeal._id,
    groupId: proteins._id,
  }, {
    productId: basicMeal._id,
    groupId: proteins._id,
    minSelections: 1,
    maxSelections: 1,
    isRequired: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 1,
  });
  const carbRelation = await upsertDocument(ProductOptionGroup, {
    productId: basicMeal._id,
    groupId: carbs._id,
  }, {
    productId: basicMeal._id,
    groupId: carbs._id,
    minSelections: 1,
    maxSelections: 2,
    isRequired: true,
    isActive: true,
    isVisible: true,
    isAvailable: true,
    sortOrder: 2,
  });

  const activeRelationIds = [];
  for (const row of optionRows) {
    const group = groupByKey.get(row.groupKey);
    const option = optionByKey.get(row.key);
    const relation = await upsertDocument(ProductGroupOption, {
      productId: basicMeal._id,
      groupId: group._id,
      optionId: option._id,
    }, {
      productId: basicMeal._id,
      groupId: group._id,
      optionId: option._id,
      extraPriceHalala: Number(row.extraPriceHalala || 0),
      extraWeightUnitGrams: 0,
      extraWeightPriceHalala: 0,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: row.sortOrder,
    });
    activeRelationIds.push(relation._id);
  }

  await ProductOptionGroup.updateMany(
    { _id: { $nin: [proteinRelation._id, carbRelation._id] } },
    { $set: { isActive: false, isVisible: false, isAvailable: false } }
  );
  await ProductGroupOption.updateMany(
    { _id: { $nin: activeRelationIds } },
    { $set: { isActive: false, isVisible: false, isAvailable: false } }
  );

  return { proteins, carbs, optionRows, optionByKey };
}

async function seedPremiumConfigs({ basicMeal, proteins, optionByKey }) {
  const activeConfigIds = [];
  for (const definition of PREMIUM_PRODUCT_DEFINITIONS) {
    const option = optionByKey.get(definition.optionKey);
    const product = source.products.find((row) => row.key === definition.productKey);
    const upgradeDeltaHalala = Math.max(0, Number(product.priceHalala || 0) - PREMIUM_BASE_PRICE_HALALA);
    const existing = await PremiumUpgradeConfig.findOne({ premiumKey: definition.optionKey });
    const payload = {
      sourceType: "menu_option",
      sourceId: option._id,
      sourceProductId: basicMeal._id,
      sourceGroupId: proteins._id,
      selectionType: "premium_meal",
      premiumKey: definition.optionKey,
      displayGroupKey: "premium",
      upgradeDeltaHalala,
      currency: SYSTEM_CURRENCY,
      isEnabled: true,
      isVisible: true,
      status: "active",
      sortOrder: definition.sortOrder,
      metadata: {
        workbookSourceProductKey: definition.productKey,
        workbookSourceSha256: source.metadata.sha256,
      },
      sourceSnapshot: {
        key: option.key,
        name: localized(product.name),
        context: { groupKey: "proteins", productKey: "basic_meal" },
      },
      revision: Math.max(1, Number(existing?.revision || 0) + (existing ? 1 : 0)),
      archiveReason: null,
    };
    const config = existing
      ? await PremiumUpgradeConfig.findOneAndUpdate({ _id: existing._id }, { $set: payload }, { new: true, runValidators: true })
      : await PremiumUpgradeConfig.create(payload);
    activeConfigIds.push(config._id);
  }
  await PremiumUpgradeConfig.updateMany(
    { _id: { $nin: activeConfigIds } },
    { $set: { status: "archived", isEnabled: false, isVisible: false, archiveReason: "Replaced by workbook production import" } }
  );
  return activeConfigIds;
}

function directMealRows() {
  const premiumProductKeys = new Set(PREMIUM_PRODUCT_DEFINITIONS.map((row) => row.productKey));
  return source.products.filter((row) => (
    !READY_BUILDER_BLOCKED_STATUSES.has(String(row.status || ""))
    && ["breakfast", "meals", "salads"].includes(row.categoryKey)
    && !premiumProductKeys.has(row.key)
  ));
}

function sectionBase(overrides = {}) {
  return {
    sectionType: "product_list",
    sourceKind: "product_list",
    titleOverride: { ar: "", en: "" },
    productContextId: null,
    sourceGroupId: null,
    sourceCategoryId: null,
    selectedOptionIds: [],
    selectedProductIds: [],
    includeMode: "selected",
    selectionType: "",
    sortOrder: 0,
    required: false,
    minSelections: 0,
    maxSelections: 1,
    multiSelect: false,
    visible: true,
    availableFor: ["subscription"],
    metadata: {},
    rules: {},
    ...overrides,
  };
}

async function seedMealBuilderConfig({ basicMeal, proteins, carbs, optionRows, optionByKey, productByKey }) {
  const standardFamilySections = ["chicken", "beef", "fish"].map((familyKey, index) => sectionBase({
    key: familyKey,
    sectionType: "option_group",
    sourceKind: "visual_family",
    titleOverride: source.builderGroups.find((row) => row.key === familyKey)?.name || { ar: familyKey, en: familyKey },
    productContextId: basicMeal._id,
    sourceGroupId: proteins._id,
    selectedOptionIds: optionRows
      .filter((row) => !row.premium && row.groupKey === "proteins" && row.proteinFamilyKey === familyKey)
      .map((row) => optionByKey.get(row.key)._id),
    selectionType: "standard_meal",
    sortOrder: 30 + (index * 10),
    metadata: { visualRole: "protein_family", proteinFamilyKey: familyKey },
  }));

  const premiumSection = sectionBase({
    key: "premium",
    sectionType: "option_group",
    sourceKind: "premium_visual",
    titleOverride: { ar: "وجبات مميزة", en: "Premium Meals" },
    productContextId: basicMeal._id,
    sourceGroupId: proteins._id,
    selectedOptionIds: optionRows.filter((row) => row.premium).map((row) => optionByKey.get(row.key)._id),
    selectionType: "premium_meal",
    sortOrder: 10,
    metadata: { visualRole: "premium" },
  });

  const sandwichProducts = source.products
    .filter((row) => row.categoryKey === "sandwiches" && !READY_BUILDER_BLOCKED_STATUSES.has(String(row.status || "")))
    .map((row) => productByKey.get(row.key)._id);
  const sandwichSection = sectionBase({
    key: "sandwich",
    titleOverride: { ar: "الساندويتشات", en: "Sandwiches" },
    selectedProductIds: sandwichProducts,
    selectionType: "sandwich",
    sortOrder: 20,
    metadata: { treatAsFullMeal: true, classificationAuthority: "meal_product_classification.v1" },
  });

  const readyMealsSection = sectionBase({
    key: "ready_meals",
    titleOverride: { ar: "الوجبات الجاهزة", en: "Ready Meals" },
    selectedProductIds: directMealRows().map((row) => productByKey.get(row.key)._id),
    selectionType: "full_meal_product",
    sortOrder: 25,
    metadata: { treatAsFullMeal: true, classificationAuthority: "meal_product_classification.v1" },
  });

  const carbSection = sectionBase({
    key: "carbs",
    sectionType: "option_group",
    sourceKind: "visual_family",
    titleOverride: { ar: "النشويات", en: "Carbs" },
    productContextId: basicMeal._id,
    sourceGroupId: carbs._id,
    selectedOptionIds: optionRows.filter((row) => row.groupKey === "carbs").map((row) => optionByKey.get(row.key)._id),
    selectionType: "standard_meal",
    sortOrder: 70,
    required: true,
    minSelections: 1,
    maxSelections: 2,
    multiSelect: true,
    metadata: { visualRole: "carbs" },
    rules: { maxTypes: 2, maxTotalGrams: 300, unit: "grams", ruleKey: "carb_split" },
  });

  const sections = [premiumSection, sandwichSection, readyMealsSection, ...standardFamilySections, carbSection];
  const validation = await validateConfigObject({ sections });
  if (!validation.ready) {
    const error = new Error(`Workbook Meal Builder config is not publishable: ${(validation.errors || []).map((row) => `${row.code}: ${row.message}`).join("; ")}`);
    error.code = "WORKBOOK_MEAL_BUILDER_INVALID";
    error.details = validation.errors || [];
    throw error;
  }

  await MealBuilderConfig.updateMany(
    { isCurrent: true },
    { $set: { isCurrent: false, status: "archived" } }
  );
  const versionNumber = Number(await MealBuilderConfig.countDocuments({ status: "published" })) + 1;
  const common = {
    isCurrent: true,
    contractVersion: CONTRACT_VERSION,
    versionNumber,
    basedOnPublishedVersionId: null,
    source: "bootstrap",
    createdBySystem: true,
    bootstrapKey: MEAL_BUILDER_KEY,
    sections,
    notes: `One-time workbook subscription catalog ${source.metadata.sha256}`,
    publishedBy: null,
    createdBy: null,
    updatedBy: null,
  };
  const publishedPayload = { ...common, status: "published", publishedAt: new Date() };
  publishedPayload.revisionHash = computeRevisionHash(publishedPayload);
  const published = await MealBuilderConfig.create(publishedPayload);
  const draftPayload = {
    ...common,
    status: "draft",
    publishedAt: null,
    basedOnPublishedVersionId: published._id,
  };
  draftPayload.revisionHash = computeRevisionHash(draftPayload);
  const draft = await MealBuilderConfig.create(draftPayload);
  const readiness = await getReadinessReport();
  if (
    readiness.status === "error"
    || Number(readiness.summary?.errors || 0) > 0
    || (Array.isArray(readiness.errors) && readiness.errors.length > 0)
  ) {
    const error = new Error(`Workbook Meal Builder readiness failed: ${readiness.status}`);
    error.code = "WORKBOOK_MEAL_BUILDER_NOT_READY";
    error.details = readiness;
    throw error;
  }
  return { published, draft, validation, readiness, sections };
}

function addonCategoryForProduct(row) {
  if (["juices", "drinks"].includes(row.categoryKey)) return "juice";
  if (["desserts", "ice_cream", "greek_yogurt"].includes(row.categoryKey)) return "snack";
  if (row.categoryKey === "salads" && (
    row.key.endsWith("_small")
    || ["salads_green_salad", "salads_fruit_salad_150g"].includes(row.key)
  )) return "small_salad";
  return null;
}

function menuProductSnapshot(product, categoryKey) {
  return {
    id: product._id,
    key: product.key,
    name: clone(product.name || {}),
    nameI18n: clone(product.name || {}),
    description: clone(product.description || {}),
    descriptionI18n: clone(product.description || {}),
    imageUrl: product.imageUrl || "",
    category: categoryKey,
    categoryKey,
    itemType: product.itemType || "",
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || SYSTEM_CURRENCY,
  };
}

async function seedSubscriptionAddons({ productByKey }) {
  const addonProductsByCategory = new Map(Object.keys(ADDON_PLAN_DEFINITIONS).map((key) => [key, []]));
  const activeItemAddonIds = [];

  for (const row of source.products) {
    const category = addonCategoryForProduct(row);
    if (!category || READY_BUILDER_BLOCKED_STATUSES.has(String(row.status || ""))) continue;
    const product = productByKey.get(row.key);
    addonProductsByCategory.get(category).push(product);
    const item = await upsertDocument(Addon, { kind: "item", menuProductId: product._id }, {
      name: localized(row.name),
      description: localized(row.description),
      imageUrl: product.imageUrl || "",
      priceHalala: Number(row.priceHalala || 0),
      price: Number(row.priceHalala || 0) / 100,
      priceSar: Number(row.priceHalala || 0) / 100,
      priceLabel: `${Number(row.priceHalala || 0) / 100} SAR`,
      currency: row.currency || SYSTEM_CURRENCY,
      isActive: true,
      isArchived: false,
      archivedAt: null,
      sortOrder: Number(product.sortOrder || 0),
      billingMode: "flat_once",
      kind: "item",
      type: "one_time",
      pricingModel: "one_time",
      billingUnit: "item",
      category,
      displayKey: category,
      menuProductId: product._id,
      menuProductIds: [],
      menuCategoryKeys: [row.categoryKey],
      maxPerDay: 1,
    });
    activeItemAddonIds.push(item._id);
  }

  await Addon.updateMany(
    { kind: "item", _id: { $nin: activeItemAddonIds } },
    { $set: { isActive: false, isArchived: true, archivedAt: new Date() } }
  );

  const planByCategory = new Map();
  for (const [category, definition] of Object.entries(ADDON_PLAN_DEFINITIONS)) {
    const products = addonProductsByCategory.get(category);
    const existing = await Addon.findOne({ kind: "plan", category }).sort({ createdAt: 1 });
    const payload = {
      name: definition.name,
      description: { ar: "", en: "" },
      imageUrl: "",
      priceHalala: definition.dailyPriceHalala,
      price: definition.dailyPriceHalala / 100,
      priceSar: definition.dailyPriceHalala / 100,
      priceLabel: `${definition.dailyPriceHalala / 100} SAR`,
      currency: SYSTEM_CURRENCY,
      isActive: true,
      isArchived: false,
      archivedAt: null,
      sortOrder: definition.sortOrder,
      billingMode: "per_day",
      kind: "plan",
      type: "subscription",
      pricingModel: "subscription",
      billingUnit: "day",
      category,
      displayKey: category,
      menuProductId: null,
      menuProductIds: products.map((product) => product._id),
      menuCategoryKeys: definition.menuCategoryKeys,
      maxPerDay: 1,
      pricingMode: "base_plan_matrix",
    };
    const plan = existing
      ? await Addon.findOneAndUpdate({ _id: existing._id }, { $set: payload }, { new: true, runValidators: true })
      : await Addon.create(payload);
    planByCategory.set(category, plan);
    await Addon.updateMany(
      { kind: "plan", category, _id: { $ne: plan._id } },
      { $set: { isActive: false, isArchived: true, archivedAt: new Date() } }
    );
  }

  const Plan = require("../../src/models/Plan");
  const basePlans = await Plan.find({ key: { $in: subscriptionPlanKeys } }).lean();
  const activePriceIds = [];
  for (const [category, plan] of planByCategory.entries()) {
    const matrix = ADDON_PLAN_DEFINITIONS[category].matrix;
    for (const basePlan of basePlans) {
      const priceHalala = matrix[Number(basePlan.daysCount || basePlan.durationDays)];
      if (!Number.isInteger(priceHalala)) throw new Error(`Missing ${category} add-on matrix for ${basePlan.daysCount || basePlan.durationDays} days`);
      const row = await AddonPlanPrice.findOneAndUpdate(
        { addonPlanId: plan._id, basePlanId: basePlan._id },
        { $set: { priceHalala, currency: SYSTEM_CURRENCY, isActive: true } },
        { upsert: true, new: true, runValidators: true }
      );
      activePriceIds.push(row._id);
    }
  }
  await AddonPlanPrice.updateMany(
    { addonPlanId: { $in: [...planByCategory.values()].map((row) => row._id) }, _id: { $nin: activePriceIds } },
    { $set: { isActive: false } }
  );

  return { addonProductsByCategory, planByCategory, activePriceIds };
}

async function migrateActiveSubscriptionAddonSnapshots({ addonProductsByCategory, planByCategory }) {
  const subscriptions = await Subscription.find({ status: { $in: ["pending_payment", "active", "frozen"] } });
  let changedSubscriptions = 0;
  let changedEntitlements = 0;

  for (const subscription of subscriptions) {
    const addonSubscriptions = clone(subscription.addonSubscriptions || []);
    const addonBalance = clone(subscription.addonBalance || []);
    let changed = false;

    for (const entitlement of addonSubscriptions) {
      const category = normalizeCategory(entitlement.category || entitlement.allowanceCategory || entitlement.displayKey);
      const plan = planByCategory.get(category);
      const products = addonProductsByCategory.get(category);
      if (!plan || !products) continue;
      entitlement.addonId = plan._id;
      entitlement.addonPlanId = plan._id;
      entitlement.displayKey = category;
      entitlement.menuProductIds = products.map((product) => product._id);
      entitlement.menuCategoryKeys = ADDON_PLAN_DEFINITIONS[category].menuCategoryKeys;
      entitlement.menuProductsSnapshot = products.map((product) => {
        const sourceRow = source.products.find((row) => row.key === product.key);
        return menuProductSnapshot(product, sourceRow?.categoryKey || category);
      });
      changed = true;
      changedEntitlements += 1;
    }

    for (const balance of addonBalance) {
      const category = normalizeCategory(balance.category || balance.allowanceCategory || balance.displayKey);
      const plan = planByCategory.get(category);
      if (!plan) continue;
      balance.addonId = plan._id;
      balance.addonPlanId = plan._id;
      balance.displayKey = category;
      changed = true;
    }

    if (changed) {
      await Subscription.updateOne(
        { _id: subscription._id },
        { $set: { addonSubscriptions, addonBalance } }
      );
      changedSubscriptions += 1;
    }
  }
  return { changedSubscriptions, changedEntitlements };
}

async function verifyWorkbookProductionImport() {
  const expected = buildExpectedKeys();
  const Plan = require("../../src/models/Plan");
  const [
    liveCategories,
    workbookProducts,
    liveWorkbookProducts,
    candidateProducts,
    basicMeal,
    groups,
    liveOptions,
    liveGroupRelations,
    liveOptionRelations,
    activePlans,
    addonPlans,
    addonItems,
    matrixRows,
    premiumConfigs,
    publishedBuilder,
    sourceSnapshot,
  ] = await Promise.all([
    MenuCategory.find({ isActive: true, isVisible: true, isAvailable: true, publishedAt: { $ne: null } }).lean(),
    MenuProduct.find({ key: { $in: [...expected.workbookProductKeys] } }).lean(),
    MenuProduct.find({ key: { $in: [...expected.workbookProductKeys] }, isActive: true, isVisible: true, isAvailable: true, publishedAt: { $ne: null } }).lean(),
    MenuProduct.find({ key: { $in: [...expected.candidateProductKeys] } }).lean(),
    MenuProduct.findOne({ key: "basic_meal" }).lean(),
    MenuOptionGroup.find({ key: { $in: ["proteins", "carbs"] }, isActive: true, isVisible: true, isAvailable: true, publishedAt: { $ne: null } }).lean(),
    MenuOption.find({ key: { $in: [...expected.optionKeys] }, isActive: true, isVisible: true, isAvailable: true, publishedAt: { $ne: null } }).lean(),
    ProductOptionGroup.find({ isActive: true, isVisible: true, isAvailable: true }).lean(),
    ProductGroupOption.find({ isActive: true, isVisible: true, isAvailable: true }).lean(),
    Plan.find({ key: { $in: subscriptionPlanKeys }, isActive: true }).lean(),
    Addon.find({ kind: "plan", category: { $in: Object.keys(ADDON_PLAN_DEFINITIONS) }, isActive: true, isArchived: false }).lean(),
    Addon.find({ kind: "item", isActive: true, isArchived: false }).lean(),
    AddonPlanPrice.find({ isActive: true }).lean(),
    PremiumUpgradeConfig.find({ premiumKey: { $in: PREMIUM_PRODUCT_DEFINITIONS.map((row) => row.optionKey) }, status: "active", isEnabled: true, isVisible: true }).lean(),
    MealBuilderConfig.findOne({ status: "published", isCurrent: true, bootstrapKey: MEAL_BUILDER_KEY }).lean(),
    Setting.findOne({ key: SOURCE_SNAPSHOT_KEY }).lean(),
  ]);

  const expectedLiveProductCount = source.products.filter((row) => !READY_BUILDER_BLOCKED_STATUSES.has(String(row.status || ""))).length;
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(liveCategories.length === source.categories.length, `Expected ${source.categories.length} live categories, found ${liveCategories.length}`);
  check(liveCategories.every((row) => expected.categoryKeys.has(row.key)), "Live categories include rows outside the workbook");
  check(workbookProducts.length === source.products.length, `Expected ${source.products.length} workbook products, found ${workbookProducts.length}`);
  check(liveWorkbookProducts.length === expectedLiveProductCount, `Expected ${expectedLiveProductCount} live workbook products, found ${liveWorkbookProducts.length}`);
  check(candidateProducts.length === source.productCandidates.length, `Expected ${source.productCandidates.length} draft candidates, found ${candidateProducts.length}`);
  check(candidateProducts.every((row) => !row.isActive && !row.isVisible && !row.isAvailable && !row.publishedAt), "Workbook candidates must remain draft");
  check(Boolean(basicMeal && basicMeal.isActive && basicMeal.availableFor?.includes("subscription") && !basicMeal.availableFor?.includes("one_time")), "basic_meal technical subscription product is not ready");
  check(groups.length === 2, `Expected two canonical builder groups, found ${groups.length}`);
  check(liveOptions.length === expected.optionRows.length, `Expected ${expected.optionRows.length} live builder options, found ${liveOptions.length}`);
  check(liveGroupRelations.length === 2, `Expected two live product-group relations, found ${liveGroupRelations.length}`);
  check(liveOptionRelations.length === expected.optionRows.length, `Expected ${expected.optionRows.length} live product-option relations, found ${liveOptionRelations.length}`);
  check(activePlans.length === subscriptionPlanKeys.length, `Expected ${subscriptionPlanKeys.length} subscription plans, found ${activePlans.length}`);
  check(addonPlans.length === Object.keys(ADDON_PLAN_DEFINITIONS).length, `Expected three add-on plans, found ${addonPlans.length}`);
  check(addonItems.length === 31, `Expected 31 workbook add-on items, found ${addonItems.length}`);
  check(matrixRows.filter((row) => addonPlans.some((plan) => String(plan._id) === String(row.addonPlanId))).length === 9, "Expected nine active add-on matrix prices");
  check(premiumConfigs.length === PREMIUM_PRODUCT_DEFINITIONS.length, `Expected three premium upgrade configs, found ${premiumConfigs.length}`);
  check(Boolean(publishedBuilder), "Current published workbook Meal Builder config is missing");
  check(Boolean(sourceSnapshot?.value?.metadata?.sha256 === source.metadata.sha256), "Workbook source snapshot is missing or has the wrong hash");

  const liveExtraProducts = await MenuProduct.find({
    key: { $nin: [...expected.productKeys] },
    isActive: true,
    isVisible: true,
    isAvailable: true,
    publishedAt: { $ne: null },
  }).select("key").lean();
  check(liveExtraProducts.length === 0, `Live products outside workbook authority: ${liveExtraProducts.map((row) => row.key).join(", ")}`);

  if (errors.length) {
    const error = new Error(`Workbook production import verification failed: ${errors.join("; ")}`);
    error.code = "WORKBOOK_PRODUCTION_IMPORT_INVALID";
    error.details = errors;
    throw error;
  }

  return {
    sourceSha256: source.metadata.sha256,
    categories: liveCategories.length,
    workbookProducts: workbookProducts.length,
    liveWorkbookProducts: liveWorkbookProducts.length,
    draftWorkbookProducts: workbookProducts.length - liveWorkbookProducts.length,
    candidates: candidateProducts.length,
    builderOptions: liveOptions.length,
    subscriptionPlans: activePlans.length,
    addonPlans: addonPlans.length,
    addonItems: addonItems.length,
    addonMatrixPrices: 9,
    premiumConfigs: premiumConfigs.length,
    mealBuilderSections: publishedBuilder.sections?.length || 0,
  };
}

async function executeImport({ attemptId, log = console } = {}) {
  const now = new Date();
  await heartbeat(attemptId, "store_source_snapshot");
  await storeSourceSnapshot();

  await heartbeat(attemptId, "seed_categories");
  const categoryByKey = await seedCategories(now);

  await heartbeat(attemptId, "seed_products");
  const { productByKey, basicMeal } = await seedProducts(categoryByKey, now);

  await heartbeat(attemptId, "seed_builder_catalog");
  const builder = await seedBuilderCatalog({ basicMeal, now });

  await heartbeat(attemptId, "seed_premium_configs");
  await seedPremiumConfigs({ basicMeal, proteins: builder.proteins, optionByKey: builder.optionByKey });

  await heartbeat(attemptId, "seed_subscription_plans");
  await seedSubscriptionPlans({ sync: true, cleanupFlatPlans: false, log });

  await heartbeat(attemptId, "seed_subscription_addons");
  const addons = await seedSubscriptionAddons({ productByKey });

  await heartbeat(attemptId, "migrate_subscription_addon_snapshots");
  const migratedSubscriptions = await migrateActiveSubscriptionAddonSnapshots(addons);

  await heartbeat(attemptId, "seed_meal_builder_config");
  const mealBuilder = await seedMealBuilderConfig({
    basicMeal,
    proteins: builder.proteins,
    carbs: builder.carbs,
    optionRows: builder.optionRows,
    optionByKey: builder.optionByKey,
    productByKey,
  });

  await heartbeat(attemptId, "publish_one_time_menu");
  await publishMenu({ notes: `Workbook production import ${source.metadata.sha256}` });

  await heartbeat(attemptId, "verify");
  const verification = await verifyWorkbookProductionImport();
  return { verification, migratedSubscriptions, mealBuilderReadiness: mealBuilder.readiness };
}

async function runWorkbookProductionImport({ log = console, connect = false } = {}) {
  let connectedHere = false;
  if (connect && mongoose.connection.readyState === 0) {
    await mongoose.connect(resolveMongoUri(), { serverSelectionTimeoutMS: 10000 });
    connectedHere = true;
  }
  try {
    const lock = await acquireImportLock({ log });
    if (!lock.acquired) {
      return { skipped: true, marker: lock.marker };
    }
    try {
      logLine(log, "log", `[workbook-production-import] starting source=${source.metadata.sha256}`);
      const result = await executeImport({ attemptId: lock.attemptId, log });
      await updateMarker({
        status: "completed",
        attemptId: lock.attemptId,
        phase: "completed",
        startedAt: (await readMarker())?.startedAt || nowIso(),
        completedAt: nowIso(),
        summary: result.verification,
        migratedSubscriptions: result.migratedSubscriptions,
      });
      logLine(log, "log", "[workbook-production-import] completed", result.verification);
      return { skipped: false, ...result };
    } catch (error) {
      await updateMarker({
        status: "failed",
        attemptId: lock.attemptId,
        phase: "failed",
        failedAt: nowIso(),
        error: { code: error.code || "WORKBOOK_PRODUCTION_IMPORT_FAILED", message: error.message },
      }).catch(() => {});
      throw error;
    }
  } finally {
    if (connectedHere && mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

function shouldRunOnStartup(env = process.env) {
  if (["1", "true", "yes"].includes(String(env.WORKBOOK_PRODUCTION_IMPORT_DISABLED || "").toLowerCase())) return false;
  if (["1", "true", "yes"].includes(String(env.RUN_WORKBOOK_PRODUCTION_IMPORT_ON_STARTUP || "").toLowerCase())) return true;
  return String(env.NODE_ENV || "").toLowerCase() === "production"
    || Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID || env.RAILWAY_PROJECT_ID);
}

async function runWorkbookProductionImportOnStartup({ log = console } = {}) {
  if (!shouldRunOnStartup()) return { skipped: true, reason: "startup_policy" };
  return runWorkbookProductionImport({ log, connect: false });
}

async function main() {
  await runWorkbookProductionImport({ log: console, connect: true });
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[workbook-production-import] ${error.code ? `${error.code}: ` : ""}${error.message}`);
    if (Array.isArray(error.details)) console.error(JSON.stringify(error.details, null, 2));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = {
  ADDON_PLAN_DEFINITIONS,
  IMPORT_KEY,
  MEAL_BUILDER_KEY,
  PREMIUM_PRODUCT_DEFINITIONS,
  SOURCE_SNAPSHOT_KEY,
  buildCanonicalBuilderRows,
  buildExpectedKeys,
  productRuntimeState,
  runWorkbookProductionImport,
  runWorkbookProductionImportOnStartup,
  shouldRunOnStartup,
  verifyWorkbookProductionImport,
};

const mongoose = require("mongoose");
const Plan = require("../models/Plan");
const Addon = require("../models/Addon");
const BuilderProtein = require("../models/BuilderProtein");
const BuilderCarb = require("../models/BuilderCarb");
const SaladIngredient = require("../models/SaladIngredient");
const MenuCategory = require("../models/MenuCategory");
const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const ProductGroupOption = require("../models/ProductGroupOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const catalogHealthService = require("./catalogHealthService");
const {
  SUBSCRIPTION_ADDON_CHOICE_MAPPINGS,
} = require("./subscription/subscriptionAddonChoicesService");
const {
  MEAL_SELECTION_TYPES,
  PREMIUM_MEAL_PROTEIN_KEYS,
  SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS,
} = require("../config/mealPlannerContract");
const {
  isLinkedDocGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("./catalog/catalogAvailabilityService");
const {
  isSubscriptionPremiumLargeSaladProtein,
} = require("./subscription/premiumLargeSaladEligibilityService");

function countBy(rows, selector) {
  return (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    const key = selector(row) || "(missing)";
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
}

function pickName(name) {
  if (!name || typeof name !== "object") return "";
  return String(name.en || name.ar || "").trim();
}

function activePublishedIssue(doc, codePrefix, id) {
  if (!doc) return `${codePrefix}_NOT_FOUND`;
  if (doc.isActive === false) return `${codePrefix}_INACTIVE`;
  if (doc.isVisible === false || doc.isAvailable === false) return `${codePrefix}_UNAVAILABLE`;
  if (doc.publishedAt === null || doc.publishedAt === undefined) return `${codePrefix}_UNPUBLISHED`;
  return null;
}

function addCheck(collection, level, code, message, details = {}) {
  const row = {
    level,
    code,
    message,
    ...details,
  };
  collection.push(row);
  return row;
}

function isSubscriptionEnabled(doc) {
  if (!doc) return false;
  if (doc.availableForSubscription === false) return false;
  if (!Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes("subscription");
}

function isOneTimeEnabled(doc) {
  if (!doc) return false;
  if (!Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes("one_time");
}

function proteinIdentity(option) {
  return String(option?.key || option?.premiumKey || "").trim().toLowerCase();
}

async function getCatalogHealthReport() {
  const [planCatalog, subscriptionIntegrity] = await Promise.all([
    catalogHealthService.checkPlanCatalogHealth(),
    catalogHealthService.auditSubscriptionIntegrity(),
  ]);
  return { planCatalog, subscriptionIntegrity };
}

async function getSubscriptionMenuHealthReport() {
  const [plans, addons] = await Promise.all([
    Plan.find({}).select("name isActive gramsOptions sortOrder").sort({ sortOrder: 1, createdAt: -1 }).lean(),
    Addon.find({}).select("name kind category billingMode isActive sortOrder").sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);

  const activePlans = plans.filter((plan) => plan.isActive !== false);
  const checkoutAddonPlans = addons.filter((addon) => addon.isActive !== false && addon.kind === "plan" && addon.billingMode === "per_day");
  const mealPlannerItems = addons.filter((addon) => addon.isActive !== false && addon.kind === "item" && addon.billingMode === "flat_once");
  const anomalies = [];

  for (const plan of activePlans) {
    if (!Plan.isViable(plan)) {
      anomalies.push({
        type: "NON_VIABLE_ACTIVE_PLAN",
        id: String(plan._id),
        name: plan.name,
      });
    }
  }

  for (const addon of addons) {
    if (!addon.kind || !addon.category || !addon.billingMode) {
      anomalies.push({
        type: "ADDON_MISSING_MENU_FIELDS",
        id: String(addon._id),
        name: addon.name,
        kind: addon.kind || null,
        category: addon.category || null,
        billingMode: addon.billingMode || null,
      });
    }
    if (addon.kind === "plan" && !["per_day", "per_meal"].includes(addon.billingMode)) {
      anomalies.push({ type: "ADDON_PLAN_INVALID_BILLING_MODE", id: String(addon._id), billingMode: addon.billingMode });
    }
    if (addon.kind === "item" && addon.billingMode !== "flat_once") {
      anomalies.push({ type: "ADDON_ITEM_INVALID_BILLING_MODE", id: String(addon._id), billingMode: addon.billingMode });
    }
  }

  return {
    counts: {
      plans: plans.length,
      activePlans: activePlans.length,
      addons: addons.length,
      checkoutAddonPlans: checkoutAddonPlans.length,
      mealPlannerAddonItems: mealPlannerItems.length,
    },
    addonsByKind: countBy(addons, (addon) => addon.kind),
    addonsByCategory: countBy(addons, (addon) => addon.category),
    checkoutAddonPlans: checkoutAddonPlans.map((addon) => ({
      id: String(addon._id),
      name: pickName(addon.name),
      category: addon.category,
      billingMode: addon.billingMode,
      isActive: addon.isActive !== false,
    })),
    anomalies,
  };
}

async function getMealPlannerHealthReport() {
  const [proteins, carbs, saladIngredients, addons] = await Promise.all([
    BuilderProtein.find({}).select("key premiumKey name isActive isPremium availableForSubscription displayCategoryKey proteinFamilyKey sortOrder").lean(),
    BuilderCarb.find({}).select("key name isActive availableForSubscription displayCategoryKey sortOrder").lean(),
    SaladIngredient.find({}).select("name groupKey isActive sortOrder").lean(),
    Addon.find({ kind: "item" }).select("name kind category billingMode isActive sortOrder").lean(),
  ]);

  const anomalies = [];
  for (const protein of proteins) {
    if (protein.isPremium && !protein.premiumKey) {
      anomalies.push({ type: "PREMIUM_PROTEIN_MISSING_PREMIUM_KEY", id: String(protein._id), name: protein.name });
    }
    if (!protein.displayCategoryKey || !protein.proteinFamilyKey) {
      anomalies.push({ type: "PROTEIN_MISSING_CATEGORY_OR_FAMILY", id: String(protein._id), name: protein.name });
    }
  }
  for (const carb of carbs) {
    if (!carb.displayCategoryKey) {
      anomalies.push({ type: "CARB_MISSING_DISPLAY_CATEGORY", id: String(carb._id), name: carb.name });
    }
  }
  for (const ingredient of saladIngredients) {
    if (!ingredient.groupKey) {
      anomalies.push({ type: "SALAD_INGREDIENT_MISSING_GROUP", id: String(ingredient._id), name: ingredient.name });
    }
  }
  for (const addon of addons) {
    if (addon.billingMode !== "flat_once") {
      anomalies.push({ type: "MEAL_PLANNER_ADDON_INVALID_BILLING_MODE", id: String(addon._id), billingMode: addon.billingMode });
    }
  }

  const legacyBuilderSummary = {
    counts: {
      proteins: proteins.length,
      activeProteins: proteins.filter((row) => row.isActive !== false).length,
      premiumProteins: proteins.filter((row) => row.isPremium === true).length,
      carbs: carbs.length,
      activeCarbs: carbs.filter((row) => row.isActive !== false).length,
      saladIngredients: saladIngredients.length,
      addonItems: addons.length,
    },
    proteinsByFamily: countBy(proteins, (row) => row.proteinFamilyKey),
    carbsByDisplayCategory: countBy(carbs, (row) => row.displayCategoryKey),
    saladIngredientsByGroup: countBy(saladIngredients, (row) => row.groupKey),
    anomalies,
  };

  const readiness = await getSubscriptionPlannerReadinessReport();
  return {
    ...readiness,
    legacyBuilderSummary,
  };
}

async function getSubscriptionPlannerReadinessReport() {
  const errors = [];
  const warnings = [];
  const checks = [];
  const requiredProductKeys = ["basic_meal", "premium_large_salad"];
  const requiredGroupKeys = ["proteins", "carbs"];
  const premiumProteinKeySet = new Set(PREMIUM_MEAL_PROTEIN_KEYS);
  const saladExcludedGroupKeySet = new Set(SUBSCRIPTION_PREMIUM_LARGE_SALAD_EXCLUDED_GROUP_KEYS);

  const [products, groups, categories] = await Promise.all([
    MenuProduct.find({}).lean(),
    MenuOptionGroup.find({}).lean(),
    MenuCategory.find({}).lean(),
  ]);
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  const productsByKey = new Map(products.map((product) => [String(product.key || ""), product]));
  const groupsByKey = new Map(groups.map((group) => [String(group.key || ""), group]));
  const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
  const requiredProducts = requiredProductKeys.map((key) => productsByKey.get(key)).filter(Boolean);

  for (const key of requiredProductKeys) {
    const product = productsByKey.get(key);
    const issue = activePublishedIssue(product, "PLANNER_PRODUCT", product?._id);
    if (issue) addCheck(errors, "error", issue, `Required subscription planner product ${key} is not ready`, { productKey: key, productId: product?._id ? String(product._id) : null });
    else if (!isSubscriptionEnabled(product)) addCheck(errors, "error", "PLANNER_PRODUCT_NOT_SUBSCRIPTION_ENABLED", `Required product ${key} is not subscription-enabled`, { productKey: key, productId: String(product._id) });
    else if (!isLinkedDocGloballyAvailable(product, catalogItemsById)) addCheck(errors, "error", "PLANNER_PRODUCT_CATALOG_ITEM_UNAVAILABLE", `Required product ${key} has an unavailable linked CatalogItem`, { productKey: key, productId: String(product._id) });
    else addCheck(checks, "ok", "PLANNER_PRODUCT_READY", `Required product ${key} is ready`, { productKey: key, productId: String(product._id) });
  }

  for (const key of requiredGroupKeys) {
    const group = groupsByKey.get(key);
    const issue = activePublishedIssue(group, "PLANNER_OPTION_GROUP", group?._id);
    if (issue) addCheck(errors, "error", issue, `Required option group ${key} is not ready`, { groupKey: key, groupId: group?._id ? String(group._id) : null });
    else addCheck(checks, "ok", "PLANNER_OPTION_GROUP_READY", `Required option group ${key} is ready`, { groupKey: key, groupId: String(group._id) });
  }

  const productIds = requiredProducts.map((product) => product._id);
  const groupRelations = await ProductOptionGroup.find({ productId: { $in: productIds } }).lean();
  const optionRelations = await ProductGroupOption.find({ productId: { $in: productIds } }).lean();
  const optionIds = optionRelations.map((relation) => relation.optionId);
  const options = await MenuOption.find({ _id: { $in: optionIds } }).lean();
  const optionCatalogItemsById = await loadCatalogItemsByIdForDocs(options);
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const groupRelationsByProductGroup = new Map(groupRelations.map((relation) => [`${String(relation.productId)}:${String(relation.groupId)}`, relation]));

  for (const product of requiredProducts) {
    const productKey = String(product.key || "");
    const productGroupRelations = groupRelations.filter((relation) => String(relation.productId) === String(product._id));
    if (!productGroupRelations.length) {
      addCheck(errors, "error", "PLANNER_PRODUCT_GROUP_RELATION_NOT_FOUND", `Product ${productKey} has no option-group relations`, { productKey, productId: String(product._id) });
    }
    for (const relation of productGroupRelations) {
      const group = groupsById.get(String(relation.groupId));
      const groupKey = String(group?.key || "");
      if (relation.isActive === false || relation.isVisible === false || relation.isAvailable === false) {
        addCheck(errors, "error", "PLANNER_PRODUCT_GROUP_RELATION_UNAVAILABLE", `Product ${productKey} group relation ${groupKey || relation.groupId} is unavailable`, { productKey, productId: String(product._id), groupId: String(relation.groupId), groupKey });
      }
    }
    const productOptionRelations = optionRelations.filter((relation) => String(relation.productId) === String(product._id));
    if (!productOptionRelations.length) {
      addCheck(errors, "error", "PLANNER_PRODUCT_OPTION_RELATION_NOT_FOUND", `Product ${productKey} has no option relations`, { productKey, productId: String(product._id) });
    }
    for (const relation of productOptionRelations) {
      const option = optionsById.get(String(relation.optionId));
      const group = groupsById.get(String(relation.groupId));
      const groupKey = String(group?.key || "");
      const key = proteinIdentity(option);
      const groupRelation = groupRelationsByProductGroup.get(`${String(product._id)}:${String(relation.groupId)}`);
      const optionIssue = activePublishedIssue(option, "PLANNER_OPTION", relation.optionId);
      if (!groupRelation) addCheck(errors, "error", "PLANNER_PRODUCT_GROUP_RELATION_NOT_FOUND", `Product ${productKey} option relation references a missing group relation`, { productKey, groupId: String(relation.groupId), optionId: String(relation.optionId) });
      if (optionIssue) addCheck(errors, "error", optionIssue, `Product ${productKey} option ${key || relation.optionId} is not ready`, { productKey, groupKey, optionKey: key, optionId: String(relation.optionId) });
      else if (!isSubscriptionEnabled(option) && ["basic_meal", "premium_large_salad"].includes(productKey)) addCheck(errors, "error", "PLANNER_OPTION_UNAVAILABLE", `Option ${key} is not subscription-enabled`, { productKey, groupKey, optionKey: key, optionId: String(option._id) });
      else if (!isLinkedDocGloballyAvailable(option, optionCatalogItemsById)) addCheck(errors, "error", "PLANNER_OPTION_CATALOG_ITEM_UNAVAILABLE", `Option ${key} has an unavailable linked CatalogItem`, { productKey, groupKey, optionKey: key, optionId: String(option._id) });
      if (relation.isActive === false || relation.isVisible === false || relation.isAvailable === false) {
        addCheck(errors, "error", "PLANNER_PRODUCT_OPTION_RELATION_UNAVAILABLE", `Product ${productKey} option relation ${key || relation.optionId} is unavailable`, { productKey, groupKey, optionKey: key, optionId: String(relation.optionId) });
      }
      if (productKey === "basic_meal" && groupKey === "proteins" && premiumProteinKeySet.has(key)) {
        addCheck(warnings, "warning", "STANDARD_PRODUCT_EXPOSES_PREMIUM_PROTEIN", `Standard product ${productKey} exposes premium protein ${key}`, { productKey, optionKey: key, optionId: String(relation.optionId) });
      }
      if (productKey === "premium_large_salad" && saladExcludedGroupKeySet.has(groupKey)) {
        addCheck(errors, "error", "PREMIUM_LARGE_SALAD_EXTRA_PROTEIN_EXPOSED", "Premium large salad exposes extra_protein_50g", { productKey, groupKey, optionKey: key, optionId: String(relation.optionId) });
      }
      if (productKey === "premium_large_salad" && groupKey === "proteins" && !isSubscriptionPremiumLargeSaladProtein(option)) {
        addCheck(errors, "error", "PREMIUM_LARGE_SALAD_PROTEIN_NOT_ALLOWED", `Premium large salad exposes disallowed protein ${key}`, { productKey, optionKey: key, optionId: String(relation.optionId) });
      }
    }
  }

  for (const [addonCategory, mapping] of Object.entries(SUBSCRIPTION_ADDON_CHOICE_MAPPINGS)) {
    const sourceCategories = categories.filter((category) => mapping.sourceCategories.includes(category.key));
    if (!sourceCategories.length) {
      addCheck(warnings, "warning", "ADDON_SOURCE_CATEGORY_NOT_FOUND", `Daily add-on category ${addonCategory} has no mapped menu category`, { addonCategory, sourceCategories: [...mapping.sourceCategories] });
      continue;
    }
    for (const category of sourceCategories) {
      const categoryIssue = activePublishedIssue(category, "ADDON_SOURCE_CATEGORY", category._id);
      if (categoryIssue) addCheck(errors, "error", categoryIssue, `Daily add-on source category ${category.key} is not ready`, { addonCategory, categoryKey: category.key, categoryId: String(category._id) });
    }
    const addonProducts = products.filter((product) => sourceCategories.some((category) => String(category._id) === String(product.categoryId)));
    const eligibleProducts = addonProducts.filter((product) => {
      if (Array.isArray(mapping.productKeys) && mapping.productKeys.length && !mapping.productKeys.includes(product.key)) return false;
      return true;
    });
    if (!eligibleProducts.length) {
      addCheck(warnings, "warning", "ADDON_PRODUCT_NOT_FOUND", `Daily add-on category ${addonCategory} has no mapped products`, { addonCategory });
      continue;
    }
    for (const product of eligibleProducts) {
      const productIssue = activePublishedIssue(product, "ADDON_PRODUCT", product._id);
      const category = categoriesById.get(String(product.categoryId));
      if (productIssue) addCheck(errors, "error", productIssue, `Daily add-on product ${product.key} is not ready`, { addonCategory, productKey: product.key, productId: String(product._id) });
      else if (!isOneTimeEnabled(product)) addCheck(errors, "error", "ADDON_PRODUCT_NOT_ONE_TIME_ENABLED", `Daily add-on product ${product.key} is not one-time enabled`, { addonCategory, productKey: product.key, productId: String(product._id) });
      else if (!category || !mapping.sourceCategories.includes(category.key)) addCheck(errors, "error", "ADDON_PRODUCT_CATEGORY_NOT_MAPPED", `Daily add-on product ${product.key} is not category-mapped`, { addonCategory, productKey: product.key, productId: String(product._id) });
      else addCheck(checks, "ok", "ADDON_PRODUCT_READY", `Daily add-on product ${product.key} is ready`, { addonCategory, productKey: product.key, productId: String(product._id) });
    }
  }

  checks.push(...errors, ...warnings);
  const status = errors.length ? "error" : warnings.length ? "warning" : "ok";
  return {
    status,
    ready: errors.length === 0,
    errors,
    warnings,
    checks,
    summary: {
      requiredProducts: requiredProductKeys.length,
      requiredGroups: requiredGroupKeys.length,
      productGroupRelations: groupRelations.length,
      productOptionRelations: optionRelations.length,
      errors: errors.length,
      warnings: warnings.length,
      premiumLargeSalad: productsByKey.has("premium_large_salad") ? "configured" : "missing",
      route: "/api/dashboard/health/meal-planner",
    },
  };
}

async function getIndexesHealthReport() {
  const expected = {
    payments: ["provider_1_providerInvoiceId_1", "provider_1_providerPaymentId_1", "operationIdempotencyKey_1"],
    users: ["email_1_unique_sparse"],
    addons: ["kind_1_category_1_isActive_1", "isActive_1_sortOrder_1"],
    builderproteins: ["key_1", "premiumKey_1"],
  };

  const collections = Object.keys(expected);
  const report = {};
  for (const collectionName of collections) {
    let indexes = [];
    try {
      const collection = mongoose.connection.db.collection(collectionName);
      indexes = await collection.indexes();
    } catch (_err) {
      indexes = [];
    }
    const indexNames = indexes.map((index) => index.name);
    report[collectionName] = {
      expected: expected[collectionName],
      present: indexNames,
      missing: expected[collectionName].filter((name) => !indexNames.includes(name)),
    };
  }
  return report;
}

module.exports = {
  getCatalogHealthReport,
  getSubscriptionMenuHealthReport,
  getMealPlannerHealthReport,
  getSubscriptionPlannerReadinessReport,
  getIndexesHealthReport,
};

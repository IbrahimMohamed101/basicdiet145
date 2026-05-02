const mongoose = require("mongoose");
const Plan = require("../models/Plan");
const Addon = require("../models/Addon");
const BuilderProtein = require("../models/BuilderProtein");
const BuilderCarb = require("../models/BuilderCarb");
const SaladIngredient = require("../models/SaladIngredient");
const catalogHealthService = require("./catalogHealthService");

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

  return {
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
  getIndexesHealthReport,
};

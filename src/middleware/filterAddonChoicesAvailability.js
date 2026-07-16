const Addon = require("../models/Addon");
const MenuCategory = require("../models/MenuCategory");
const MenuProduct = require("../models/MenuProduct");
const { getRequestLang } = require("../utils/i18n");
const {
  filterGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../services/catalog/catalogAvailabilityService");
const {
  isDailyAddonMenuProduct,
  resolveDisplayCategoryForProduct,
  serializeChoice,
} = require("../services/subscription/subscriptionAddonChoicesService");
const {
  availableForChannelQuery,
} = require("../services/subscription/subscriptionMenuEligibilityPolicyService");

const LEGACY_GENERIC_CATEGORIES = new Set(["juice", "snack", "small_salad"]);

function planIdOf(value) {
  if (!value) return "";
  if (value.addonPlanId) return String(value.addonPlanId).trim();
  // Authoritative choice rows use addonId as the selected MenuProduct ID.
  // Falling back to it as though it were a dashboard plan ID incorrectly
  // removes visible paid extras from the merged 4-owned/5-catalog response.
  if (value.productId || value.menuProductId || value.type === "menu_product") return "";
  return String(value.addonId || "").trim();
}

function localizedPlanName(plan) {
  if (!plan || !plan.name) return "";
  if (typeof plan.name === "string") return plan.name;
  return String(plan.name.ar || plan.name.en || "");
}

function customerVisibleQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    isArchived: { $ne: true },
    archivedAt: null,
    isDeleted: { $ne: true },
    deletedAt: null,
    publishedAt: { $ne: null },
    ...extra,
  };
}

function filterAddonChoicesPayload(payload, activePlanIds) {
  if (!payload || payload.status !== true || !payload.data || typeof payload.data !== "object") {
    return payload;
  }

  const filteredData = {};

  for (const [category, rawGroup] of Object.entries(payload.data)) {
    if (!rawGroup || typeof rawGroup !== "object") continue;

    const originalEntitlements = Array.isArray(rawGroup.entitlements) ? rawGroup.entitlements : [];
    const originalChoices = Array.isArray(rawGroup.choices) ? rawGroup.choices : [];
    const referencedPlanIds = new Set([
      ...originalEntitlements.map(planIdOf),
      ...originalChoices.map(planIdOf),
    ].filter(Boolean));

    // Purchased entitlement rows are immutable snapshots. Archiving the live
    // dashboard plan must stop new sales, but it must not remove an already-paid
    // customer's remaining choices or balance.
    const entitlements = originalEntitlements;

    const choices = originalChoices.filter((row) => {
      if (row && row.source === "subscription" && row.ownedSnapshot === true) return true;
      const planId = planIdOf(row);
      if (!planId || activePlanIds.has(planId)) return true;
      return row && (
        row.isEligibleForAllowance === true
        || row.entitlementIndex !== undefined
        || Boolean(row.entitlementKey)
      );
    });

    const hasActiveReferencedPlan = [...referencedPlanIds].some((planId) => activePlanIds.has(planId));
    const hasPurchasedEntitlement = entitlements.length > 0
      || choices.some((row) => row && (
        row.isEligibleForAllowance === true
        || row.entitlementIndex !== undefined
        || Boolean(row.entitlementKey)
        || (row.source === "subscription" && row.ownedSnapshot === true)
      ));
    const isLegacyGenericCategory = LEGACY_GENERIC_CATEGORIES.has(String(category));

    if (!isLegacyGenericCategory && referencedPlanIds.size > 0 && !hasActiveReferencedPlan && !hasPurchasedEntitlement) {
      continue;
    }

    if (!isLegacyGenericCategory && choices.length === 0 && entitlements.length === 0) {
      continue;
    }

    filteredData[category] = {
      ...rawGroup,
      choices,
      ...(Array.isArray(rawGroup.entitlements) ? { entitlements } : {}),
    };
  }

  return { ...payload, data: filteredData };
}

function mergeActivePlanCatalog(payload, planCatalog, { requestedCategory = "" } = {}) {
  if (!payload || payload.status !== true || !payload.data || typeof payload.data !== "object") {
    return payload;
  }

  const data = { ...payload.data };
  for (const [category, planGroup] of Object.entries(planCatalog || {})) {
    if (requestedCategory && String(category) !== String(requestedCategory)) continue;
    const currentGroup = data[category] && typeof data[category] === "object"
      ? data[category]
      : { category, catalogType: "generic", choices: [] };
    const choices = Array.isArray(currentGroup.choices) ? [...currentGroup.choices] : [];

    for (const planChoice of planGroup.choices || []) {
      const existingIndex = choices.findIndex((choice) => String(choice && choice.id || "") === String(planChoice.id));
      if (existingIndex >= 0) {
        const existing = choices[existingIndex];
        choices[existingIndex] = {
          ...planChoice,
          ...existing,
          addonPlanId: existing.addonPlanId || planChoice.addonPlanId,
          addonPlanName: existing.addonPlanName || planChoice.addonPlanName,
          isEligibleForAllowance: existing.isEligibleForAllowance === true,
        };
      } else {
        choices.push(planChoice);
      }
    }

    data[category] = {
      ...currentGroup,
      category,
      choices,
      activeAddonPlans: planGroup.activeAddonPlans,
    };
  }

  return { ...payload, data };
}

async function buildActivePlanCatalog(activePlans, lang) {
  const productIds = [...new Set(
    activePlans.flatMap((plan) => Array.isArray(plan.menuProductIds) ? plan.menuProductIds.map(String) : [])
  )];
  if (!productIds.length) return {};

  const products = await MenuProduct.find(customerVisibleQuery({
    _id: { $in: productIds },
    ...availableForChannelQuery("one_time"),
  })).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const catalogItemsById = await loadCatalogItemsByIdForDocs(products);
  const usableProducts = filterGloballyAvailable(products, catalogItemsById).filter(isDailyAddonMenuProduct);
  const productsById = new Map(usableProducts.map((product) => [String(product._id), product]));

  const categoryIds = [...new Set(usableProducts.map((product) => String(product.categoryId || "")).filter(Boolean))];
  const categories = categoryIds.length
    ? await MenuCategory.find(customerVisibleQuery({ _id: { $in: categoryIds } })).lean()
    : [];
  const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
  const data = {};

  for (const plan of activePlans) {
    const addonPlanId = String(plan._id);
    for (const productId of Array.isArray(plan.menuProductIds) ? plan.menuProductIds : []) {
      const product = productsById.get(String(productId));
      if (!product) continue;
      const sourceCategory = categoriesById.get(String(product.categoryId));
      if (!sourceCategory) continue;
      const displayCategory = resolveDisplayCategoryForProduct(product, sourceCategory, {
        entitlementCategory: plan.category,
      });
      if (!displayCategory) continue;

      if (!data[displayCategory]) {
        data[displayCategory] = {
          category: displayCategory,
          choices: [],
          activeAddonPlans: [],
        };
      }
      if (!data[displayCategory].activeAddonPlans.some((row) => row.addonPlanId === addonPlanId)) {
        data[displayCategory].activeAddonPlans.push({
          addonPlanId,
          addonPlanName: localizedPlanName(plan),
          entitlementCategory: plan.category || "",
        });
      }
      if (data[displayCategory].choices.some((choice) => String(choice.id) === String(product._id))) continue;

      data[displayCategory].choices.push({
        ...serializeChoice(product, sourceCategory.key, lang),
        category: displayCategory,
        addonPlanId,
        addonPlanName: localizedPlanName(plan),
        entitlementCategory: plan.category || "",
        isEligibleForAllowance: false,
      });
    }
  }

  return data;
}

async function filterAddonChoicesAvailability(req, res, next) {
  try {
    const activePlans = await Addon.find({
      kind: "plan",
      isActive: true,
      isArchived: { $ne: true },
      archivedAt: null,
    }).select({ _id: 1, name: 1, category: 1, menuProductIds: 1, sortOrder: 1 }).sort({ sortOrder: 1, createdAt: -1 }).lean();

    const activePlanIds = new Set(activePlans.map((row) => String(row._id)));
    const activePlanCatalog = await buildActivePlanCatalog(activePlans, getRequestLang(req));
    const originalJson = res.json.bind(res);

    res.json = function filteredJson(payload) {
      const filtered = filterAddonChoicesPayload(payload, activePlanIds);
      const requestedCategory = req.query && req.query.category ? String(req.query.category).trim() : "";
      return originalJson(mergeActivePlanCatalog(filtered, activePlanCatalog, { requestedCategory }));
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  buildActivePlanCatalog,
  filterAddonChoicesAvailability,
  filterAddonChoicesPayload,
  mergeActivePlanCatalog,
};

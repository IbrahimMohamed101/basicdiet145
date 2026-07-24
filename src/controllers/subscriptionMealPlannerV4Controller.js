const menuController = require("./menuController");
const errorResponse = require("../utils/errorResponse");
const {
  PLANNER_CATALOG_V3_VERSION,
  hasFlutterPrimaryMealPickerContent,
  hasSelectablePlannerContent,
  summarizeFlutterPrimaryMealPickerContent,
} = require("../services/catalog/plannerCatalogContentValidator");

const FLUTTER_CONTRACT_VERSION = PLANNER_CATALOG_V3_VERSION;
const BUILDER_CATALOG_V2_VERSION = "meal_planner_menu.v2";
// Default responses intentionally preserve both canonical V3 aliases and the V2
// compatibility catalog; legacy meal/add-on lists remain opt-in only.
const OPTIONAL_ADDON_FIELDS = [
  "addonChoices",
  "addonChoiceGroups",
  "subscriptionId",
  "addonCategoryAllowances",
  "addonSubscriptionAllowances",
];
const LEGACY_COMPATIBILITY_FIELDS = [
  "legacyBuilderCatalog",
  "currency",
  "regularMeals",
  "premiumMeals",
  "addons",
];

function noStore(res) {
  res.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function normalizeBuilderCatalogV2(catalog) {
  return {
    ...catalog,
    sections: (catalog.sections || []).map((section) => {
      const key = String(section?.key || section?.selectionType || "").trim().toLowerCase();
      if (key !== "sandwich") return section;
      return {
        ...section,
        products: (section.products || []).map((product) => ({
          ...product,
          selectionType: "sandwich",
        })),
      };
    }),
  };
}

function sanitizePublicData(source = {}) {
  const plannerCatalog = source.plannerCatalog || source.builderCatalog || null;
  if (!plannerCatalog || plannerCatalog.contractVersion !== FLUTTER_CONTRACT_VERSION) {
    const err = new Error("Meal Planner catalog is not compatible with the current Flutter client");
    err.code = "MEAL_PLANNER_FLUTTER_CONTRACT_INVALID";
    err.status = 500;
    err.details = {
      expectedContractVersion: FLUTTER_CONTRACT_VERSION,
      receivedContractVersion: plannerCatalog?.contractVersion || null,
    };
    throw err;
  }
  if (!hasSelectablePlannerContent(plannerCatalog)) {
    const err = new Error("Meal Planner catalog contains no selectable content");
    err.code = "MEAL_PLANNER_CATALOG_EMPTY";
    err.status = 503;
    err.details = {
      expectedContractVersion: FLUTTER_CONTRACT_VERSION,
      receivedContractVersion: plannerCatalog.contractVersion || null,
      sectionCount: Array.isArray(plannerCatalog.sections) ? plannerCatalog.sections.length : 0,
    };
    throw err;
  }
  if (!hasFlutterPrimaryMealPickerContent(plannerCatalog)) {
    const err = new Error("Meal Planner catalog contains no Flutter primary picker content");
    err.code = "MEAL_PLANNER_PRIMARY_CONTENT_EMPTY";
    err.status = 503;
    err.details = summarizeFlutterPrimaryMealPickerContent(plannerCatalog);
    throw err;
  }

  const rawBuilderCatalogV2 = source.builderCatalogV2 || null;
  if (!rawBuilderCatalogV2 || rawBuilderCatalogV2.catalogVersion !== BUILDER_CATALOG_V2_VERSION) {
    const err = new Error("Meal Planner V2 compatibility catalog is unavailable");
    err.code = "MEAL_PLANNER_BUILDER_V2_CONTRACT_INVALID";
    err.status = 500;
    err.details = {
      expectedCatalogVersion: BUILDER_CATALOG_V2_VERSION,
      receivedCatalogVersion: rawBuilderCatalogV2?.catalogVersion || null,
    };
    throw err;
  }
  const builderCatalogV2 = normalizeBuilderCatalogV2(rawBuilderCatalogV2);

  const data = {
    builderCatalog: plannerCatalog,
    addonCatalog: source.addonCatalog || {
      items: [],
      byCategory: {},
      totalCount: 0,
      entitlementResolved: false,
      source: "empty_catalog",
    },
    builderCatalogV2,
    plannerCatalog,
  };

  for (const field of OPTIONAL_ADDON_FIELDS) {
    if (source[field] !== undefined) data[field] = source[field];
  }
  for (const field of LEGACY_COMPATIBILITY_FIELDS) {
    if (source[field] !== undefined) data[field] = source[field];
  }

  return data;
}

async function getMealPlannerMenu(req, res) {
  try {
    let statusCode = 200;
    const proxy = {
      status(code) {
        statusCode = code;
        return proxy;
      },
      set() {
        return proxy;
      },
      json(payload) {
        if (!payload || payload.status !== true || !payload.data) {
          noStore(res);
          return res.status(statusCode).json(payload);
        }

        const data = sanitizePublicData(payload.data);
        noStore(res);
        const catalogHash = data.plannerCatalog.catalogHash;
        if (catalogHash) {
          res.set("ETag", `"${catalogHash}"`);
          res.set("X-Meal-Planner-Catalog-Hash", catalogHash);
        }
        return res.status(statusCode).json({ status: true, data });
      },
    };

    return await menuController.getSubscriptionMealPlannerMenu(req, proxy);
  } catch (err) {
    noStore(res);
    if (err?.status && err?.code) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    console.error("SubscriptionMealPlannerCompatibilityController error:", err);
    return errorResponse(res, 500, "MEAL_PLANNER_INTERNAL_ERROR", "Unable to build Meal Planner catalog");
  }
}

module.exports = {
  getMealPlannerMenu,
  normalizeBuilderCatalogV2,
  sanitizePublicData,
};

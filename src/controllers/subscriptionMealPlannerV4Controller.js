const menuController = require("./menuController");
const errorResponse = require("../utils/errorResponse");
const {
  PLANNER_CATALOG_V3_VERSION,
  hasFlutterPrimaryMealPickerContent,
  hasSelectablePlannerContent,
  summarizeFlutterPrimaryMealPickerContent,
} = require("../services/catalog/plannerCatalogContentValidator");

const FLUTTER_CONTRACT_VERSION = PLANNER_CATALOG_V3_VERSION;
const OPTIONAL_ADDON_FIELDS = [
  "addonChoices",
  "addonChoiceGroups",
  "subscriptionId",
  "addonCategoryAllowances",
  "addonSubscriptionAllowances",
];

function noStore(res) {
  res.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
}

function sanitizePublicData(source = {}) {
  const builderCatalog = source.builderCatalog || source.plannerCatalog || null;
  if (!builderCatalog || builderCatalog.contractVersion !== FLUTTER_CONTRACT_VERSION) {
    const err = new Error("Meal Planner catalog is not compatible with the current Flutter client");
    err.code = "MEAL_PLANNER_FLUTTER_CONTRACT_INVALID";
    err.status = 500;
    err.details = {
      expectedContractVersion: FLUTTER_CONTRACT_VERSION,
      receivedContractVersion: builderCatalog?.contractVersion || null,
    };
    throw err;
  }
  if (!hasSelectablePlannerContent(builderCatalog)) {
    const err = new Error("Meal Planner catalog contains no selectable content");
    err.code = "MEAL_PLANNER_CATALOG_EMPTY";
    err.status = 503;
    err.details = {
      expectedContractVersion: FLUTTER_CONTRACT_VERSION,
      receivedContractVersion: builderCatalog.contractVersion || null,
      sectionCount: Array.isArray(builderCatalog.sections) ? builderCatalog.sections.length : 0,
    };
    throw err;
  }
  if (!hasFlutterPrimaryMealPickerContent(builderCatalog)) {
    const err = new Error("Meal Planner catalog contains no Flutter primary picker content");
    err.code = "MEAL_PLANNER_PRIMARY_CONTENT_EMPTY";
    err.status = 503;
    err.details = summarizeFlutterPrimaryMealPickerContent(builderCatalog);
    throw err;
  }

  const data = {
    currency: builderCatalog.currency || source.currency || "SAR",
    builderCatalog,
    addonCatalog: source.addonCatalog || {
      items: [],
      byCategory: {},
      totalCount: 0,
      entitlementResolved: false,
      source: "empty_catalog",
    },
  };

  for (const field of OPTIONAL_ADDON_FIELDS) {
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
        const catalogHash = data.builderCatalog.catalogHash;
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

module.exports = { getMealPlannerMenu, sanitizePublicData };

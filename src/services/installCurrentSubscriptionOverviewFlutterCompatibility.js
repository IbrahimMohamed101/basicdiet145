"use strict";

const INSTALL_MARK = Symbol.for("basicdiet.currentSubscriptionOverviewFlutterCompatibility.installed");
const WRAPPED_MARK = Symbol.for("basicdiet.currentSubscriptionOverviewFlutterCompatibility.wrapped");

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function directScalar(value) {
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value).trim();
  }
  return "";
}

function scalarString(value, lang = "ar") {
  const direct = directScalar(value);
  if (direct) return direct;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (!isPlainObject(value)) return "";

  if (typeof value.toHexString === "function") {
    try {
      const hex = directScalar(value.toHexString());
      if (hex) return hex;
    } catch (_) {
      // Continue with the safe scalar/localized fallbacks below.
    }
  }

  for (const key of [lang, "ar", "en"]) {
    const candidate = directScalar(value[key]);
    if (candidate) return candidate;
  }

  for (const key of ["nameI18n", "name", "labelI18n", "label", "titleI18n", "title"]) {
    const nested = value[key];
    if (!nested || nested === value) continue;
    const nestedDirect = directScalar(nested);
    if (nestedDirect) return nestedDirect;
    if (isPlainObject(nested)) {
      for (const localeKey of [lang, "ar", "en"]) {
        const candidate = directScalar(nested[localeKey]);
        if (candidate) return candidate;
      }
    }
  }

  return "";
}

function idString(value) {
  const direct = directScalar(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return "";

  if (typeof value.toHexString === "function") {
    try {
      const hex = directScalar(value.toHexString());
      if (hex) return hex;
    } catch (_) {
      return "";
    }
  }

  for (const key of ["_id", "id"]) {
    const nested = value[key];
    if (nested === value) continue;
    const nestedDirect = directScalar(nested);
    if (nestedDirect) return nestedDirect;
    if (nested && typeof nested.toHexString === "function") {
      try {
        const hex = directScalar(nested.toHexString());
        if (hex) return hex;
      } catch (_) {
        return "";
      }
    }
  }

  return "";
}

function integerOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return null;
}

function normalizeObjectFields(source, {
  lang = "ar",
  stringFields = [],
  idFields = [],
  integerFields = [],
  numberFields = [],
  booleanFields = [],
} = {}) {
  if (!isPlainObject(source)) return null;
  const next = { ...source };

  for (const key of stringFields) {
    if (hasOwn(source, key)) next[key] = scalarString(source[key], lang);
  }
  for (const key of idFields) {
    if (hasOwn(source, key)) next[key] = idString(source[key]);
  }
  for (const key of integerFields) {
    if (hasOwn(source, key)) next[key] = integerOrNull(source[key]);
  }
  for (const key of numberFields) {
    if (hasOwn(source, key)) next[key] = numberOrNull(source[key]);
  }
  for (const key of booleanFields) {
    if (hasOwn(source, key)) next[key] = booleanOrNull(source[key]);
  }

  return next;
}

function normalizeObjectArray(value, mapper) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => mapper(entry)).filter(Boolean);
}

function normalizeAddonSubscription(row, lang) {
  return normalizeObjectFields(row, {
    lang,
    idFields: ["addonId"],
    stringFields: ["category", "status"],
    integerFields: ["includedCount", "maxPerDay"],
  });
}

function normalizeAddonBalance(row, lang) {
  return normalizeObjectFields(row, {
    lang,
    idFields: ["addonPlanId", "addonId"],
    stringFields: ["name", "category", "currency"],
    integerFields: [
      "purchasedDailyQty",
      "includedTotalQty",
      "purchasedQty",
      "consumedQty",
      "reservedQty",
      "remainingQty",
    ],
  });
}

function normalizeAddonSubscriptionAllowance(row, lang) {
  const next = normalizeObjectFields(row, {
    lang,
    idFields: ["addonPlanId"],
    stringFields: [
      "entitlementKey",
      "addonPlanName",
      "displayCategory",
      "allowanceCategory",
      "currency",
      "source",
    ],
    integerFields: [
      "entitlementIndex",
      "includedTotalQty",
      "consumedQty",
      "reservedQty",
      "remainingIncludedQty",
      "overageUnitPriceHalala",
      "choicesCount",
    ],
  });
  if (!next) return null;
  if (hasOwn(row, "menuProductIds")) {
    next.menuProductIds = Array.isArray(row.menuProductIds)
      ? row.menuProductIds.map(idString).filter(Boolean)
      : [];
  }
  return next;
}

function normalizeAddonCategoryAllowance(row, lang) {
  return normalizeObjectFields(row, {
    lang,
    stringFields: ["category", "currency"],
    integerFields: [
      "includedTotalQty",
      "consumedQty",
      "reservedQty",
      "remainingIncludedQty",
      "overageUnitPriceHalala",
    ],
  });
}

function normalizePremiumSummary(row, lang) {
  return normalizeObjectFields(row, {
    lang,
    idFields: ["premiumMealId"],
    stringFields: ["premiumKey", "name"],
    integerFields: ["purchasedQtyTotal", "remainingQtyTotal", "consumedQtyTotal"],
  });
}

function normalizeAddonSummary(row, lang) {
  return normalizeObjectFields(row, {
    lang,
    idFields: ["addonId"],
    stringFields: ["name"],
    integerFields: ["purchasedQtyTotal", "remainingQtyTotal", "consumedQtyTotal"],
  });
}

function normalizeCurrentSubscriptionOverviewData(data, lang = "ar") {
  if (!isPlainObject(data)) return null;
  const next = normalizeObjectFields(data, {
    lang,
    idFields: ["_id", "subscriptionId", "pickupLocationId"],
    stringFields: [
      "businessDate",
      "status",
      "startDate",
      "endDate",
      "deliveryMode",
      "statusLabel",
      "deliveryModeLabel",
      "deliveryWindowLegacy",
      "validityEndDate",
    ],
    integerFields: [
      "totalMeals",
      "remainingMeals",
      "premiumRemaining",
      "selectedMealsPerDay",
      "skipDaysUsed",
      "skipDaysLimit",
      "remainingSkipDays",
    ],
  });

  if (hasOwn(data, "addonSubscriptions")) {
    next.addonSubscriptions = normalizeObjectArray(data.addonSubscriptions, (row) => normalizeAddonSubscription(row, lang));
  }
  if (hasOwn(data, "addonBalances")) {
    next.addonBalances = normalizeObjectArray(data.addonBalances, (row) => normalizeAddonBalance(row, lang));
  }
  if (hasOwn(data, "addonSubscriptionAllowances")) {
    next.addonSubscriptionAllowances = normalizeObjectArray(
      data.addonSubscriptionAllowances,
      (row) => normalizeAddonSubscriptionAllowance(row, lang)
    );
  }
  if (hasOwn(data, "addonCategoryAllowances")) {
    next.addonCategoryAllowances = normalizeObjectArray(
      data.addonCategoryAllowances,
      (row) => normalizeAddonCategoryAllowance(row, lang)
    );
  }
  if (hasOwn(data, "premiumSummary")) {
    next.premiumSummary = normalizeObjectArray(data.premiumSummary, (row) => normalizePremiumSummary(row, lang));
  }
  if (hasOwn(data, "addonsSummary")) {
    next.addonsSummary = normalizeObjectArray(data.addonsSummary, (row) => normalizeAddonSummary(row, lang));
  }

  if (hasOwn(data, "meta")) {
    next.meta = normalizeObjectFields(data.meta, { lang, stringFields: ["testScenario"] });
  }
  if (hasOwn(data, "contract")) {
    next.contract = normalizeObjectFields(data.contract, {
      lang,
      stringFields: ["version"],
      booleanFields: ["isCanonical", "isGrandfathered"],
    });
  }
  if (hasOwn(data, "pickupPreparation")) {
    next.pickupPreparation = normalizeObjectFields(data.pickupPreparation, {
      lang,
      stringFields: [
        "flowStatus",
        "reason",
        "buttonLabel",
        "message",
        "mealPlannerCtaLabelAr",
        "mealPlannerCtaLabelEn",
        "messageAr",
        "messageEn",
        "businessDate",
      ],
      booleanFields: [
        "canRequestPrepare",
        "canBePrepared",
        "planningReady",
        "showMealPlannerCta",
        "pickupRequested",
        "pickupPrepared",
      ],
    });
  }
  if (hasOwn(data, "deliverySlot")) {
    next.deliverySlot = normalizeObjectFields(data.deliverySlot, {
      lang,
      idFields: ["slotId"],
      stringFields: ["type", "window", "label"],
    });
  }
  if (hasOwn(data, "deliveryAddress")) {
    next.deliveryAddress = normalizeObjectFields(data.deliveryAddress, {
      lang,
      stringFields: [
        "label",
        "line1",
        "line2",
        "city",
        "district",
        "zoneName",
        "formatted",
        "street",
        "building",
        "apartment",
        "notes",
      ],
    });
  }
  if (hasOwn(data, "deliveryWindow")) {
    if (typeof data.deliveryWindow === "string") {
      next.deliveryWindow = scalarString(data.deliveryWindow, lang);
    } else {
      next.deliveryWindow = normalizeObjectFields(data.deliveryWindow, {
        lang,
        stringFields: ["from", "to", "label", "window"],
      });
    }
  }
  if (hasOwn(data, "pickupLocation")) {
    next.pickupLocation = normalizeObjectFields(data.pickupLocation, {
      lang,
      idFields: ["id", "_id"],
      stringFields: ["name", "address", "phone", "city", "district", "workingHours", "mapUrl"],
      numberFields: ["latitude", "longitude"],
    });
  }
  if (hasOwn(data, "fulfillmentSummary")) {
    next.fulfillmentSummary = normalizeObjectFields(data.fulfillmentSummary, {
      lang,
      stringFields: [
        "mode",
        "title",
        "status",
        "statusLabel",
        "message",
        "nextAction",
        "lockedReason",
        "lockedMessage",
      ],
      booleanFields: ["isEditable", "isFulfillable", "planningReady", "fulfillmentReady"],
    });
  }
  if (hasOwn(data, "mealBalance")) {
    next.mealBalance = normalizeObjectFields(data.mealBalance, {
      lang,
      stringFields: ["mealBalancePolicy"],
      integerFields: ["totalMeals", "remainingMeals", "consumedMeals", "maxConsumableMealsNow", "dailyMealsDefault"],
      booleanFields: ["canConsumeNow", "dailyMealLimitEnforced"],
    });
  }

  return next;
}

function normalizeCurrentSubscriptionOverviewResponse(response, lang = "ar") {
  if (!isPlainObject(response)) return response;
  const next = { ...response };
  if (hasOwn(response, "ok")) next.ok = booleanOrNull(response.ok);
  if (hasOwn(response, "status") && typeof response.status !== "boolean") {
    const normalizedStatus = booleanOrNull(response.status);
    next.status = normalizedStatus === null ? response.status : normalizedStatus;
  }
  if (hasOwn(response, "message")) next.message = scalarString(response.message, lang);
  if (hasOwn(response, "data")) {
    next.data = response.data === null ? null : normalizeCurrentSubscriptionOverviewData(response.data, lang);
  }
  return next;
}

function installCurrentSubscriptionOverviewFlutterCompatibility() {
  if (globalThis[INSTALL_MARK]) return globalThis[INSTALL_MARK];

  const service = require("./subscription/subscriptionClientOverviewService");
  const original = service.buildCurrentSubscriptionOverview;

  if (typeof original === "function" && !original[WRAPPED_MARK]) {
    const wrapped = async function buildFlutterCompatibleCurrentSubscriptionOverview(args = {}) {
      const response = await original.apply(this, arguments);
      return normalizeCurrentSubscriptionOverviewResponse(response, args && args.lang ? args.lang : "ar");
    };
    wrapped[WRAPPED_MARK] = true;
    service.buildCurrentSubscriptionOverview = wrapped;
  }

  const verification = Object.freeze({
    installed: true,
    endpoint: "/api/subscriptions/current/overview",
    responseShapeChanged: false,
    flutterStrictTypesNormalized: true,
    recursiveTraversal: false,
  });
  globalThis[INSTALL_MARK] = verification;
  return verification;
}

installCurrentSubscriptionOverviewFlutterCompatibility();

module.exports = {
  installCurrentSubscriptionOverviewFlutterCompatibility,
  normalizeCurrentSubscriptionOverviewData,
  normalizeCurrentSubscriptionOverviewResponse,
};

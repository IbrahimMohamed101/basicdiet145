const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const Plan = require("../models/Plan");
const Setting = require("../models/Setting");
const User = require("../models/User");
const AppUser = require("../models/AppUser");
const PremiumMeal = require("../models/PremiumMeal");
const Addon = require("../models/Addon");
const Subscription = require("../models/Subscription");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const CheckoutDraft = require("../models/CheckoutDraft");
const SubscriptionDay = require("../models/SubscriptionDay");
const DashboardUser = require("../models/DashboardUser");
const ActivityLog = require("../models/ActivityLog");
const NotificationLog = require("../models/NotificationLog");
const { processDailyCutoff } = require("../services/automationService");
const { getInvoice } = require("../services/moyasarService");
const { buildPhase1SubscriptionContract } = require("../services/subscription/subscriptionContractService");
const { activateSubscriptionFromCanonicalContract } = require("../services/subscription/subscriptionActivationService");
const {
  applyPaymentSideEffects,
  SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES,
} = require("../services/paymentApplicationService");
const {
  resolveCheckoutQuoteOrThrow,
  finalizeSubscriptionDraftPayment,
  applyWalletTopupPayment,
  freezeSubscription,
  unfreezeSubscription,
  skipDay,
  unskipDay,
} = require("./subscriptionController");
const { logger } = require("../utils/logger");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { getRequestLang, pickLang } = require("../utils/i18n");
const dateUtils = require("../utils/date");
const { resolveMealsPerDay } = require("../utils/subscription/subscriptionDaySelectionSync");
const { writeLog } = require("../utils/log");
const {
  isPhase1CanonicalAdminCreateEnabled,
  isPhase1SharedPaymentDispatcherEnabled,
  isPhase2GenericPremiumWalletEnabled,
} = require("../utils/featureFlags");
const { getSubscriptionContractReadView } = require("../services/subscription/subscriptionContractReadService");
const {
  LEGACY_PREMIUM_WALLET_MODE,
  GENERIC_PREMIUM_WALLET_MODE,
  isGenericPremiumWalletMode,
  buildGenericPremiumBalanceRows,
} = require("../services/genericPremiumWalletService");
const {
  buildRecurringAddonEntitlementsFromQuote,
  buildProjectedDayEntry,
} = require("../services/recurringAddonService");
const {
  normalizeDashboardEmail,
  isValidEmailFormat,
  validateDashboardPassword,
  hashDashboardPassword,
} = require("../services/dashboardPasswordService");
const { assertValidPhoneE164 } = require("../services/otpService");
const SubscriptionLifecycleService = require("../services/subscription/subscriptionLifecycleService");
const SubscriptionOperationsReadService = require("../services/subscription/subscriptionOperationsReadService");

const MAX_PREMIUM_PRICE = 10000;
const MAX_VAT_PERCENTAGE = 100;
const DASHBOARD_ROLES = new Set(["superadmin", "admin", "kitchen", "courier"]);
const LEGACY_PLAN_FIELDS_TO_UNSET = {
  mealsPerDay: "",
  grams: "",
  price: "",
  skipAllowance: "",
  skipAllowanceCompensatedDays: "",
};
const NON_TERMINAL_ORDER_STATUSES = ["created", "confirmed", "preparing", "out_for_delivery", "ready_for_pickup"];
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const sliceCAdminRuntime = {
  resolveCheckoutQuoteOrThrow: (...args) => resolveCheckoutQuoteOrThrow(...args),
  buildPhase1SubscriptionContract: (...args) => buildPhase1SubscriptionContract(...args),
  activateSubscriptionFromCanonicalContract: (...args) => activateSubscriptionFromCanonicalContract(...args),
  serializeSubscriptionAdmin: (...args) => serializeSubscriptionAdmin(...args),
  writeActivityLogSafely: (...args) => writeActivityLogSafely(...args),
  async findClientUserById(userId) {
    return User.findOne({ _id: userId, role: "client" }).lean();
  },
  startSession() {
    return mongoose.startSession();
  },
};

// cancelSubscriptionAdminDefaultRuntime moved to SubscriptionLifecycleService

function resolveAdminRuntimeOverrides(defaultRuntime, nextOrRuntimeOverrides, explicitRuntimeOverrides = null) {
  const candidate = explicitRuntimeOverrides || nextOrRuntimeOverrides;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return defaultRuntime;
  }
  return { ...defaultRuntime, ...candidate };
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function createControlledError(status, code, message) {
  return { status, code, message };
}

function isControlledError(err) {
  return (
    err
    && Number.isInteger(err.status)
    && typeof err.code === "string"
    && typeof err.message === "string"
  );
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!isNonNegativeInteger(parsed)) {
    throw createControlledError(400, "INVALID", `${fieldName} must be an integer >= 0`);
  }
  return parsed;
}

function hasNonEmptyValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeSarAmountToHalalaOrThrow(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createControlledError(400, "INVALID", `${fieldName} must be a number >= 0`);
  }
  return Math.round(parsed * 100);
}

function resolvePlanMoneyMinorUnitsOrThrow(rawObject, {
  fieldPath,
  halalaField,
  sarField,
  legacySarField,
} = {}) {
  if (rawObject && hasNonEmptyValue(rawObject[halalaField])) {
    const amountHalala = Number(rawObject[halalaField]);
    if (!isNonNegativeInteger(amountHalala)) {
      throw createControlledError(400, "INVALID", `${fieldPath}.${halalaField} must be an integer >= 0`);
    }
    return amountHalala;
  }

  if (rawObject && hasNonEmptyValue(rawObject[sarField])) {
    return normalizeSarAmountToHalalaOrThrow(rawObject[sarField], `${fieldPath}.${sarField}`);
  }

  if (legacySarField && rawObject && hasNonEmptyValue(rawObject[legacySarField])) {
    return normalizeSarAmountToHalalaOrThrow(rawObject[legacySarField], `${fieldPath}.${legacySarField}`);
  }

  throw createControlledError(400, "INVALID", `${fieldPath}.${halalaField} must be an integer >= 0`);
}

function normalizeName(input) {
  if (typeof input === "string") {
    const en = input.trim();
    if (!en) {
      throw createControlledError(400, "INVALID", "name must have at least one non-empty value in ar or en");
    }
    return { ar: "", en };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw createControlledError(400, "INVALID", "name must be an object with ar/en or a non-empty string");
  }

  const ar = input.ar === undefined || input.ar === null ? "" : String(input.ar).trim();
  const en = input.en === undefined || input.en === null ? "" : String(input.en).trim();

  if (!ar && !en) {
    throw createControlledError(400, "INVALID", "name must have at least one non-empty value in ar or en");
  }

  return { ar, en };
}

function parsePositiveIntegerOrThrow(value, fieldName) {
  const parsed = Number(value);
  if (!isPositiveInteger(parsed)) {
    throw createControlledError(400, "INVALID", `${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parsePathPositiveIntegerOrRespond(res, value, fieldName) {
  try {
    return parsePositiveIntegerOrThrow(value, fieldName);
  } catch (err) {
    if (isControlledError(err)) {
      errorResponse(res, err.status, err.code, err.message);
      return null;
    }
    throw err;
  }
}

function validateObjectIdOrRespond(res, value, fieldName = "id") {
  try {
    validateObjectId(value, fieldName);
    return true;
  } catch (err) {
    errorResponse(res, err.status, err.code, err.message);
    return false;
  }
}

function validatePlanPayloadOrThrow(payload, { requireGramsOptions = true } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createControlledError(400, "INVALID", "Request body must be an object");
  }

  const name = normalizeName(payload.name);

  const daysCount = Number(payload.daysCount);
  if (!isPositiveInteger(daysCount)) {
    throw createControlledError(400, "INVALID", "daysCount must be a positive integer");
  }

  const currency = payload.currency === undefined ? "SAR" : String(payload.currency).trim();
  if (!currency) {
    throw createControlledError(400, "INVALID", "currency must be a non-empty string");
  }

  const rawSkipPolicy = payload.skipPolicy === undefined ? {} : payload.skipPolicy;
  if (!rawSkipPolicy || typeof rawSkipPolicy !== "object" || Array.isArray(rawSkipPolicy)) {
    throw createControlledError(400, "INVALID", "skipPolicy must be an object");
  }

  const skipPolicy = {
    enabled:
      rawSkipPolicy.enabled === undefined
        ? true
        : Boolean(rawSkipPolicy.enabled),
    maxDays:
      rawSkipPolicy.maxDays === undefined
        ? 0
        : Number(rawSkipPolicy.maxDays),
  };
  if (!isNonNegativeInteger(skipPolicy.maxDays)) {
    throw createControlledError(400, "INVALID", "skipPolicy.maxDays must be an integer >= 0");
  }

  const rawFreezePolicy = payload.freezePolicy === undefined ? {} : payload.freezePolicy;
  if (!rawFreezePolicy || typeof rawFreezePolicy !== "object" || Array.isArray(rawFreezePolicy)) {
    throw createControlledError(400, "INVALID", "freezePolicy must be an object");
  }

  const freezePolicy = {
    enabled:
      rawFreezePolicy.enabled === undefined
        ? true
        : Boolean(rawFreezePolicy.enabled),
    maxDays:
      rawFreezePolicy.maxDays === undefined
        ? 31
        : Number(rawFreezePolicy.maxDays),
    maxTimes:
      rawFreezePolicy.maxTimes === undefined
        ? 1
        : Number(rawFreezePolicy.maxTimes),
  };

  if (!isPositiveInteger(freezePolicy.maxDays)) {
    throw createControlledError(400, "INVALID", "freezePolicy.maxDays must be an integer >= 1");
  }
  if (!isNonNegativeInteger(freezePolicy.maxTimes)) {
    throw createControlledError(400, "INVALID", "freezePolicy.maxTimes must be an integer >= 0");
  }

  const isActive = payload.isActive === undefined ? true : Boolean(payload.isActive);
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");

  if (!Array.isArray(payload.gramsOptions)) {
    throw createControlledError(400, "INVALID", "gramsOptions must be an array");
  }

  if (requireGramsOptions && payload.gramsOptions.length < 1) {
    throw createControlledError(400, "INVALID", "gramsOptions must contain at least one item");
  }

  const gramsValues = new Set();
  const gramsOptions = payload.gramsOptions.map((rawGramsOption, gramsIndex) => {
    if (!rawGramsOption || typeof rawGramsOption !== "object" || Array.isArray(rawGramsOption)) {
      throw createControlledError(400, "INVALID", `gramsOptions[${gramsIndex}] must be an object`);
    }

    const grams = Number(rawGramsOption.grams);
    if (!isPositiveInteger(grams)) {
      throw createControlledError(400, "INVALID", `gramsOptions[${gramsIndex}].grams must be a positive integer`);
    }
    if (gramsValues.has(grams)) {
      throw createControlledError(409, "CONFLICT", `Duplicate grams value ${grams} is not allowed`);
    }
    gramsValues.add(grams);

    if (!Array.isArray(rawGramsOption.mealsOptions) || rawGramsOption.mealsOptions.length < 1) {
      throw createControlledError(
        400,
        "INVALID",
        `gramsOptions[${gramsIndex}].mealsOptions must be an array with at least one item`
      );
    }

    const mealsValues = new Set();
    const mealsOptions = rawGramsOption.mealsOptions.map((rawMealOption, mealIndex) => {
      if (!rawMealOption || typeof rawMealOption !== "object" || Array.isArray(rawMealOption)) {
        throw createControlledError(
          400,
          "INVALID",
          `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}] must be an object`
        );
      }

      const mealsPerDay = Number(rawMealOption.mealsPerDay);
      if (!isPositiveInteger(mealsPerDay)) {
        throw createControlledError(
          400,
          "INVALID",
          `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}].mealsPerDay must be a positive integer`
        );
      }
      if (mealsValues.has(mealsPerDay)) {
        throw createControlledError(
          409,
          "CONFLICT",
          `Duplicate mealsPerDay value ${mealsPerDay} is not allowed in grams ${grams}`
        );
      }
      mealsValues.add(mealsPerDay);

      const fieldPath = `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}]`;
      const priceHalala = resolvePlanMoneyMinorUnitsOrThrow(rawMealOption, {
        fieldPath,
        halalaField: "priceHalala",
        sarField: "priceSar",
        legacySarField: "price",
      });
      const compareAtHalala = resolvePlanMoneyMinorUnitsOrThrow(rawMealOption, {
        fieldPath,
        halalaField: "compareAtHalala",
        sarField: "compareAtSar",
        legacySarField: "compareAt",
      });

      return {
        mealsPerDay,
        priceHalala,
        compareAtHalala,
        isActive: rawMealOption.isActive === undefined ? true : Boolean(rawMealOption.isActive),
        sortOrder:
          rawMealOption.sortOrder === undefined
            ? 0
            : normalizeSortOrder(
              rawMealOption.sortOrder,
              `gramsOptions[${gramsIndex}].mealsOptions[${mealIndex}].sortOrder`
            ),
      };
    });

    return {
      grams,
      mealsOptions,
      isActive: rawGramsOption.isActive === undefined ? true : Boolean(rawGramsOption.isActive),
      sortOrder:
        rawGramsOption.sortOrder === undefined
          ? 0
          : normalizeSortOrder(rawGramsOption.sortOrder, `gramsOptions[${gramsIndex}].sortOrder`),
    };
  });

  return {
    name,
    daysCount,
    currency,
    gramsOptions,
    skipPolicy,
    freezePolicy,
    isActive,
    sortOrder,
  };
}

function validateMealsOptionPayloadOrThrow(rawMealOption, fieldPath = "mealOption") {
  if (!rawMealOption || typeof rawMealOption !== "object" || Array.isArray(rawMealOption)) {
    throw createControlledError(400, "INVALID", `${fieldPath} must be an object`);
  }

  const mealsPerDay = Number(rawMealOption.mealsPerDay);
  if (!isPositiveInteger(mealsPerDay)) {
    throw createControlledError(400, "INVALID", `${fieldPath}.mealsPerDay must be a positive integer`);
  }

  const priceHalala = resolvePlanMoneyMinorUnitsOrThrow(rawMealOption, {
    fieldPath,
    halalaField: "priceHalala",
    sarField: "priceSar",
    legacySarField: "price",
  });

  const compareAtHalala = resolvePlanMoneyMinorUnitsOrThrow(rawMealOption, {
    fieldPath,
    halalaField: "compareAtHalala",
    sarField: "compareAtSar",
    legacySarField: "compareAt",
  });

  return {
    mealsPerDay,
    priceHalala,
    compareAtHalala,
    isActive: rawMealOption.isActive === undefined ? true : Boolean(rawMealOption.isActive),
    sortOrder:
      rawMealOption.sortOrder === undefined
        ? 0
        : normalizeSortOrder(rawMealOption.sortOrder, `${fieldPath}.sortOrder`),
  };
}

function validateGramsOptionPayloadOrThrow(rawGramsOption, {
  fieldPath = "gramsOption",
  requireMealsOptions = true,
} = {}) {
  if (!rawGramsOption || typeof rawGramsOption !== "object" || Array.isArray(rawGramsOption)) {
    throw createControlledError(400, "INVALID", `${fieldPath} must be an object`);
  }

  const grams = Number(rawGramsOption.grams);
  if (!isPositiveInteger(grams)) {
    throw createControlledError(400, "INVALID", `${fieldPath}.grams must be a positive integer`);
  }

  if (!Array.isArray(rawGramsOption.mealsOptions)) {
    throw createControlledError(400, "INVALID", `${fieldPath}.mealsOptions must be an array`);
  }
  if (requireMealsOptions && rawGramsOption.mealsOptions.length < 1) {
    throw createControlledError(400, "INVALID", `${fieldPath}.mealsOptions must contain at least one item`);
  }

  const mealsValues = new Set();
  const mealsOptions = rawGramsOption.mealsOptions.map((rawMealOption, mealIndex) => {
    const normalizedOption = validateMealsOptionPayloadOrThrow(
      rawMealOption,
      `${fieldPath}.mealsOptions[${mealIndex}]`
    );
    if (mealsValues.has(normalizedOption.mealsPerDay)) {
      throw createControlledError(
        409,
        "CONFLICT",
        `Duplicate mealsPerDay value ${normalizedOption.mealsPerDay} is not allowed in grams ${grams}`
      );
    }
    mealsValues.add(normalizedOption.mealsPerDay);
    return normalizedOption;
  });

  return {
    grams,
    mealsOptions,
    isActive: rawGramsOption.isActive === undefined ? true : Boolean(rawGramsOption.isActive),
    sortOrder:
      rawGramsOption.sortOrder === undefined
        ? 0
        : normalizeSortOrder(rawGramsOption.sortOrder, `${fieldPath}.sortOrder`),
  };
}

function findGramsIndex(plan, grams) {
  if (!Array.isArray(plan.gramsOptions)) {
    return -1;
  }
  return plan.gramsOptions.findIndex((option) => option.grams === grams);
}

function findMealsIndex(gramsOption, mealsPerDay) {
  if (!Array.isArray(gramsOption.mealsOptions)) {
    return -1;
  }
  return gramsOption.mealsOptions.findIndex((option) => option.mealsPerDay === mealsPerDay);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAdminPlanStatusOrThrow(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "all") {
    return null;
  }
  if (["active", "enabled", "true", "1"].includes(normalized)) {
    return "active";
  }
  if (["inactive", "disabled", "false", "0"].includes(normalized)) {
    return "inactive";
  }

  throw createControlledError(400, "INVALID", "status must be one of: active, inactive, all");
}

function resolveAdminPlanFiltersOrThrow(query = {}) {
  const q = String(query.search || query.q || "").trim();
  const normalizedStatus = normalizeAdminPlanStatusOrThrow(
    query.status === undefined ? query.isActive : query.status
  );

  return {
    q,
    normalizedStatus,
  };
}

function buildAdminPlanSummary(plans = []) {
  const totalPlans = plans.length;
  const activePlans = plans.filter((plan) => plan && plan.isActive !== false).length;
  const inactivePlans = totalPlans - activePlans;
  const totalDaysCount = plans.reduce((sum, plan) => sum + Number(plan && plan.daysCount ? plan.daysCount : 0), 0);

  return {
    totalPlans,
    activePlans,
    inactivePlans,
    averageDaysCount: totalPlans ? Math.round((totalDaysCount / totalPlans) * 100) / 100 : 0,
  };
}

function resolveNestedPlanSortValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildAdminPlanPricing(plan) {
  const gramsOptions = Array.isArray(plan && plan.gramsOptions) ? [...plan.gramsOptions] : [];
  gramsOptions.sort((a, b) => {
    const sortDiff = resolveNestedPlanSortValue(a && a.sortOrder) - resolveNestedPlanSortValue(b && b.sortOrder);
    if (sortDiff !== 0) {
      return sortDiff;
    }
    return Number(a && a.grams) - Number(b && b.grams);
  });

  const preferredGramsOption = gramsOptions.find((option) => option && option.isActive !== false) || gramsOptions[0] || null;
  const mealsOptions = Array.isArray(preferredGramsOption && preferredGramsOption.mealsOptions)
    ? [...preferredGramsOption.mealsOptions]
    : [];
  mealsOptions.sort((a, b) => {
    const sortDiff = resolveNestedPlanSortValue(a && a.sortOrder) - resolveNestedPlanSortValue(b && b.sortOrder);
    if (sortDiff !== 0) {
      return sortDiff;
    }
    return Number(a && a.mealsPerDay) - Number(b && b.mealsPerDay);
  });

  const preferredMealsOption = mealsOptions.find((option) => option && option.isActive !== false) || mealsOptions[0] || null;
  const startsFromHalala = Number(preferredMealsOption && preferredMealsOption.priceHalala) || 0;
  const compareAtStartsFromHalala = Number(preferredMealsOption && preferredMealsOption.compareAtHalala) || 0;

  return {
    startsFromHalala,
    startsFromSar: minorUnitsToMajor(startsFromHalala),
    compareAtStartsFromHalala,
    compareAtStartsFromSar: minorUnitsToMajor(compareAtStartsFromHalala),
  };
}

function serializeAdminPlan(plan) {
  if (!plan || typeof plan !== "object") {
    return plan;
  }

  const currency = normalizeCurrencyValue(plan.currency);
  const {
    skipAllowanceCompensatedDays: _legacySkipAllowanceCompensatedDays,
    ...rest
  } = plan;
  return {
    ...rest,
    currency,
    skipPolicy: {
      enabled: plan.skipPolicy && plan.skipPolicy.enabled !== undefined
        ? Boolean(plan.skipPolicy.enabled)
        : true,
      maxDays:
        plan.skipPolicy && Number.isInteger(plan.skipPolicy.maxDays) && plan.skipPolicy.maxDays >= 0
          ? plan.skipPolicy.maxDays
          : 0,
    },
    gramsOptions: Array.isArray(plan.gramsOptions)
      ? plan.gramsOptions.map((gramsOption) => ({
        ...gramsOption,
        mealsOptions: Array.isArray(gramsOption && gramsOption.mealsOptions)
          ? gramsOption.mealsOptions.map((mealOption) => {
            const priceHalala = Number(mealOption && mealOption.priceHalala) || 0;
            const compareAtHalala = Number(mealOption && mealOption.compareAtHalala) || 0;
            return {
              ...mealOption,
              priceHalala,
              priceSar: minorUnitsToMajor(priceHalala),
              price: minorUnitsToMajor(priceHalala),
              compareAtHalala,
              compareAtSar: minorUnitsToMajor(compareAtHalala),
              compareAt: minorUnitsToMajor(compareAtHalala),
            };
          })
          : [],
      }))
      : [],
    pricing: buildAdminPlanPricing(plan),
  };
}

function planMatchesAdminSearch(plan, q) {
  if (!q) {
    return true;
  }

  const regex = new RegExp(escapeRegExp(q), "i");
  if (regex.test(String(plan && plan._id ? plan._id : ""))) {
    return true;
  }

  const name = plan && plan.name && typeof plan.name === "object" ? plan.name : {};
  if (regex.test(String(name.ar || "")) || regex.test(String(name.en || ""))) {
    return true;
  }

  const numericQuery = Number(q);
  if (isPositiveInteger(numericQuery)) {
    if (Number(plan && plan.daysCount) === numericQuery) {
      return true;
    }

    const gramsOptions = Array.isArray(plan && plan.gramsOptions) ? plan.gramsOptions : [];
    return gramsOptions.some((gramsOption) => {
      if (Number(gramsOption && gramsOption.grams) === numericQuery) {
        return true;
      }
      const mealsOptions = Array.isArray(gramsOption && gramsOption.mealsOptions) ? gramsOption.mealsOptions : [];
      return mealsOptions.some((mealOption) => Number(mealOption && mealOption.mealsPerDay) === numericQuery);
    });
  }

  return false;
}

function filterAdminPlans(plans = [], filters = {}) {
  const { q = "", normalizedStatus = null } = filters;

  return plans.filter((plan) => {
    if (normalizedStatus === "active" && plan.isActive === false) {
      return false;
    }
    if (normalizedStatus === "inactive" && plan.isActive !== false) {
      return false;
    }
    return planMatchesAdminSearch(plan, q);
  });
}

function normalizeOptionalEmailOrThrow(email) {
  if (email === undefined) {
    return undefined;
  }
  if (email === null || String(email).trim() === "") {
    return null;
  }

  const normalized = String(email).trim().toLowerCase();
  if (!isValidEmailFormat(normalized)) {
    throw createControlledError(400, "INVALID", "email must be a valid email address");
  }
  return normalized;
}

function normalizeOptionalFullName(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function buildKsaDayUtcRange(dateStr) {
  const start = new Date(`${dateStr}T00:00:00+03:00`);
  const end = new Date(`${dateUtils.addDaysToKSADateString(dateStr, 1)}T00:00:00+03:00`);
  return { start, end };
}

function mapSubscriptionQuoteError(err) {
  if (!err) {
    return { status: 500, code: "INTERNAL", message: "Unexpected error" };
  }

  if (isControlledError(err)) {
    return err;
  }

  if (err.code === "NOT_FOUND") {
    return { status: 404, code: err.code, message: err.message };
  }
  if (["VALIDATION_ERROR", "INVALID_SELECTION", "INVALID_DATE"].includes(err.code)) {
    return { status: 400, code: err.code, message: err.message };
  }
  if (err.code === "CONFLICT") {
    return { status: 409, code: err.code, message: err.message };
  }
  return { status: 500, code: err.code || "INTERNAL", message: err.message || "Unexpected error" };
}

function buildRecentOrderSearchKey(order) {
  return [
    buildAdminOrderDisplayId(order),
    String(order && order._id ? order._id : ""),
    buildOrderItemsSummary(order, "ar") || "",
    buildOrderItemsSummary(order, "en") || "",
  ].join(" ").toLowerCase();
}

function resolvePagination(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  if (query.limit === undefined || query.limit === null || query.limit === "") {
    return { page, limit: 50 };
  }
  const parsedLimit = Number(query.limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return { error: { status: 400, code: "INVALID", message: "limit must be a positive number" } };
  }
  if (parsedLimit > 200) {
    return { error: { status: 400, code: "INVALID", message: "limit cannot exceed 200" } };
  }
  return { page, limit: Math.min(Math.floor(parsedLimit), 200) };
}

function buildPaginationMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

function resolvePaginationOrRespond(res, query = {}) {
  const pagination = resolvePagination(query);
  if (pagination.error) {
    errorResponse(res, pagination.error.status, pagination.error.code, pagination.error.message);
    return null;
  }
  return pagination;
}

function parseDateFilterOrNull(value, { bound = "start" } = {}) {
  if (!value) return null;
  const normalized = String(value).trim();
  const parsed = DATE_ONLY_REGEX.test(normalized)
    ? new Date(`${normalized}T00:00:00+03:00`)
    : new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (bound === "end" && DATE_ONLY_REGEX.test(normalized)) {
    return {
      operator: "$lt",
      value: new Date(`${dateUtils.addDaysToKSADateString(normalized, 1)}T00:00:00+03:00`),
    };
  }
  return {
    operator: bound === "end" ? "$lte" : "$gte",
    value: parsed,
  };
}

function isValidWindowRange(window) {
  if (typeof window !== "string") return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(window);
  if (!match) return false;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = Number(match[3]) * 60 + Number(match[4]);
  return endMinutes > startMinutes;
}

function serializeDashboardUserAdmin(userDoc) {
  if (!userDoc) return null;
  const user = typeof userDoc.toObject === "function" ? userDoc.toObject() : { ...userDoc };
  delete user.passwordHash;
  return user;
}

function dedupeStringArray(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function serializeAppUserAdmin({ coreUser, appUser, subscriptionsCount = 0, activeSubscriptionsCount = 0 }) {
  return {
    id: String(coreUser._id),
    coreUserId: String(coreUser._id),
    appUserId: appUser ? String(appUser._id) : null,
    fullName: coreUser.name || (appUser && appUser.fullName) || null,
    phone: coreUser.phone || (appUser && appUser.phone) || null,
    email: coreUser.email || (appUser && appUser.email) || null,
    role: "app_user",
    isActive: Boolean(coreUser.isActive),
    fcmTokens: dedupeStringArray([
      ...(Array.isArray(coreUser.fcmTokens) ? coreUser.fcmTokens : []),
      ...(appUser && Array.isArray(appUser.fcmTokens) ? appUser.fcmTokens : []),
    ]),
    subscriptionsCount,
    activeSubscriptionsCount,
    createdAt: appUser && appUser.createdAt ? appUser.createdAt : coreUser.createdAt,
    updatedAt: coreUser.updatedAt || (appUser && appUser.updatedAt) || null,
  };
}

function serializeClientUserSummary(userDoc) {
  if (!userDoc) return null;
  return {
    id: String(userDoc._id),
    fullName: userDoc.name || null,
    phone: userDoc.phone || null,
    email: userDoc.email || null,
    isActive: Boolean(userDoc.isActive),
  };
}

async function serializeSubscriptionAdmin(subscription, lang, userDoc) {
  const catalog = await loadSubscriptionSummaryCatalog([subscription], lang);
  return serializeSubscriptionAdminFromCatalog(subscription, userDoc, catalog);
}

function serializeOrderAdmin(order, userDoc) {
  return {
    ...order,
    user: serializeClientUserSummary(userDoc),
  };
}

function serializePaymentAdmin(payment, userDoc) {
  return {
    ...payment,
    user: serializeClientUserSummary(userDoc),
  };
}

function normalizeCurrencyValue(value) {
  return String(value || "SAR").trim().toUpperCase();
}

function minorUnitsToMajor(amount) {
  const normalized = Number(amount || 0);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  return normalized / 100;
}

function formatAmountDisplay(amountMinorUnits, currency, lang) {
  const amount = minorUnitsToMajor(amountMinorUnits);
  const normalizedCurrency = normalizeCurrencyValue(currency);
  const label = normalizedCurrency === "SAR" ? (lang === "ar" ? "ريال" : "SAR") : normalizedCurrency;
  const numeric = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(/\.?0+$/, "");
  return `${numeric} ${label}`;
}

function buildAdminOrderDisplayId(order) {
  return `ORD-${String(order && order._id ? order._id : "").slice(-6).toUpperCase()}`;
}

function buildAdminSubscriptionDisplayId(subscription) {
  return `SUB-${String(subscription && subscription._id ? subscription._id : "").slice(-6).toUpperCase()}`;
}

function buildOrderItemsSummary(order, lang) {
  const names = [];

  if (Array.isArray(order && order.items)) {
    for (const item of order.items) {
      if (!item) continue;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (name) {
        names.push(name);
      }
    }
  }

  if (Array.isArray(order && order.customSalads) && order.customSalads.length > 0) {
    names.push(lang === "ar" ? "سلطة مخصصة" : "Custom salad");
  }
  if (Array.isArray(order && order.customMeals) && order.customMeals.length > 0) {
    names.push(lang === "ar" ? "وجبة مخصصة" : "Custom meal");
  }

  return names.slice(0, 3).join(lang === "ar" ? "، " : ", ") || null;
}

function normalizeProviderPaymentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "cancelled" || normalized === "voided") return "canceled";
  if (normalized === "captured") return "paid";
  if (["authorized", "verified", "on_hold"].includes(normalized)) return "initiated";
  if (["initiated", "paid", "failed", "canceled", "expired", "refunded"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function pickProviderInvoicePayment(invoice, payment) {
  const attempts = Array.isArray(invoice && invoice.payments)
    ? invoice.payments.filter((item) => item && typeof item === "object")
    : [];
  if (!attempts.length) return null;

  if (payment && payment.providerPaymentId) {
    const matched = attempts.find((item) => String(item.id || "") === String(payment.providerPaymentId));
    if (matched) return matched;
  }

  const paidAttempts = attempts.filter((item) => normalizeProviderPaymentStatus(item.status) === "paid");
  if (paidAttempts.length) {
    return paidAttempts[paidAttempts.length - 1];
  }

  return attempts[attempts.length - 1];
}

function buildProviderInvoiceSummary(providerInvoice, payment) {
  if (!providerInvoice) return null;
  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const providerStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );

  return {
    id: providerInvoice.id || null,
    status: providerStatus || String(providerInvoice.status || "").trim().toLowerCase() || null,
    amount: Number.isFinite(Number(providerInvoice.amount)) ? Number(providerInvoice.amount) : null,
    currency: providerInvoice.currency || null,
    url: providerInvoice.url || "",
    updatedAt: providerInvoice.updated_at || providerInvoice.updatedAt || null,
    attemptsCount: Array.isArray(providerInvoice.payments) ? providerInvoice.payments.length : 0,
  };
}

function collectSubscriptionCatalogIds(subscriptions) {
  const premiumIds = new Set();
  const addonIds = new Set();
  const planIds = new Set();

  for (const subscription of Array.isArray(subscriptions) ? subscriptions : []) {
    if (subscription && subscription.planId) {
      planIds.add(String(subscription.planId));
    }
    for (const row of Array.isArray(subscription && subscription.premiumBalance) ? subscription.premiumBalance : []) {
      if (row && row.premiumMealId) premiumIds.add(String(row.premiumMealId));
    }
    for (const row of Array.isArray(subscription && subscription.premiumSelections) ? subscription.premiumSelections : []) {
      if (row && row.premiumMealId) premiumIds.add(String(row.premiumMealId));
    }
    for (const row of Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : []) {
      if (row && row.addonId) addonIds.add(String(row.addonId));
    }
    for (const row of Array.isArray(subscription && subscription.addonSelections) ? subscription.addonSelections : []) {
      if (row && row.addonId) addonIds.add(String(row.addonId));
    }
  }

  return {
    premiumIds: Array.from(premiumIds),
    addonIds: Array.from(addonIds),
    planIds: Array.from(planIds),
  };
}

async function loadSubscriptionSummaryCatalog(subscriptions, lang) {
  const { premiumIds, addonIds, planIds } = collectSubscriptionCatalogIds(subscriptions);
  const [premiumDocs, addonDocs, planDocs] = await Promise.all([
    premiumIds.length
      ? PremiumMeal.find({ _id: { $in: premiumIds } }).select("_id name").lean()
      : Promise.resolve([]),
    addonIds.length
      ? Addon.find({ _id: { $in: addonIds } }).select("_id name").lean()
      : Promise.resolve([]),
    planIds.length
      ? Plan.find({ _id: { $in: planIds } }).select("_id name").lean()
      : Promise.resolve([]),
  ]);

  return {
    lang,
    premiumNames: new Map(premiumDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
    addonNames: new Map(addonDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
    planNames: new Map(planDocs.map((doc) => [String(doc._id), pickLang(doc.name, lang) || ""])),
  };
}

function buildSubscriptionSummariesFromCatalog(subscription, catalog) {
  if (isGenericPremiumWalletMode(subscription)) {
    const premiumBalance = Array.isArray(subscription && subscription.genericPremiumBalance)
      ? subscription.genericPremiumBalance
      : [];
    const addonBalance = Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [];
    const addonSelections = Array.isArray(subscription && subscription.addonSelections) ? subscription.addonSelections : [];
    const addonNames = catalog && catalog.addonNames instanceof Map ? catalog.addonNames : new Map();
    const premiumPurchasedQtyTotal = premiumBalance.reduce((sum, row) => sum + Number(row.purchasedQty || 0), 0);
    const premiumRemainingQtyTotal = premiumBalance.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);
    const premiumUnitValues = premiumBalance.map((row) => Number(row.unitCreditPriceHalala || 0));

    const addonById = new Map();
    for (const row of addonBalance) {
      const key = String(row.addonId);
      const current = addonById.get(key) || {
        addonId: key,
        purchasedQtyTotal: 0,
        remainingQtyTotal: 0,
        consumedQtyTotal: 0,
        minUnitPriceHalala: null,
        maxUnitPriceHalala: null,
      };
      current.purchasedQtyTotal += Number(row.purchasedQty || 0);
      current.remainingQtyTotal += Number(row.remainingQty || 0);
      const unit = Number(row.unitPriceHalala || 0);
      current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
      current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
      addonById.set(key, current);
    }
    for (const row of addonSelections) {
      const key = String(row.addonId);
      const current = addonById.get(key) || {
        addonId: key,
        purchasedQtyTotal: 0,
        remainingQtyTotal: 0,
        consumedQtyTotal: 0,
        minUnitPriceHalala: Number(row.unitPriceHalala || 0),
        maxUnitPriceHalala: Number(row.unitPriceHalala || 0),
      };
      current.consumedQtyTotal += Number(row.qty || 0);
      addonById.set(key, current);
    }

    return {
      premiumSummary: [{
        premiumMealId: null,
        name: catalog && catalog.lang === "en" ? "Premium credits" : "رصيد بريميوم",
        purchasedQtyTotal: premiumPurchasedQtyTotal,
        remainingQtyTotal: premiumRemainingQtyTotal,
        consumedQtyTotal: Math.max(0, premiumPurchasedQtyTotal - premiumRemainingQtyTotal),
        minUnitPriceHalala: premiumUnitValues.length ? Math.min(...premiumUnitValues) : 0,
        maxUnitPriceHalala: premiumUnitValues.length ? Math.max(...premiumUnitValues) : 0,
      }],
      addonsSummary: Array.from(addonById.values()).map((row) => ({
        addonId: row.addonId,
        name: addonNames.get(row.addonId) || "",
        purchasedQtyTotal: row.purchasedQtyTotal,
        remainingQtyTotal: row.remainingQtyTotal,
        consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
        minUnitPriceHalala: row.minUnitPriceHalala || 0,
        maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
      })),
    };
  }

  const premiumBalance = Array.isArray(subscription && subscription.premiumBalance) ? subscription.premiumBalance : [];
  const premiumSelections = Array.isArray(subscription && subscription.premiumSelections) ? subscription.premiumSelections : [];
  const addonBalance = Array.isArray(subscription && subscription.addonBalance) ? subscription.addonBalance : [];
  const addonSelections = Array.isArray(subscription && subscription.addonSelections) ? subscription.addonSelections : [];
  const premiumNames = catalog && catalog.premiumNames instanceof Map ? catalog.premiumNames : new Map();
  const addonNames = catalog && catalog.addonNames instanceof Map ? catalog.addonNames : new Map();

  const premiumById = new Map();
  for (const row of premiumBalance) {
    const key = String(row.premiumMealId);
    const current = premiumById.get(key) || {
      premiumMealId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: null,
      maxUnitPriceHalala: null,
    };
    current.purchasedQtyTotal += Number(row.purchasedQty || 0);
    current.remainingQtyTotal += Number(row.remainingQty || 0);
    const unit = Number(row.unitExtraFeeHalala || 0);
    current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
    current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
    premiumById.set(key, current);
  }
  for (const row of premiumSelections) {
    const key = String(row.premiumMealId);
    const current = premiumById.get(key) || {
      premiumMealId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: Number(row.unitExtraFeeHalala || 0),
      maxUnitPriceHalala: Number(row.unitExtraFeeHalala || 0),
    };
    current.consumedQtyTotal += 1;
    premiumById.set(key, current);
  }

  const addonById = new Map();
  for (const row of addonBalance) {
    const key = String(row.addonId);
    const current = addonById.get(key) || {
      addonId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: null,
      maxUnitPriceHalala: null,
    };
    current.purchasedQtyTotal += Number(row.purchasedQty || 0);
    current.remainingQtyTotal += Number(row.remainingQty || 0);
    const unit = Number(row.unitPriceHalala || 0);
    current.minUnitPriceHalala = current.minUnitPriceHalala === null ? unit : Math.min(current.minUnitPriceHalala, unit);
    current.maxUnitPriceHalala = current.maxUnitPriceHalala === null ? unit : Math.max(current.maxUnitPriceHalala, unit);
    addonById.set(key, current);
  }
  for (const row of addonSelections) {
    const key = String(row.addonId);
    const current = addonById.get(key) || {
      addonId: key,
      purchasedQtyTotal: 0,
      remainingQtyTotal: 0,
      consumedQtyTotal: 0,
      minUnitPriceHalala: Number(row.unitPriceHalala || 0),
      maxUnitPriceHalala: Number(row.unitPriceHalala || 0),
    };
    current.consumedQtyTotal += Number(row.qty || 0);
    addonById.set(key, current);
  }

  return {
    premiumSummary: Array.from(premiumById.values()).map((row) => ({
      premiumMealId: row.premiumMealId,
      name: premiumNames.get(row.premiumMealId) || "",
      purchasedQtyTotal: row.purchasedQtyTotal,
      remainingQtyTotal: row.remainingQtyTotal,
      consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
      minUnitPriceHalala: row.minUnitPriceHalala || 0,
      maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
    })),
    addonsSummary: Array.from(addonById.values()).map((row) => ({
      addonId: row.addonId,
      name: addonNames.get(row.addonId) || "",
      purchasedQtyTotal: row.purchasedQtyTotal,
      remainingQtyTotal: row.remainingQtyTotal,
      consumedQtyTotal: row.consumedQtyTotal || Math.max(0, row.purchasedQtyTotal - row.remainingQtyTotal),
      minUnitPriceHalala: row.minUnitPriceHalala || 0,
      maxUnitPriceHalala: row.maxUnitPriceHalala || 0,
    })),
  };
}

function serializeSubscriptionForClientFromCatalog(subscription, catalog, contractReadView = null) {
  const { premiumSummary, addonsSummary } = buildSubscriptionSummariesFromCatalog(subscription, catalog);
  const planNames = catalog && catalog.planNames instanceof Map ? catalog.planNames : new Map();
  const deliverySlot = subscription.deliverySlot && typeof subscription.deliverySlot === "object"
    ? subscription.deliverySlot
    : {
      type: subscription.deliveryMode,
      window: subscription.deliveryWindow || "",
      slotId: "",
    };
  const data = { ...subscription };
  const id = subscription && subscription._id ? String(subscription._id) : null;
  const planId = subscription && subscription.planId ? String(subscription.planId) : null;
  const contractView = contractReadView || getSubscriptionContractReadView(subscription, {
    audience: "client",
    lang: catalog && catalog.lang ? catalog.lang : "ar",
    livePlanName: planId ? planNames.get(planId) || null : null,
    context: "admin_client_subscription_read",
  });
  const planName = contractView.planName || null;
  delete data.__v;
  delete data.premiumBalance;
  delete data.genericPremiumBalance;
  delete data.addonBalance;
  delete data.premiumSelections;
  delete data.addonSelections;

  // P2-S7-S3: Dynamic Status Serialization (Admin Parity)
  // If subscription is "active" but today is past validityEndDate, reflect as "expired"
  if (data.status === "active") {
    const endDate = data.validityEndDate || data.endDate;
    if (endDate && dateUtils.getTodayKSADate() > dateUtils.toKSADateString(endDate)) {
      data.status = "expired";
    }
  }

  return {
    ...data,
    id,
    displayId: id ? buildAdminSubscriptionDisplayId(subscription) : null,
    plan: planId ? { id: planId, name: planName } : null,
    planName,
    deliveryAddress: subscription.deliveryAddress || null,
    deliverySlot,
    premiumSummary,
    addonsSummary,
    contract: contractView.contract,
  };
}

function serializeSubscriptionAdminFromCatalog(subscription, userDoc, catalog) {
  const planNames = catalog && catalog.planNames instanceof Map ? catalog.planNames : new Map();
  const planId = subscription && subscription.planId ? String(subscription.planId) : null;
  const contractReadView = getSubscriptionContractReadView(subscription, {
    audience: "admin",
    lang: catalog && catalog.lang ? catalog.lang : "ar",
    livePlanName: planId ? planNames.get(planId) || null : null,
    context: "admin_subscription_read",
  });
  return {
    ...serializeSubscriptionForClientFromCatalog(subscription, catalog, contractReadView),
    contractMeta: contractReadView.contractMeta,
    user: serializeClientUserSummary(userDoc),
    userName: userDoc && userDoc.name ? userDoc.name : null,
  };
}


// parseAdminSubscriptionDisplaySuffix and findSubscriptionsByDisplaySuffix moved to SubscriptionOperationsReadService

function parseAdminOrderDisplaySuffix(value) {
  const match = /^ord-([a-f0-9]{1,24})$/i.exec(String(value || "").trim());
  return match ? match[1] : "";
}

async function findOrdersByDisplaySuffix(suffix, limit) {
  if (!suffix) return [];

  return Order.aggregate([
    {
      $addFields: {
        _adminOrderIdString: { $toString: "$_id" },
      },
    },
    {
      $match: {
        $expr: {
          $regexMatch: {
            input: "$_adminOrderIdString",
            regex: `${escapeRegExp(suffix)}$`,
            options: "i",
          },
        },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: limit },
    {
      $project: {
        _adminOrderIdString: 0,
      },
    },
  ]);
}

function buildDateRangeInclusive(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }

  const dates = [];
  for (let current = startDate; current <= endDate; current = dateUtils.addDaysToKSADateString(current, 1)) {
    dates.push(current);
  }
  return dates;
}

async function writeActivityLogSafely(payload, context = {}) {
  try {
    await writeLog(payload);
  } catch (err) {
    logger.error("adminController activity log write failed", {
      error: err.message,
      stack: err.stack,
      action: payload && payload.action ? payload.action : undefined,
      entityType: payload && payload.entityType ? payload.entityType : undefined,
      entityId: payload && payload.entityId ? String(payload.entityId) : undefined,
      ...context,
    });
  }
}

function buildAppUserMaps(appUsers) {
  const byCoreUserId = new Map();
  const byPhone = new Map();

  for (const appUser of appUsers) {
    if (appUser.coreUserId) {
      byCoreUserId.set(String(appUser.coreUserId), appUser);
    }
    if (appUser.phone) {
      byPhone.set(appUser.phone, appUser);
    }
  }

  return { byCoreUserId, byPhone };
}

async function getSubscriptionCountsByUserIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const rows = await Subscription.aggregate([
    { $match: { userId: { $in: userIds } } },
    {
      $group: {
        _id: "$userId",
        subscriptionsCount: { $sum: 1 },
        activeSubscriptionsCount: {
          $sum: {
            $cond: [{ $eq: ["$status", "active"] }, 1, 0],
          },
        },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        subscriptionsCount: Number(row.subscriptionsCount || 0),
        activeSubscriptionsCount: Number(row.activeSubscriptionsCount || 0),
      },
    ])
  );
}

async function findManagedAppUserById(id) {
  let coreUser = await User.findOne({ _id: id, role: "client" }).lean();
  if (coreUser) {
    const appUser = await AppUser.findOne({
      $or: [{ coreUserId: coreUser._id }, { phone: coreUser.phone }],
    }).lean();
    return { coreUser, appUser };
  }

  const appUser = await AppUser.findById(id).lean();
  if (!appUser) {
    return null;
  }

  if (appUser.coreUserId) {
    coreUser = await User.findOne({ _id: appUser.coreUserId, role: "client" }).lean();
  }
  if (!coreUser && appUser.phone) {
    coreUser = await User.findOne({ phone: appUser.phone, role: "client" }).lean();
  }
  if (!coreUser) {
    return null;
  }

  return { coreUser, appUser };
}

async function buildUserMapByIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return new Map();
  }

  const users = await User.find({ _id: { $in: userIds } }).lean();
  return new Map(users.map((user) => [String(user._id), user]));
}

async function buildPlanMapByIds(planIds) {
  if (!Array.isArray(planIds) || planIds.length === 0) {
    return new Map();
  }

  const plans = await Plan.find({ _id: { $in: planIds } })
    .select("name currency")
    .lean();
  return new Map(plans.map((plan) => [String(plan._id), plan]));
}

async function createAppUserAdmin(req, res) {
  try {
    const body = req.body || {};
    const phone = assertValidPhoneE164(body.phone || body.phoneE164);
    const fullName = normalizeOptionalFullName(body.fullName || body.name);
    const email = normalizeOptionalEmailOrThrow(body.email);
    const isActive = body.isActive === undefined ? true : Boolean(body.isActive);

    const existingUser = await User.findOne({ phone }).lean();
    if (existingUser) {
      return errorResponse(res, 409, "CONFLICT", "App user already exists for this phone");
    }

    const appUserConflictQuery = [{ phone }];
    if (email) {
      appUserConflictQuery.push({ email });
    }
    const existingAppUser = await AppUser.findOne({ $or: appUserConflictQuery }).lean();
    if (existingAppUser) {
      return errorResponse(res, 409, "CONFLICT", "App user already exists");
    }

    const session = await mongoose.startSession();
    let createdCoreUser;
    let createdAppUser;

    try {
      session.startTransaction();
      createdCoreUser = await User.create(
        [{
          phone,
          name: fullName || undefined,
          email: email || undefined,
          role: "client",
          isActive,
        }],
        { session }
      );

      createdAppUser = await AppUser.create(
        [{
          fullName: fullName || undefined,
          phone,
          email: email || undefined,
          coreUserId: createdCoreUser[0]._id,
        }],
        { session }
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }

    const coreUser = createdCoreUser[0].toObject();
    const appUser = createdAppUser[0].toObject();

    return res.status(201).json({
      ok: true,
      data: serializeAppUserAdmin({
        coreUser,
        appUser,
        subscriptionsCount: 0,
        activeSubscriptionsCount: 0,
      }),
    });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    if (err && err.code === 11000) {
      return errorResponse(res, 409, "CONFLICT", "App user already exists");
    }
    throw err;
  }
}

async function createSubscriptionAdmin(req, res, nextOrRuntimeOverrides = null, explicitRuntimeOverrides = null) {
  const runtime = resolveAdminRuntimeOverrides(
    sliceCAdminRuntime,
    nextOrRuntimeOverrides,
    explicitRuntimeOverrides
  );
  const body = req.body || {};
  const { userId } = body;
  if (!validateObjectIdOrRespond(res, userId, "userId")) {
    return undefined;
  }

  const user = await runtime.findClientUserById(userId);
  if (!user) {
    return errorResponse(res, 404, "NOT_FOUND", "App user not found");
  }
  if (user.isActive === false) {
    return errorResponse(res, 409, "INVALID", "App user is inactive");
  }

  let quote;
  const lang = getRequestLang(req);
  try {
    quote = await runtime.resolveCheckoutQuoteOrThrow(body, {
      enforceActivePlan: true,
      lang,
      useGenericPremiumWallet:
        isPhase1CanonicalAdminCreateEnabled()
        && isPhase2GenericPremiumWalletEnabled(),
    });
  } catch (err) {
    const mapped = mapSubscriptionQuoteError(err);
    return errorResponse(res, mapped.status, mapped.code, mapped.message);
  }

  const session = await runtime.startSession();

  try {
    session.startTransaction();

    const daysCount = Number(quote.plan.daysCount || 0);
    const mealsPerDay = Number(quote.mealsPerDay || 0);
    if (!isPositiveInteger(daysCount) || !isPositiveInteger(mealsPerDay)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 400, "INVALID", "Resolved plan dimensions are invalid");
    }

    const startDate = quote.startDate ? new Date(quote.startDate) : new Date();
    const endDate = addDays(startDate, daysCount - 1);
    const totalMeals = daysCount * mealsPerDay;

    const premiumBalance = quote.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
      ? []
      : quote.premiumItems.map((item) => ({
        premiumMealId: item.premiumMeal._id,
        purchasedQty: Number(item.qty || 0),
        remainingQty: Number(item.qty || 0),
        unitExtraFeeHalala: Number(item.unitExtraFeeHalala || 0),
        currency: item.currency || "SAR",
      }));
    const genericPremiumBalance = quote.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
      ? buildGenericPremiumBalanceRows({
        premiumCount: Number(quote.premiumCount || 0),
        unitCreditPriceHalala: Number(quote.premiumUnitPriceHalala || 0),
        currency: "SAR",
        source: "subscription_purchase",
      })
      : [];
    const addonBalance = quote.addonItems.map((item) => ({
      addonId: item.addon._id,
      purchasedQty: Number(item.qty || 0),
      remainingQty: Number(item.qty || 0),
      unitPriceHalala: Number(item.unitPriceHalala || 0),
      currency: item.currency || "SAR",
    }));
    const addonSubscriptions = isPhase1CanonicalAdminCreateEnabled()
      ? buildRecurringAddonEntitlementsFromQuote({ addonItems: quote.addonItems, lang })
      : quote.addonItems
        .filter((item) => String(item && item.addon && item.addon.type ? item.addon.type : "subscription") !== "one_time")
        .map((item) => ({
          addonId: item.addon._id,
          name: pickLang(item.addon.name, lang) || null,
          price: minorUnitsToMajor(item.unitPriceHalala),
          type: item.addon.type || "subscription",
          category: item.addon.category || "",
          maxPerDay: 1,
        }));
    const premiumRemaining = quote.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
      ? genericPremiumBalance.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0)
      : premiumBalance.reduce((sum, row) => sum + Number(row.remainingQty || 0), 0);

    let subscription;
    if (isPhase1CanonicalAdminCreateEnabled()) {
      const contract = runtime.buildPhase1SubscriptionContract({
        payload: body,
        resolvedQuote: quote,
        actorContext: {
          actorRole: "admin",
          actorUserId: req.dashboardUserId || null,
          adminOverrideMeta: {
            createdByAdmin: true,
            dashboardUserRole: req.dashboardUserRole || null,
          },
        },
        source: "admin_create",
        now: new Date(),
      });

      subscription = await runtime.activateSubscriptionFromCanonicalContract({
        userId: user._id,
        planId: quote.plan._id,
        contract,
        legacyRuntimeData: {
          premiumWalletMode: quote.premiumWalletMode || LEGACY_PREMIUM_WALLET_MODE,
          premiumBalance,
          genericPremiumBalance,
          premiumPrice:
            quote.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
              ? Number(quote.premiumUnitPriceHalala || 0) / 100
              : 0,
          addonBalance,
          addonSubscriptions,
        },
        session,
      });
    } else {
      const createdRows = await Subscription.create(
        [{
          userId: user._id,
          planId: quote.plan._id,
          status: "active",
          startDate,
          endDate,
          validityEndDate: endDate,
          totalMeals,
          remainingMeals: totalMeals,
          premiumRemaining,
          premiumPrice:
            quote.premiumWalletMode === GENERIC_PREMIUM_WALLET_MODE
              ? Number(quote.premiumUnitPriceHalala || 0) / 100
              : 0,
          selectedGrams: quote.grams,
          selectedMealsPerDay: mealsPerDay,
          basePlanPriceHalala: Number(quote.breakdown.basePlanPriceHalala || 0),
          checkoutCurrency: quote.breakdown.currency || "SAR",
          premiumBalance,
          premiumWalletMode: quote.premiumWalletMode || LEGACY_PREMIUM_WALLET_MODE,
          genericPremiumBalance,
          addonBalance,
          addonSubscriptions,
          deliveryMode: quote.delivery.type,
          deliveryAddress: quote.delivery.address || undefined,
          deliveryWindow: quote.delivery.slot.window || undefined,
          deliverySlot: quote.delivery.slot || {
            type: quote.delivery.type,
            window: quote.delivery.slot.window || "",
            slotId: quote.delivery.slot.slotId || "",
          },
        }],
        { session }
      );
      subscription = createdRows[0];

      const dayEntries = [];
      for (let i = 0; i < daysCount; i += 1) {
        dayEntries.push(buildProjectedDayEntry({
          subscription,
          date: dateUtils.toKSADateString(addDays(startDate, i)),
          status: "open",
        }));
      }
      if (dayEntries.length > 0) {
        await SubscriptionDay.insertMany(dayEntries, { session });
      }
    }

    await session.commitTransaction();
    session.endSession();

    await runtime.writeActivityLogSafely({
      entityType: "subscription",
      entityId: subscription._id,
      action: "subscription_created_by_admin",
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta: {
        userId: String(user._id),
        planId: String(quote.plan._id),
        startDate: dateUtils.toKSADateString(startDate),
      },
    }, { subscriptionId: String(subscription._id) });

    return res.status(201).json({
      ok: true,
      data: await runtime.serializeSubscriptionAdmin(subscription.toObject(), lang, user),
      meta: {
        createdByAdmin: true,
      },
    });
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    if (err.code === "RECURRING_ADDON_CATEGORY_CONFLICT") {
      return errorResponse(res, 400, "INVALID", err.message);
    }
    logger.error("adminController.createSubscriptionAdmin failed", {
      error: err.message,
      stack: err.stack,
      userId: String(userId),
    });
    return errorResponse(res, 500, "INTERNAL", "Subscription creation failed");
  }
}

async function searchDashboard(req, res) {
  const rawQuery = req.query && req.query.q;
  const q = String(rawQuery || "").trim();
  if (q.length < 2) {
    return errorResponse(res, 400, "INVALID", "q must be at least 2 characters");
  }

  const limit = req.query && req.query.limit === undefined ? 5 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return errorResponse(res, 400, "INVALID", "limit must be an integer between 1 and 20");
  }

  const regex = new RegExp(escapeRegExp(q), "i");
  const normalizedQuery = q.toLowerCase();
  const exactObjectId = mongoose.Types.ObjectId.isValid(q) ? new mongoose.Types.ObjectId(q) : null;
  const displayOrderSuffix = parseAdminOrderDisplaySuffix(q);
  const lang = getRequestLang(req);

  const [users, plans, candidateOrders] = await Promise.all([
    User.find({
      role: "client",
      $or: [{ name: regex }, { phone: regex }, { email: regex }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Plan.find({
      $or: [{ "name.ar": regex }, { "name.en": regex }],
    })
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(limit)
      .lean(),
    exactObjectId
      ? Order.find({ _id: exactObjectId }).sort({ createdAt: -1 }).limit(1).lean()
      : displayOrderSuffix
        ? findOrdersByDisplaySuffix(displayOrderSuffix, limit)
        : Order.find({})
          .sort({ createdAt: -1 })
          .limit(100)
          .lean(),
  ]);

  const userIds = users.map((user) => user._id);
  const planIds = plans.map((plan) => plan._id);
  const subscriptionOrFilters = [
    ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
    ...(planIds.length ? [{ planId: { $in: planIds } }] : []),
    ...(exactObjectId ? [{ _id: exactObjectId }] : []),
  ];
  const [subscriptionRows, orderRows, userCounts] = await Promise.all([
    Subscription.find(subscriptionOrFilters.length ? { $or: subscriptionOrFilters } : { _id: { $exists: false } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Order.find({
      $or: [
        ...(userIds.length ? [{ userId: { $in: userIds } }] : []),
        { "items.name": regex },
        ...(exactObjectId ? [{ _id: exactObjectId }] : []),
      ],
    })
      .sort({ createdAt: -1 })
      .limit(limit * 5)
      .lean(),
    getSubscriptionCountsByUserIds(userIds),
  ]);

  const filteredOrders = (exactObjectId ? candidateOrders.concat(orderRows) : orderRows.concat(candidateOrders))
    .filter((order, index, list) => list.findIndex((item) => String(item._id) === String(order._id)) === index)
    .filter((order) => buildRecentOrderSearchKey(order).includes(normalizedQuery))
    .slice(0, limit);

  const extraUserIds = Array.from(new Set([
    ...subscriptionRows.map((row) => String(row.userId || "")).filter(Boolean),
    ...filteredOrders.map((row) => String(row.userId || "")).filter(Boolean),
  ]));
  const extraPlanIds = Array.from(new Set(subscriptionRows.map((row) => String(row.planId || "")).filter(Boolean)));
  const [userMap, planMap, subscriptionCatalog] = await Promise.all([
    buildUserMapByIds(extraUserIds),
    buildPlanMapByIds(extraPlanIds),
    loadSubscriptionSummaryCatalog(subscriptionRows, lang),
  ]);

  return res.status(200).json({
    ok: true,
    data: {
      q,
      users: users.map((user) => {
        const counts = userCounts.get(String(user._id)) || {};
        return serializeAppUserAdmin({
          coreUser: user,
          appUser: null,
          subscriptionsCount: counts.subscriptionsCount || 0,
          activeSubscriptionsCount: counts.activeSubscriptionsCount || 0,
        });
      }),
      subscriptions: subscriptionRows.map((subscription) =>
        serializeSubscriptionAdminFromCatalog(
          subscription,
          userMap.get(String(subscription.userId)) || null,
          subscriptionCatalog
        )),
      orders: filteredOrders.map((order) => ({
        id: String(order._id),
        displayId: buildAdminOrderDisplayId(order),
        user: serializeClientUserSummary(userMap.get(String(order.userId)) || null),
        itemsSummary: buildOrderItemsSummary(order, lang),
        status: order.status,
        date: order.deliveryDate || null,
        amountDisplay: formatAmountDisplay(
          order.pricing && order.pricing.total,
          order.pricing && order.pricing.currency,
          lang
        ),
      })),
      plans: plans.map((plan) => ({
        id: String(plan._id),
        name: pickLang(plan.name, lang) || null,
        currency: normalizeCurrencyValue(plan.currency),
        daysCount: Number(plan.daysCount || 0),
        isActive: plan.isActive !== false,
      })),
    },
  });
}

async function getDashboardNotificationSummary(req, res) {
  const rawLimit = req.query && req.query.limit;
  const limit = rawLimit === undefined ? 5 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return errorResponse(res, 400, "INVALID", "limit must be an integer between 1 and 20");
  }

  const last24h = new Date(Date.now() - (24 * 60 * 60 * 1000));
  const last7d = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));

  const [recentNotifications, recentActivity, unreadCount, failedCount, processingCount] = await Promise.all([
    NotificationLog.find().sort({ createdAt: -1 }).limit(limit).lean(),
    ActivityLog.find().sort({ createdAt: -1 }).limit(limit).lean(),
    NotificationLog.countDocuments({ createdAt: { $gte: last24h } }),
    NotificationLog.countDocuments({ status: "failed", createdAt: { $gte: last7d } }),
    NotificationLog.countDocuments({ status: "processing" }),
  ]);

  return res.status(200).json({
    ok: true,
    data: {
      unreadCount: Number(unreadCount || 0),
      unreadWindowHours: 24,
      failedCount: Number(failedCount || 0),
      processingCount: Number(processingCount || 0),
      recent: recentNotifications.map((item) => ({
        id: String(item._id),
        title: item.title,
        body: item.body,
        type: item.type || null,
        status: item.status,
        entityType: item.entityType || null,
        entityId: item.entityId ? String(item.entityId) : null,
        createdAt: item.createdAt || null,
      })),
      recentActivity: recentActivity.map((item) => ({
        id: String(item._id),
        action: item.action,
        entityType: item.entityType,
        entityId: String(item.entityId),
        byRole: item.byRole || null,
        createdAt: item.createdAt || null,
      })),
    },
  });
}

async function getTodayReport(req, res) {
  const today = dateUtils.getTodayKSADate();
  const { start, end } = buildKsaDayUtcRange(today);
  const lang = getRequestLang(req);

  const [
    newSubscriptionsToday,
    paidPaymentsToday,
    todayOrders,
    todayDays,
    recentTodayOrders,
    recentTodaySubscriptions,
    failedNotifications,
    activeSubscriptions,
  ] = await Promise.all([
    Subscription.countDocuments({ createdAt: { $gte: start, $lt: end } }),
    Payment.aggregate([
      {
        $match: {
          status: "paid",
          paidAt: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalAmountMinorUnits: { $sum: "$amount" },
          paymentsCount: { $sum: 1 },
        },
      },
    ]),
    Order.find({ deliveryDate: today }).sort({ createdAt: -1 }).limit(10).lean(),
    SubscriptionDay.find({ date: today }).sort({ createdAt: -1 }).limit(200).lean(),
    Order.find({ deliveryDate: today }).sort({ createdAt: -1 }).limit(5).lean(),
    Subscription.find({
      $or: [
        { createdAt: { $gte: start, $lt: end } },
        { startDate: { $gte: start, $lt: end } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    NotificationLog.countDocuments({ status: "failed", createdAt: { $gte: start, $lt: end } }),
    Subscription.countDocuments({ status: "active" }),
  ]);

  const todayOrderStatuses = todayOrders.reduce((acc, order) => {
    acc[order.status] = Number(acc[order.status] || 0) + 1;
    return acc;
  }, {});
  const todayDayStatuses = todayDays.reduce((acc, day) => {
    acc[day.status] = Number(acc[day.status] || 0) + 1;
    return acc;
  }, {});

  const todaysUserIds = Array.from(new Set([
    ...recentTodayOrders.map((row) => String(row.userId || "")).filter(Boolean),
    ...recentTodaySubscriptions.map((row) => String(row.userId || "")).filter(Boolean),
  ]));
  const todaysPlanIds = Array.from(new Set(recentTodaySubscriptions.map((row) => String(row.planId || "")).filter(Boolean)));
  const [userMap, planMap] = await Promise.all([
    buildUserMapByIds(todaysUserIds),
    buildPlanMapByIds(todaysPlanIds),
  ]);

  const paymentsSummary = paidPaymentsToday[0] || { totalAmountMinorUnits: 0, paymentsCount: 0 };
  const deliveredOrdersToday = todayOrders.filter((order) => order.status === "fulfilled").length;
  const deliveredSubscriptionDaysToday = todayDays.filter((day) => day.status === "fulfilled").length;

  const payload = {
    today,
    generatedAt: new Date().toISOString(),
    summary: {
      activeSubscriptions: Number(activeSubscriptions || 0),
      newSubscriptionsToday: Number(newSubscriptionsToday || 0),
      ordersToday: Number(todayOrders.length || 0),
      deliveredToday: Number(deliveredOrdersToday + deliveredSubscriptionDaysToday),
      paidPaymentsCount: Number(paymentsSummary.paymentsCount || 0),
      revenueMinorUnits: Number(paymentsSummary.totalAmountMinorUnits || 0),
      revenue: minorUnitsToMajor(paymentsSummary.totalAmountMinorUnits || 0),
      revenueDisplay: formatAmountDisplay(paymentsSummary.totalAmountMinorUnits || 0, "SAR", lang),
      failedNotifications: Number(failedNotifications || 0),
    },
    ordersByStatus: todayOrderStatuses,
    subscriptionDaysByStatus: todayDayStatuses,
    recentOrders: recentTodayOrders.map((order) => ({
      id: String(order._id),
      displayId: buildAdminOrderDisplayId(order),
      userName: (userMap.get(String(order.userId)) || {}).name || null,
      itemsSummary: buildOrderItemsSummary(order, lang),
      status: order.status,
      date: order.deliveryDate || null,
      amountDisplay: formatAmountDisplay(
        order.pricing && order.pricing.total,
        order.pricing && order.pricing.currency,
        lang
      ),
    })),
    recentSubscriptions: recentTodaySubscriptions.map((subscription) => {
      const user = userMap.get(String(subscription.userId)) || null;
      const plan = planMap.get(String(subscription.planId)) || null;
      return {
        id: String(subscription._id),
        userName: user ? user.name || null : null,
        planName: plan ? pickLang(plan.name, lang) || null : null,
        status: subscription.status,
        startDate: subscription.startDate ? dateUtils.toKSADateString(subscription.startDate) : null,
        amountDisplay: formatAmountDisplay(subscription.basePlanPriceHalala, subscription.checkoutCurrency, lang),
      };
    }),
  };

  if (String(req.query && req.query.download || "") === "1") {
    res.setHeader("Content-Disposition", `attachment; filename=\"dashboard-report-${today}.json\"`);
  }

  return res.status(200).json({ ok: true, data: payload });
}

async function listPlansAdmin(req, res) {
  try {
    const filters = resolveAdminPlanFiltersOrThrow(req.query || {});
    const plans = await Plan.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
    const filteredPlans = filterAdminPlans(plans, filters).map((plan) => serializeAdminPlan(plan));

    return res.status(200).json({
      ok: true,
      data: filteredPlans,
      summary: buildAdminPlanSummary(plans),
      meta: {
        q: filters.q,
        status: filters.normalizedStatus || "all",
        totalCount: plans.length,
        filteredCount: filteredPlans.length,
      },
    });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function getPlanAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }
  const plan = await Plan.findById(id).lean();
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  return res.status(200).json({ ok: true, data: serializeAdminPlan(plan) });
}

async function createPlan(req, res) {
  try {
    const normalizedPayload = validatePlanPayloadOrThrow(req.body || {}, { requireGramsOptions: true });
    const plan = await Plan.create(normalizedPayload);
    return res.status(201).json({ ok: true, data: { id: plan.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updatePlan(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  try {
    const normalizedPayload = validatePlanPayloadOrThrow(req.body || {}, { requireGramsOptions: true });
    const updated = await Plan.findByIdAndUpdate(
      id,
      { $set: normalizedPayload, $unset: LEGACY_PLAN_FIELDS_TO_UNSET },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }

    return res.status(200).json({ ok: true, data: { id: updated.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deletePlan(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const deleted = await Plan.findByIdAndDelete(id).lean();
  if (!deleted) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }

  return res.status(200).json({ ok: true });
}

async function togglePlanActive(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  plan.isActive = !plan.isActive;
  await plan.save();

  return res.status(200).json({ ok: true, data: { id: plan.id, isActive: plan.isActive } });
}

async function updatePlanSortOrder(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");
    const updated = await Plan.findByIdAndUpdate(id, { sortOrder }, { new: true, runValidators: true });
    if (!updated) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    return res.status(200).json({ ok: true, data: { id: updated.id, sortOrder: updated.sortOrder } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function clonePlan(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const existing = await Plan.findById(id).lean();
  if (!existing) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }

  try {
    const normalizedPayload = validatePlanPayloadOrThrow(
      {
        name: existing.name,
        daysCount: existing.daysCount,
        currency: existing.currency,
        gramsOptions: existing.gramsOptions,
        skipPolicy: existing.skipPolicy,
        freezePolicy: existing.freezePolicy,
        isActive: existing.isActive,
        sortOrder: existing.sortOrder,
      },
      { requireGramsOptions: true }
    );

    const cloned = await Plan.create(normalizedPayload);
    return res.status(201).json({ ok: true, data: { id: cloned.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function createGramsRow(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  try {
    const normalizedPayload = validateGramsOptionPayloadOrThrow(req.body || {}, {
      fieldPath: "body",
      requireMealsOptions: true,
    });

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }
    if (findGramsIndex(plan, normalizedPayload.grams) !== -1) {
      return errorResponse(res, 409, "CONFLICT", `Grams option ${normalizedPayload.grams} already exists`);
    }

    plan.gramsOptions.push(normalizedPayload);
    await plan.save();

    return res.status(201).json({
      ok: true,
      data: {
        id: plan.id,
        grams: normalizedPayload.grams,
      },
    });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function cloneGramsRow(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  try {
    const grams = parsePositiveIntegerOrThrow(req.body && req.body.grams, "grams");
    const newGrams = parsePositiveIntegerOrThrow(req.body && req.body.newGrams, "newGrams");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const sourceIndex = findGramsIndex(plan, grams);
    if (sourceIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    if (findGramsIndex(plan, newGrams) !== -1) {
      return errorResponse(res, 409, "CONFLICT", `Grams option ${newGrams} already exists`);
    }

    const source = plan.gramsOptions[sourceIndex];
    const sourceMeals = Array.isArray(source.mealsOptions) ? source.mealsOptions : [];
    const clonedMeals = sourceMeals.map((mealOption) => ({
      mealsPerDay: mealOption.mealsPerDay,
      priceHalala: mealOption.priceHalala,
      compareAtHalala: mealOption.compareAtHalala,
      isActive: mealOption.isActive,
      sortOrder: mealOption.sortOrder,
    }));

    plan.gramsOptions.push({
      grams: newGrams,
      mealsOptions: clonedMeals,
      isActive: source.isActive,
      sortOrder: source.sortOrder,
    });

    await plan.save();
    return res.status(201).json({ ok: true, data: { id: plan.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteGramsRow(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }
  if (plan.gramsOptions.length === 0) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  if (plan.gramsOptions.length <= 1) {
    return errorResponse(res, 400, "INVALID", "Cannot delete the last grams option");
  }

  plan.gramsOptions.splice(gramsIndex, 1);
  await plan.save();

  return res.status(200).json({ ok: true });
}

async function toggleGramsRow(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  plan.gramsOptions[gramsIndex].isActive = !plan.gramsOptions[gramsIndex].isActive;
  await plan.save();

  return res.status(200).json({
    ok: true,
    data: {
      id: plan.id,
      grams,
      isActive: plan.gramsOptions[gramsIndex].isActive,
    },
  });
}

async function updateGramsSortOrder(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const gramsIndex = findGramsIndex(plan, grams);
    if (gramsIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    plan.gramsOptions[gramsIndex].sortOrder = sortOrder;
    await plan.save();

    return res.status(200).json({ ok: true, data: { id: plan.id, grams, sortOrder } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function cloneMealsOption(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  try {
    const mealsPerDay = parsePositiveIntegerOrThrow(req.body && req.body.mealsPerDay, "mealsPerDay");
    const newMealsPerDay = parsePositiveIntegerOrThrow(req.body && req.body.newMealsPerDay, "newMealsPerDay");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const gramsIndex = findGramsIndex(plan, grams);
    if (gramsIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    const gramsOption = plan.gramsOptions[gramsIndex];
    const sourceIndex = findMealsIndex(gramsOption, mealsPerDay);
    if (sourceIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
    }

    if (findMealsIndex(gramsOption, newMealsPerDay) !== -1) {
      return errorResponse(
        res,
        409,
        "CONFLICT",
        `Meals option ${newMealsPerDay} already exists in grams ${grams}`
      );
    }

    const source = gramsOption.mealsOptions[sourceIndex];
    gramsOption.mealsOptions.push({
      mealsPerDay: newMealsPerDay,
      priceHalala: source.priceHalala,
      compareAtHalala: source.compareAtHalala,
      isActive: source.isActive,
      sortOrder: source.sortOrder,
    });

    await plan.save();
    return res.status(201).json({ ok: true, data: { id: plan.id } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function createMealsOption(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }

  try {
    const normalizedPayload = validateMealsOptionPayloadOrThrow(req.body || {}, "body");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const gramsIndex = findGramsIndex(plan, grams);
    if (gramsIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    const gramsOption = plan.gramsOptions[gramsIndex];
    if (!Array.isArray(gramsOption.mealsOptions)) {
      gramsOption.mealsOptions = [];
    }
    if (findMealsIndex(gramsOption, normalizedPayload.mealsPerDay) !== -1) {
      return errorResponse(
        res,
        409,
        "CONFLICT",
        `Meals option ${normalizedPayload.mealsPerDay} already exists in grams ${grams}`
      );
    }

    gramsOption.mealsOptions.push(normalizedPayload);
    await plan.save();

    return res.status(201).json({
      ok: true,
      data: {
        id: plan.id,
        grams,
        mealsPerDay: normalizedPayload.mealsPerDay,
      },
    });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function deleteMealsOption(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }
  const mealsPerDay = parsePathPositiveIntegerOrRespond(res, req.params.mealsPerDay, "mealsPerDay");
  if (mealsPerDay === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  const gramsOption = plan.gramsOptions[gramsIndex];
  const mealIndex = findMealsIndex(gramsOption, mealsPerDay);
  if (mealIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
  }

  if (gramsOption.mealsOptions.length <= 1) {
    return errorResponse(res, 400, "INVALID", "Cannot delete the last meals option for this grams row");
  }

  gramsOption.mealsOptions.splice(mealIndex, 1);
  await plan.save();

  return res.status(200).json({ ok: true });
}

async function toggleMealsOption(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }
  const mealsPerDay = parsePathPositiveIntegerOrRespond(res, req.params.mealsPerDay, "mealsPerDay");
  if (mealsPerDay === null) {
    return undefined;
  }

  const plan = await Plan.findById(id);
  if (!plan) {
    return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
  }
  if (!Array.isArray(plan.gramsOptions)) {
    plan.gramsOptions = [];
  }

  const gramsIndex = findGramsIndex(plan, grams);
  if (gramsIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
  }

  const gramsOption = plan.gramsOptions[gramsIndex];
  const mealIndex = findMealsIndex(gramsOption, mealsPerDay);
  if (mealIndex === -1) {
    return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
  }

  gramsOption.mealsOptions[mealIndex].isActive = !gramsOption.mealsOptions[mealIndex].isActive;
  await plan.save();

  return res.status(200).json({
    ok: true,
    data: {
      id: plan.id,
      grams,
      mealsPerDay,
      isActive: gramsOption.mealsOptions[mealIndex].isActive,
    },
  });
}

async function updateMealsSortOrder(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const grams = parsePathPositiveIntegerOrRespond(res, req.params.grams, "grams");
  if (grams === null) {
    return undefined;
  }
  const mealsPerDay = parsePathPositiveIntegerOrRespond(res, req.params.mealsPerDay, "mealsPerDay");
  if (mealsPerDay === null) {
    return undefined;
  }

  try {
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");

    const plan = await Plan.findById(id);
    if (!plan) {
      return errorResponse(res, 404, "NOT_FOUND", "Plan not found");
    }
    if (!Array.isArray(plan.gramsOptions)) {
      plan.gramsOptions = [];
    }

    const gramsIndex = findGramsIndex(plan, grams);
    if (gramsIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Grams option ${grams} not found`);
    }

    const gramsOption = plan.gramsOptions[gramsIndex];
    const mealIndex = findMealsIndex(gramsOption, mealsPerDay);
    if (mealIndex === -1) {
      return errorResponse(res, 404, "NOT_FOUND", `Meals option ${mealsPerDay} not found in grams ${grams}`);
    }

    gramsOption.mealsOptions[mealIndex].sortOrder = sortOrder;
    await plan.save();

    return res.status(200).json({ ok: true, data: { id: plan.id, grams, mealsPerDay, sortOrder } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function persistSettingValue(key, value, extra = {}) {
  await Setting.findOneAndUpdate(
    { key },
    { key, value, ...extra },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

function normalizeCutoffTimeOrThrow(time) {
  if (!time) {
    throw createControlledError(400, "INVALID", "Missing time");
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw createControlledError(400, "INVALID", "Invalid time format, expected HH:mm");
  }
  const [hours, minutes] = time.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw createControlledError(400, "INVALID", "Invalid time value");
  }
  return time;
}

function normalizeDeliveryWindowsOrThrow(windows) {
  if (!windows || !Array.isArray(windows)) {
    throw createControlledError(400, "INVALID", "Missing windows array");
  }
  const normalized = windows.map((window) => (typeof window === "string" ? window.trim() : window));
  if (!normalized.every((window) => isValidWindowRange(window))) {
    throw createControlledError(400, "INVALID", "Each window must match HH:mm-HH:mm");
  }
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw createControlledError(400, "INVALID", "Duplicate delivery windows are not allowed");
  }
  return normalized;
}

function normalizeSkipAllowanceOrThrow(rawValue) {
  if (rawValue === undefined) {
    throw createControlledError(400, "INVALID", "Missing skipAllowance");
  }
  const parsedDays = Number(rawValue);
  if (!Number.isInteger(parsedDays) || parsedDays < 0) {
    throw createControlledError(400, "INVALID", "skipAllowance must be an integer >= 0");
  }
  return parsedDays;
}

function normalizePremiumPriceOrThrow(price) {
  if (price === undefined) {
    throw createControlledError(400, "INVALID", "Missing price");
  }
  const parsedPrice = Number(price);
  if (!Number.isFinite(parsedPrice)) {
    throw createControlledError(400, "INVALID", "price must be a finite number");
  }
  if (parsedPrice <= 0) {
    throw createControlledError(400, "INVALID", "price must be greater than 0");
  }
  if (parsedPrice > MAX_PREMIUM_PRICE) {
    throw createControlledError(400, "INVALID", `price must be <= ${MAX_PREMIUM_PRICE}`);
  }
  return parsedPrice;
}

function normalizeSubscriptionDeliveryFeeHalalaOrThrow(value) {
  if (value === undefined) {
    throw createControlledError(400, "INVALID", "Missing deliveryFeeHalala");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw createControlledError(400, "INVALID", "deliveryFeeHalala must be an integer >= 0");
  }
  return parsed;
}

function normalizeVatPercentageOrThrow(value) {
  if (value === undefined) {
    throw createControlledError(400, "INVALID", "Missing percentage");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createControlledError(400, "INVALID", "percentage must be a finite number");
  }
  if (parsed < 0 || parsed > MAX_VAT_PERCENTAGE) {
    throw createControlledError(400, "INVALID", `percentage must be between 0 and ${MAX_VAT_PERCENTAGE}`);
  }
  return parsed;
}

function normalizeCustomSaladBasePriceOrThrow(price) {
  if (price === undefined) {
    throw createControlledError(400, "INVALID", "Missing price");
  }
  const parsed = Number(price);
  if (!Number.isFinite(parsed)) {
    throw createControlledError(400, "INVALID", "price must be a finite number");
  }
  if (parsed < 0) {
    throw createControlledError(400, "INVALID", "price must be >= 0");
  }
  if (parsed > MAX_PREMIUM_PRICE) {
    throw createControlledError(400, "INVALID", `price must be <= ${MAX_PREMIUM_PRICE}`);
  }
  return parsed;
}

function normalizeCustomMealBasePriceOrThrow(price) {
  if (price === undefined) {
    throw createControlledError(400, "INVALID", "Missing price");
  }
  const parsed = Number(price);
  if (!Number.isFinite(parsed)) {
    throw createControlledError(400, "INVALID", "price must be a finite number");
  }
  if (parsed < 0) {
    throw createControlledError(400, "INVALID", "price must be >= 0");
  }
  if (parsed > MAX_PREMIUM_PRICE) {
    throw createControlledError(400, "INVALID", `price must be <= ${MAX_PREMIUM_PRICE}`);
  }
  return parsed;
}

async function persistNormalizedSettings(normalizedSettings) {
  const persisted = {};
  const operations = [];

  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "cutoff_time")) {
    operations.push(persistSettingValue("cutoff_time", normalizedSettings.cutoff_time));
    persisted.cutoff_time = normalizedSettings.cutoff_time;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "delivery_windows")) {
    operations.push(persistSettingValue("delivery_windows", normalizedSettings.delivery_windows));
    persisted.delivery_windows = normalizedSettings.delivery_windows;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "skip_allowance")) {
    operations.push(
      persistSettingValue("skipAllowance", normalizedSettings.skip_allowance, {
        skipAllowance: normalizedSettings.skip_allowance,
      })
    );
    persisted.skip_allowance = normalizedSettings.skip_allowance;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "premium_price")) {
    operations.push(persistSettingValue("premium_price", normalizedSettings.premium_price));
    persisted.premium_price = normalizedSettings.premium_price;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "subscription_delivery_fee_halala")) {
    operations.push(
      persistSettingValue("subscription_delivery_fee_halala", normalizedSettings.subscription_delivery_fee_halala)
    );
    persisted.subscription_delivery_fee_halala = normalizedSettings.subscription_delivery_fee_halala;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "vat_percentage")) {
    operations.push(persistSettingValue("vat_percentage", normalizedSettings.vat_percentage));
    persisted.vat_percentage = normalizedSettings.vat_percentage;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "custom_salad_base_price")) {
    operations.push(persistSettingValue("custom_salad_base_price", normalizedSettings.custom_salad_base_price));
    persisted.custom_salad_base_price = normalizedSettings.custom_salad_base_price;
  }
  if (Object.prototype.hasOwnProperty.call(normalizedSettings, "custom_meal_base_price")) {
    operations.push(persistSettingValue("custom_meal_base_price", normalizedSettings.custom_meal_base_price));
    persisted.custom_meal_base_price = normalizedSettings.custom_meal_base_price;
  }

  await Promise.all(operations);
  return persisted;
}

function normalizeSettingsPatchPayloadOrThrow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createControlledError(400, "INVALID", "Request body must be an object");
  }

  const allowedKeys = new Set([
    "cutoff_time",
    "delivery_windows",
    "skip_allowance",
    "premium_price",
    "subscription_delivery_fee_halala",
    "vat_percentage",
    "custom_salad_base_price",
    "custom_meal_base_price",
  ]);
  const providedKeys = Object.keys(payload);
  if (!providedKeys.length) {
    throw createControlledError(400, "INVALID", "At least one setting is required");
  }

  const unknownKeys = providedKeys.filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw createControlledError(400, "INVALID", `Unsupported setting keys: ${unknownKeys.join(", ")}`);
  }

  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(payload, "cutoff_time")) {
    normalized.cutoff_time = normalizeCutoffTimeOrThrow(payload.cutoff_time);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "delivery_windows")) {
    normalized.delivery_windows = normalizeDeliveryWindowsOrThrow(payload.delivery_windows);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "skip_allowance")) {
    normalized.skip_allowance = normalizeSkipAllowanceOrThrow(payload.skip_allowance);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "premium_price")) {
    normalized.premium_price = normalizePremiumPriceOrThrow(payload.premium_price);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "subscription_delivery_fee_halala")) {
    normalized.subscription_delivery_fee_halala = normalizeSubscriptionDeliveryFeeHalalaOrThrow(
      payload.subscription_delivery_fee_halala
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, "vat_percentage")) {
    normalized.vat_percentage = normalizeVatPercentageOrThrow(payload.vat_percentage);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "custom_salad_base_price")) {
    normalized.custom_salad_base_price = normalizeCustomSaladBasePriceOrThrow(payload.custom_salad_base_price);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "custom_meal_base_price")) {
    normalized.custom_meal_base_price = normalizeCustomMealBasePriceOrThrow(payload.custom_meal_base_price);
  }

  return normalized;
}

async function updateCutoff(req, res) {
  try {
    const normalized = normalizeCutoffTimeOrThrow((req.body || {}).time);
    await persistNormalizedSettings({ cutoff_time: normalized });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateDeliveryWindows(req, res) {
  try {
    const normalized = normalizeDeliveryWindowsOrThrow((req.body || {}).windows);
    await persistNormalizedSettings({ delivery_windows: normalized });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateSkipAllowance(req, res) {
  try {
    const { days, skipAllowance } = req.body || {};
    const rawValue = skipAllowance !== undefined ? skipAllowance : days;
    const normalized = normalizeSkipAllowanceOrThrow(rawValue);
    await persistNormalizedSettings({ skip_allowance: normalized });
    return res.status(200).json({ ok: true, data: { skipAllowance: normalized } });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updatePremiumPrice(req, res) {
  try {
    const normalized = normalizePremiumPriceOrThrow((req.body || {}).price);
    await persistNormalizedSettings({ premium_price: normalized });
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateSubscriptionDeliveryFee(req, res) {
  try {
    const body = req.body || {};
    const rawValue = body.deliveryFeeHalala !== undefined
      ? body.deliveryFeeHalala
      : body.subscription_delivery_fee_halala;
    const normalized = normalizeSubscriptionDeliveryFeeHalalaOrThrow(rawValue);
    const persisted = await persistNormalizedSettings({ subscription_delivery_fee_halala: normalized });
    return res.status(200).json({ ok: true, data: persisted });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateVatPercentage(req, res) {
  try {
    const body = req.body || {};
    const rawValue = body.percentage !== undefined ? body.percentage : body.vat_percentage;
    const normalized = normalizeVatPercentageOrThrow(rawValue);
    const persisted = await persistNormalizedSettings({ vat_percentage: normalized });
    return res.status(200).json({ ok: true, data: persisted });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateCustomSaladBasePrice(req, res) {
  try {
    const body = req.body || {};
    const rawValue = body.price !== undefined ? body.price : body.custom_salad_base_price;
    const normalized = normalizeCustomSaladBasePriceOrThrow(rawValue);
    const persisted = await persistNormalizedSettings({ custom_salad_base_price: normalized });
    return res.status(200).json({ ok: true, data: persisted });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function updateCustomMealBasePrice(req, res) {
  try {
    const body = req.body || {};
    const rawValue = body.price !== undefined ? body.price : body.custom_meal_base_price;
    const normalized = normalizeCustomMealBasePriceOrThrow(rawValue);
    const persisted = await persistNormalizedSettings({ custom_meal_base_price: normalized });
    return res.status(200).json({ ok: true, data: persisted });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function patchSettings(req, res) {
  try {
    const normalized = normalizeSettingsPatchPayloadOrThrow(req.body || {});
    const persisted = await persistNormalizedSettings(normalized);
    return res.status(200).json({ ok: true, data: persisted });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function listDashboardUsers(req, res) {
  const pagination = resolvePaginationOrRespond(res, req.query || {});
  if (!pagination) {
    return undefined;
  }
  const skip = (pagination.page - 1) * pagination.limit;
  const [users, total] = await Promise.all([
    DashboardUser.find()
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    DashboardUser.countDocuments(),
  ]);

  return res.status(200).json({
    ok: true,
    data: users.map((user) => serializeDashboardUserAdmin(user)),
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
}

async function listAppUsers(req, res) {
  const pagination = resolvePaginationOrRespond(res, req.query || {});
  if (!pagination) {
    return undefined;
  }
  const skip = (pagination.page - 1) * pagination.limit;
  const [users, total] = await Promise.all([
    User.find({ role: "client" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    User.countDocuments({ role: "client" }),
  ]);
  const userIds = users.map((user) => user._id);
  const phones = users.map((user) => user.phone).filter(Boolean);
  const [appUsers, countsByUserId] = await Promise.all([
    userIds.length > 0
      ? AppUser.find({
        $or: [{ coreUserId: { $in: userIds } }, { phone: { $in: phones } }],
      }).lean()
      : Promise.resolve([]),
    getSubscriptionCountsByUserIds(userIds),
  ]);
  const { byCoreUserId, byPhone } = buildAppUserMaps(appUsers);

  return res.status(200).json({
    ok: true,
    data: users.map((user) => {
      const appUser = byCoreUserId.get(String(user._id)) || byPhone.get(user.phone) || null;
      const counts = countsByUserId.get(String(user._id)) || {};
      return serializeAppUserAdmin({
        coreUser: user,
        appUser,
        subscriptionsCount: counts.subscriptionsCount || 0,
        activeSubscriptionsCount: counts.activeSubscriptionsCount || 0,
      });
    }),
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
}

async function getAppUser(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const result = await findManagedAppUserById(id);
  if (!result) {
    return errorResponse(res, 404, "NOT_FOUND", "App user not found");
  }

  const countsByUserId = await getSubscriptionCountsByUserIds([result.coreUser._id]);
  const counts = countsByUserId.get(String(result.coreUser._id)) || {};

  return res.status(200).json({
    ok: true,
    data: serializeAppUserAdmin({
      coreUser: result.coreUser,
      appUser: result.appUser,
      subscriptionsCount: counts.subscriptionsCount || 0,
      activeSubscriptionsCount: counts.activeSubscriptionsCount || 0,
    }),
  });
}

async function updateAppUser(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const body = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(body, "isActive")) {
    return errorResponse(res, 400, "INVALID", "isActive is required");
  }
  if (typeof body.isActive !== "boolean") {
    return errorResponse(res, 400, "INVALID", "isActive must be a boolean");
  }

  const result = await findManagedAppUserById(id);
  if (!result) {
    return errorResponse(res, 404, "NOT_FOUND", "App user not found");
  }

  const user = await User.findOne({ _id: result.coreUser._id, role: "client" });
  if (!user) {
    return errorResponse(res, 404, "NOT_FOUND", "App user not found");
  }

  user.isActive = body.isActive;
  await user.save();

  const countsByUserId = await getSubscriptionCountsByUserIds([user._id]);
  const counts = countsByUserId.get(String(user._id)) || {};

  return res.status(200).json({
    ok: true,
    data: serializeAppUserAdmin({
      coreUser: user,
      appUser: result.appUser,
      subscriptionsCount: counts.subscriptionsCount || 0,
      activeSubscriptionsCount: counts.activeSubscriptionsCount || 0,
    }),
  });
}

async function listAppUserSubscriptions(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const result = await findManagedAppUserById(id);
  if (!result) {
    return errorResponse(res, 404, "NOT_FOUND", "App user not found");
  }

  const subscriptions = await Subscription.find({ userId: result.coreUser._id }).sort({ createdAt: -1 }).lean();
  const lang = getRequestLang(req);
  const catalog = await loadSubscriptionSummaryCatalog(subscriptions, lang);
  const data = subscriptions.map((subscription) => serializeSubscriptionForClientFromCatalog(subscription, catalog));

  return res.status(200).json({ ok: true, data });
}

async function listSubscriptionsAdmin(req, res) {
  try {
    const lang = getRequestLang(req);
    const payload = await SubscriptionOperationsReadService.performAdminSubscriptionsSearch({
      ...(req.query || {}),
      lang,
    });

    return res.status(200).json({
      ok: true,
      data: payload.data,
      meta: buildPaginationMeta(payload.pagination.page, payload.pagination.limit, payload.total),
      filters: {
        q: payload.filters.q,
        status: payload.filters.normalizedStatus,
        from: payload.filters.from,
        to: payload.filters.to,
      },
    });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function getSubscriptionsSummaryAdmin(req, res) {
  try {
    const filters = await SubscriptionOperationsReadService.resolveAdminSubscriptionFiltersOrThrow(req.query || {}, { includeStatus: false });
    const selectedStatus = SubscriptionOperationsReadService.normalizeAdminSubscriptionStatusOrThrow(req.query && req.query.status);
    const selectedStatusMatch = selectedStatus
      ? (selectedStatus === "ended" ? { status: { $in: ["expired", "canceled"] } } : { status: selectedStatus })
      : {};
    const [totalSubscriptions, activeSubscriptions, pendingSubscriptions, expiredSubscriptions, canceledSubscriptions, remainingMealsRows, selectedStatusCount] = await Promise.all([
      Subscription.countDocuments(filters.match),
      Subscription.countDocuments({ ...filters.match, status: "active" }),
      Subscription.countDocuments({ ...filters.match, status: "pending_payment" }),
      Subscription.countDocuments({ ...filters.match, status: "expired" }),
      Subscription.countDocuments({ ...filters.match, status: "canceled" }),
      Subscription.aggregate([
        { $match: filters.match },
        {
          $group: {
            _id: null,
            totalRemainingMeals: { $sum: { $ifNull: ["$remainingMeals", 0] } },
          },
        },
      ]),
      selectedStatus
        ? Subscription.countDocuments({ ...filters.match, ...selectedStatusMatch })
        : Promise.resolve(null),
    ]);

    return res.status(200).json({
      ok: true,
      data: {
        filters: {
          q: filters.q,
          status: selectedStatus,
          from: filters.from,
          to: filters.to,
        },
        summary: {
          totalSubscriptions: Number(totalSubscriptions || 0),
          activeSubscriptions: Number(activeSubscriptions || 0),
          pendingSubscriptions: Number(pendingSubscriptions || 0),
          expiredSubscriptions: Number(expiredSubscriptions || 0),
          canceledSubscriptions: Number(canceledSubscriptions || 0),
          endedSubscriptions: Number(expiredSubscriptions || 0) + Number(canceledSubscriptions || 0),
          selectedStatusCount: selectedStatus ? Number(selectedStatusCount || 0) : null,
          totalRemainingMeals: Number((remainingMealsRows[0] && remainingMealsRows[0].totalRemainingMeals) || 0),
        },
      },
    });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function exportSubscriptionsAdmin(req, res) {
  try {
    const lang = getRequestLang(req);
    const payload = await SubscriptionOperationsReadService.fetchAdminSubscriptionsPayload(
      { ...(req.query || {}), lang },
      { paginate: false, includeStatus: true }
    );
    const today = dateUtils.getTodayKSADate();
    res.setHeader("Content-Disposition", `attachment; filename=\"subscriptions-export-${today}.json\"`);

    return res.status(200).json({
      ok: true,
      data: {
        exportedAt: new Date().toISOString(),
        filters: {
          q: payload.filters.q,
          status: payload.filters.normalizedStatus,
          from: payload.filters.from,
          to: payload.filters.to,
        },
        count: payload.total,
        items: payload.data,
      },
    });
  } catch (err) {
    if (isControlledError(err)) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function getDashboardOverview(req, res) {
  const rawLimit = req.query && req.query.limit;
  const limit = rawLimit === undefined ? 5 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    return errorResponse(res, 400, "INVALID", "limit must be an integer between 1 and 20");
  }

  const lang = getRequestLang(req);
  const today = dateUtils.getTodayKSADate();

  const [
    activeSubscriptions,
    appUsers,
    pendingOrders,
    subscriptionDeliveryRows,
    orderDeliveriesToday,
    recentSubscriptions,
    recentOrders,
  ] = await Promise.all([
    Subscription.countDocuments({ status: "active" }),
    User.countDocuments({ role: "client" }),
    Order.countDocuments({ status: { $in: NON_TERMINAL_ORDER_STATUSES } }),
    SubscriptionDay.aggregate([
      {
        $match: {
          date: today,
          status: { $nin: ["frozen", "skipped"] },
        },
      },
      {
        $lookup: {
          from: "subscriptions",
          localField: "subscriptionId",
          foreignField: "_id",
          as: "subscription",
        },
      },
      { $unwind: "$subscription" },
      {
        $match: {
          "subscription.status": "active",
          "subscription.deliveryMode": "delivery",
        },
      },
      { $count: "count" },
    ]),
    Order.countDocuments({
      deliveryDate: today,
      deliveryMode: "delivery",
      status: { $ne: "canceled" },
    }),
    Subscription.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Order.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  const combinedUserIds = Array.from(
    new Set([
      ...recentSubscriptions.map((subscription) => String(subscription.userId || "")).filter(Boolean),
      ...recentOrders.map((order) => String(order.userId || "")).filter(Boolean),
    ])
  );
  const planIds = Array.from(new Set(recentSubscriptions.map((subscription) => String(subscription.planId || "")).filter(Boolean)));
  const [userMap, planMap] = await Promise.all([
    buildUserMapByIds(combinedUserIds),
    buildPlanMapByIds(planIds),
  ]);

  const stats = {
    activeSubscriptions: Number(activeSubscriptions || 0),
    deliveriesToday: Number((subscriptionDeliveryRows[0] && subscriptionDeliveryRows[0].count) || 0) + Number(orderDeliveriesToday || 0),
    pendingOrders: Number(pendingOrders || 0),
    appUsers: Number(appUsers || 0),
  };

  return res.status(200).json({
    ok: true,
    data: {
      today,
      stats,
      recentSubscriptions: recentSubscriptions.map((subscription) => {
        const user = userMap.get(String(subscription.userId)) || null;
        const plan = planMap.get(String(subscription.planId)) || null;
        const currency = normalizeCurrencyValue(subscription.checkoutCurrency || (plan && plan.currency) || "SAR");
        const amountMinorUnits = Number(subscription.basePlanPriceHalala || 0);

        return {
          id: String(subscription._id),
          user: serializeClientUserSummary(user),
          userName: user ? user.name || null : null,
          plan: plan
            ? {
              id: String(plan._id),
              name: pickLang(plan.name, lang) || null,
            }
            : null,
          planName: plan ? pickLang(plan.name, lang) || null : null,
          status: subscription.status,
          startDate: subscription.startDate ? dateUtils.toKSADateString(subscription.startDate) : null,
          amountMinorUnits,
          amount: minorUnitsToMajor(amountMinorUnits),
          amountDisplay: formatAmountDisplay(amountMinorUnits, currency, lang),
          currency,
          createdAt: subscription.createdAt || null,
          updatedAt: subscription.updatedAt || null,
        };
      }),
      recentOrders: recentOrders.map((order) => {
        const user = userMap.get(String(order.userId)) || null;
        const pricing = order.pricing && typeof order.pricing === "object" ? order.pricing : {};
        const currency = normalizeCurrencyValue(pricing.currency || "SAR");
        const amountMinorUnits = Number(pricing.total || 0);

        return {
          id: String(order._id),
          displayId: buildAdminOrderDisplayId(order),
          user: serializeClientUserSummary(user),
          userName: user ? user.name || null : null,
          itemsSummary: buildOrderItemsSummary(order, lang),
          status: order.status,
          date: order.deliveryDate || null,
          amountMinorUnits,
          amount: minorUnitsToMajor(amountMinorUnits),
          amountDisplay: formatAmountDisplay(amountMinorUnits, currency, lang),
          currency,
          createdAt: order.createdAt || null,
          updatedAt: order.updatedAt || null,
        };
      }),
    },
  });
}

async function getSubscriptionAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const subscription = await Subscription.findById(id).lean();
  if (!subscription) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }

  const user = subscription.userId ? await User.findById(subscription.userId).lean() : null;
  const lang = getRequestLang(req);
  return res.status(200).json({
    ok: true,
    data: await serializeSubscriptionAdmin(subscription, lang, user),
  });
}

async function listSubscriptionDaysAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const subscription = await Subscription.findById(id).select("_id").lean();
  if (!subscription) {
    return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
  }

  const days = await SubscriptionDay.find({ subscriptionId: id }).sort({ date: 1 }).lean();
  return res.status(200).json({ ok: true, data: days });
}

async function cancelSubscriptionAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const lang = getRequestLang(req);

  try {
    const result = await SubscriptionLifecycleService.performCancelSubscriptionAdmin({
      subscriptionId: id,
      actor: {
        dashboardUserId: req.dashboardUserId,
        dashboardUserRole: req.dashboardUserRole,
      },
      lang,
    });

    if (result.outcome === "not_found") {
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    if (result.outcome === "invalid_transition") {
      return errorResponse(
        res,
        409,
        "INVALID_TRANSITION",
        "Only pending_payment or active subscriptions can be canceled"
      );
    }

    if (result.outcome === "forbidden") {
      return errorResponse(res, 403, "FORBIDDEN", "Forbidden");
    }

    if (result.outcome === "error") {
      return errorResponse(res, 500, "INTERNAL", result.message || "Subscription cancellation failed");
    }

    if (!["canceled", "already_canceled"].includes(result.outcome)) {
      logger.error("adminController.cancelSubscriptionAdmin received unsupported outcome", {
        outcome: result.outcome,
        subscriptionId: id,
      });
      return errorResponse(res, 500, "INTERNAL", "Subscription cancellation failed");
    }

    return res.status(200).json({
      ok: true,
      data: result.data,
      idempotent: result.idempotent,
    });
  } catch (err) {
    logger.error("adminController.cancelSubscriptionAdmin failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: id,
    });
    return errorResponse(res, 500, "INTERNAL", "Subscription cancellation failed");
  }
}

async function extendSubscriptionAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const rawDays = req.body && req.body.days;
  const days = Number(rawDays);
  if (!isPositiveInteger(days)) {
    return errorResponse(res, 400, "INVALID", "days must be a positive integer");
  }

  const lang = getRequestLang(req);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subscription = await Subscription.findById(id).session(session);
    if (!subscription) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    }

    if (subscription.status === "canceled") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Canceled subscriptions cannot be extended");
    }

    if (subscription.status !== "active") {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_TRANSITION", "Only active subscriptions can be extended");
    }

    const baseEndDate = subscription.endDate || subscription.validityEndDate;
    const effectiveEndDate = subscription.validityEndDate || subscription.endDate;
    if (!baseEndDate || !effectiveEndDate) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "INVALID_STATE", "Subscription has no scheduled end date");
    }

    if (dateUtils.toKSADateString(effectiveEndDate) < dateUtils.getTodayKSADate()) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "SUB_EXPIRED", "Subscription validity has already passed");
    }

    const mealsPerDay = resolveMealsPerDay(subscription);
    const addedMeals = days * mealsPerDay;
    const frozenDaysCount = await SubscriptionDay.countDocuments({
      subscriptionId: subscription._id,
      status: "frozen",
    }).session(session);

    const oldBaseEndStr = dateUtils.toKSADateString(baseEndDate);
    const newBaseEndDate = addDays(baseEndDate, days);
    const newValidityEndDate = addDays(newBaseEndDate, frozenDaysCount);
    const newValidityEndStr = dateUtils.toKSADateString(newValidityEndDate);
    const datesToEnsure = buildDateRangeInclusive(dateUtils.addDaysToKSADateString(oldBaseEndStr, 1), newValidityEndStr);

    if (datesToEnsure.length > 0) {
      const existingDays = await SubscriptionDay.find({
        subscriptionId: subscription._id,
        date: { $in: datesToEnsure },
      })
        .select("date")
        .session(session)
        .lean();

      const existingDates = new Set(existingDays.map((day) => day.date));
      const missingDays = datesToEnsure
        .filter((date) => !existingDates.has(date))
        .map((date) => buildProjectedDayEntry({
          subscription,
          date,
          status: "open",
        }));

      if (missingDays.length > 0) {
        await SubscriptionDay.insertMany(missingDays, { session });
      }
    }

    subscription.endDate = newBaseEndDate;
    subscription.validityEndDate = newValidityEndDate;
    subscription.totalMeals = Number(subscription.totalMeals || 0) + addedMeals;
    subscription.remainingMeals = Number(subscription.remainingMeals || 0) + addedMeals;
    await subscription.save({ session });

    const user = subscription.userId ? await User.findById(subscription.userId).session(session).lean() : null;

    await session.commitTransaction();
    session.endSession();

    await writeActivityLogSafely({
      entityType: "subscription",
      entityId: subscription._id,
      action: "subscription_extended_by_admin",
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta: {
        days,
        addedMeals,
        endDate: dateUtils.toKSADateString(subscription.endDate),
        validityEndDate: dateUtils.toKSADateString(subscription.validityEndDate),
      },
    }, { subscriptionId: id });

    return res.status(200).json({
      ok: true,
      data: await serializeSubscriptionAdmin(subscription.toObject(), lang, user),
      meta: {
        days,
        addedMeals,
        endDate: dateUtils.toKSADateString(subscription.endDate),
        validityEndDate: dateUtils.toKSADateString(subscription.validityEndDate),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    logger.error("adminController.extendSubscriptionAdmin failed", {
      error: err.message,
      stack: err.stack,
      subscriptionId: id,
    });
    return errorResponse(res, 500, "INTERNAL", "Subscription extension failed");
  }
}

async function listOrdersAdmin(req, res) {
  const pagination = resolvePaginationOrRespond(res, req.query || {});
  if (!pagination) {
    return undefined;
  }
  const skip = (pagination.page - 1) * pagination.limit;
  const [orders, total] = await Promise.all([
    Order.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    Order.countDocuments(),
  ]);
  const userMap = await buildUserMapByIds(
    Array.from(new Set(orders.map((order) => String(order.userId)).filter(Boolean)))
  );

  return res.status(200).json({
    ok: true,
    data: orders.map((order) => serializeOrderAdmin(order, userMap.get(String(order.userId)) || null)),
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
}

async function getOrderAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const order = await Order.findById(id).lean();
  if (!order) {
    return errorResponse(res, 404, "NOT_FOUND", "Order not found");
  }

  const user = order.userId ? await User.findById(order.userId).lean() : null;
  return res.status(200).json({
    ok: true,
    data: serializeOrderAdmin(order, user),
  });
}

async function listPaymentsAdmin(req, res) {
  const pagination = resolvePaginationOrRespond(res, req.query || {});
  if (!pagination) {
    return undefined;
  }
  const skip = (pagination.page - 1) * pagination.limit;
  const [payments, total] = await Promise.all([
    Payment.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    Payment.countDocuments(),
  ]);
  const userMap = await buildUserMapByIds(
    Array.from(new Set(payments.map((payment) => String(payment.userId)).filter(Boolean)))
  );

  return res.status(200).json({
    ok: true,
    data: payments.map((payment) => serializePaymentAdmin(payment, userMap.get(String(payment.userId)) || null)),
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
}

async function getPaymentAdmin(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const payment = await Payment.findById(id).lean();
  if (!payment) {
    return errorResponse(res, 404, "NOT_FOUND", "Payment not found");
  }

  const user = payment.userId ? await User.findById(payment.userId).lean() : null;
  return res.status(200).json({
    ok: true,
    data: serializePaymentAdmin(payment, user),
  });
}

async function applyAdminPaymentSideEffects({ payment, session }) {
  const metadata = payment && payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {};

  if (payment.type === "premium_topup" || payment.type === "addon_topup") {
    const subscriptionId = payment.subscriptionId || metadata.subscriptionId;
    if (!subscriptionId || !mongoose.Types.ObjectId.isValid(String(subscriptionId))) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const subscription = await Subscription.findById(subscriptionId).session(session);
    if (!subscription) {
      return { applied: false, reason: "subscription_not_found" };
    }

    return applyWalletTopupPayment({ subscription, payment, session });
  }

  if (payment.type === "subscription_activation") {
    if (metadata.draftId && mongoose.Types.ObjectId.isValid(String(metadata.draftId))) {
      const draft = await CheckoutDraft.findById(metadata.draftId).session(session);
      return finalizeSubscriptionDraftPayment({ draft, payment, session });
    }

    if (!metadata.subscriptionId || !mongoose.Types.ObjectId.isValid(String(metadata.subscriptionId))) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const subscription = await Subscription.findById(metadata.subscriptionId).session(session);
    if (!subscription) {
      return { applied: false, reason: "subscription_not_found" };
    }
    if (subscription.status !== "pending_payment") {
      return { applied: false, reason: `subscription_not_pending:${subscription.status}` };
    }

    const plan = await Plan.findById(subscription.planId).lean();
    const start = subscription.startDate ? new Date(subscription.startDate) : new Date();
    const end = plan ? addDays(start, plan.daysCount - 1) : subscription.endDate || start;
    subscription.status = "active";
    subscription.endDate = end;
    subscription.validityEndDate = end;
    await subscription.save({ session });

    const existingDays = await SubscriptionDay.countDocuments({ subscriptionId: subscription._id }).session(session);
    if (!existingDays && plan) {
      const dayEntries = [];
      for (let i = 0; i < plan.daysCount; i += 1) {
        const currentDate = addDays(start, i);
        dayEntries.push({
          subscriptionId: subscription._id,
          date: dateUtils.toKSADateString(currentDate),
          status: "open",
        });
      }
      if (dayEntries.length) {
        await SubscriptionDay.insertMany(dayEntries, { session });
      }
    }

    return { applied: true, subscriptionId: String(subscription._id) };
  }

  if (payment.type === "one_time_addon") {
    if (
      !metadata.subscriptionId
      || !mongoose.Types.ObjectId.isValid(String(metadata.subscriptionId))
      || !metadata.addonId
      || !metadata.date
    ) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const updatedDay = await SubscriptionDay.findOneAndUpdate(
      { subscriptionId: metadata.subscriptionId, date: metadata.date, status: "open" },
      { $addToSet: { addonsOneTime: metadata.addonId } },
      { new: true, session }
    );
    if (updatedDay) {
      return { applied: true, dayId: String(updatedDay._id) };
    }

    const dayCheck = await SubscriptionDay.findOne(
      { subscriptionId: metadata.subscriptionId, date: metadata.date },
      { status: 1 }
    ).session(session).lean();
    if (!dayCheck) {
      return { applied: false, reason: "day_not_found" };
    }
    return { applied: false, reason: `day_not_open:${dayCheck.status}` };
  }

  if (payment.type === "custom_salad_day") {
    const snapshot = metadata.snapshot;
    if (
      !metadata.subscriptionId
      || !mongoose.Types.ObjectId.isValid(String(metadata.subscriptionId))
      || !metadata.date
      || !snapshot
    ) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const existingDay = await SubscriptionDay.findOne(
      { subscriptionId: metadata.subscriptionId, date: metadata.date }
    ).session(session);

    let updatedDay;
    if (!existingDay) {
      const createdDay = await SubscriptionDay.create(
        [
          {
            subscriptionId: metadata.subscriptionId,
            date: metadata.date,
            status: "open",
            customSalads: [snapshot],
          },
        ],
        { session }
      );
      updatedDay = createdDay[0];
    } else if (existingDay.status === "open") {
      existingDay.customSalads = existingDay.customSalads || [];
      existingDay.customSalads.push(snapshot);
      await existingDay.save({ session });
      updatedDay = existingDay;
    } else {
      return { applied: false, reason: `day_not_open:${existingDay.status}` };
    }

    return { applied: true, dayId: String(updatedDay._id) };
  }

  if (payment.type === "custom_meal_day") {
    const snapshot = metadata.snapshot;
    if (
      !metadata.subscriptionId
      || !mongoose.Types.ObjectId.isValid(String(metadata.subscriptionId))
      || !metadata.date
      || !snapshot
    ) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const existingDay = await SubscriptionDay.findOne(
      { subscriptionId: metadata.subscriptionId, date: metadata.date }
    ).session(session);

    let updatedDay;
    if (!existingDay) {
      const created = await SubscriptionDay.create(
        [
          {
            subscriptionId: metadata.subscriptionId,
            date: metadata.date,
            status: "open",
            customMeals: [snapshot],
          },
        ],
        { session }
      );
      updatedDay = created[0];
    } else if (existingDay.status === "open") {
      existingDay.customMeals = existingDay.customMeals || [];
      existingDay.customMeals.push(snapshot);
      await existingDay.save({ session });
      updatedDay = existingDay;
    } else {
      return { applied: false, reason: `day_not_open:${existingDay.status}` };
    }

    return { applied: true, dayId: String(updatedDay._id) };
  }

  if (payment.type === "one_time_order") {
    if (!metadata.orderId || !mongoose.Types.ObjectId.isValid(String(metadata.orderId))) {
      return { applied: false, reason: "invalid_metadata" };
    }

    const order = await Order.findById(metadata.orderId).session(session);
    if (!order) {
      return { applied: false, reason: "order_not_found" };
    }

    if (order.status === "created") {
      order.status = "confirmed";
      order.confirmedAt = order.confirmedAt || new Date();
    }
    order.paymentStatus = "paid";
    order.paymentId = payment._id;
    if (payment.providerInvoiceId) order.providerInvoiceId = payment.providerInvoiceId;
    if (payment.providerPaymentId) order.providerPaymentId = payment.providerPaymentId;
    await order.save({ session });

    return { applied: true, orderId: String(order._id) };
  }

  return { applied: false, reason: "unsupported_payment_type" };
}

async function verifyPaymentAdmin(req, res, runtimeOverrides = null) {
  const getInvoiceFn = runtimeOverrides && runtimeOverrides.getInvoice
    ? runtimeOverrides.getInvoice
    : getInvoice;
  const startSessionFn = runtimeOverrides && runtimeOverrides.startSession
    ? runtimeOverrides.startSession
    : () => mongoose.startSession();
  const applyPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyPaymentSideEffects
    ? runtimeOverrides.applyPaymentSideEffects
    : applyPaymentSideEffects;
  const applyAdminPaymentSideEffectsFn = runtimeOverrides && runtimeOverrides.applyAdminPaymentSideEffects
    ? runtimeOverrides.applyAdminPaymentSideEffects
    : applyAdminPaymentSideEffects;
  const writeActivityLogSafelyFn = runtimeOverrides && runtimeOverrides.writeActivityLogSafely
    ? runtimeOverrides.writeActivityLogSafely
    : writeActivityLogSafely;
  const isSharedPaymentDispatcherEnabledFn = runtimeOverrides && runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    ? runtimeOverrides.isPhase1SharedPaymentDispatcherEnabled
    : isPhase1SharedPaymentDispatcherEnabled;
  const supportedSharedPaymentTypes = runtimeOverrides && runtimeOverrides.supportedPaymentTypes
    ? runtimeOverrides.supportedPaymentTypes
    : SUPPORTED_PHASE1_SHARED_PAYMENT_TYPES;

  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const payment = await Payment.findById(id).lean();
  if (!payment) {
    return errorResponse(res, 404, "NOT_FOUND", "Payment not found");
  }
  if (payment.provider !== "moyasar") {
    return errorResponse(res, 409, "INVALID", "Only Moyasar payments can be verified");
  }
  if (!payment.providerInvoiceId) {
    return errorResponse(res, 409, "INVALID", "Payment has no provider invoice");
  }

  let providerInvoice;
  try {
    providerInvoice = await getInvoiceFn(payment.providerInvoiceId);
  } catch (err) {
    if (err.code === "CONFIG") {
      return errorResponse(res, 500, "CONFIG", err.message);
    }
    if (err.code === "NOT_FOUND") {
      return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Invoice not found at payment provider");
    }
    logger.error("adminController.verifyPaymentAdmin failed to fetch invoice", {
      paymentId: id,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 502, "PAYMENT_PROVIDER_ERROR", "Failed to fetch payment status from provider");
  }

  const providerPayment = pickProviderInvoicePayment(providerInvoice, payment);
  const normalizedStatus = normalizeProviderPaymentStatus(
    providerPayment && providerPayment.status ? providerPayment.status : providerInvoice.status
  );
  if (!normalizedStatus) {
    return errorResponse(res, 409, "PAYMENT_PROVIDER_ERROR", "Unsupported provider payment status");
  }

  const session = await startSessionFn();
  let synchronized = false;
  try {
    session.startTransaction();

    const paymentInSession = await Payment.findById(id).session(session);
    if (!paymentInSession) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 404, "NOT_FOUND", "Payment not found");
    }

    const providerInvoiceId = providerInvoice && providerInvoice.id ? String(providerInvoice.id) : "";
    if (
      providerInvoiceId
      && paymentInSession.providerInvoiceId
      && String(paymentInSession.providerInvoiceId) !== providerInvoiceId
    ) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Invoice ID mismatch");
    }
    if (
      providerPayment
      && providerPayment.id
      && paymentInSession.providerPaymentId
      && String(paymentInSession.providerPaymentId) !== String(providerPayment.id)
    ) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Payment ID mismatch");
    }

    const providerAmount = Number(
      providerPayment && providerPayment.amount !== undefined ? providerPayment.amount : providerInvoice.amount
    );
    if (Number.isFinite(providerAmount) && providerAmount !== Number(paymentInSession.amount)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Amount mismatch");
    }

    const providerCurrency = normalizeCurrencyValue(
      providerPayment && providerPayment.currency ? providerPayment.currency : providerInvoice.currency
    );
    if (providerCurrency !== normalizeCurrencyValue(paymentInSession.currency)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponse(res, 409, "MISMATCH", "Currency mismatch");
    }

    if (providerInvoiceId && !paymentInSession.providerInvoiceId) {
      paymentInSession.providerInvoiceId = providerInvoiceId;
    }
    if (providerPayment && providerPayment.id && !paymentInSession.providerPaymentId) {
      paymentInSession.providerPaymentId = String(providerPayment.id);
    }
    paymentInSession.status = normalizedStatus;
    if (normalizedStatus === "paid" && !paymentInSession.paidAt) {
      paymentInSession.paidAt = new Date();
    }
    await paymentInSession.save({ session });

    const metadata = paymentInSession.metadata && typeof paymentInSession.metadata === "object"
      ? paymentInSession.metadata
      : {};
    const terminalFailureStatuses = new Set(["failed", "canceled", "expired"]);
    if (
      paymentInSession.type === "subscription_activation"
      && normalizedStatus !== "paid"
      && metadata.draftId
      && mongoose.Types.ObjectId.isValid(String(metadata.draftId))
    ) {
      const draftInSession = await CheckoutDraft.findById(metadata.draftId).session(session);
      if (
        draftInSession
        && !draftInSession.subscriptionId
        && terminalFailureStatuses.has(normalizedStatus)
        && ["pending_payment", "failed", "canceled", "expired"].includes(draftInSession.status)
      ) {
        draftInSession.status = normalizedStatus === "canceled"
          ? "canceled"
          : normalizedStatus === "expired"
            ? "expired"
            : "failed";
        draftInSession.failedAt = new Date();
        draftInSession.failureReason = `payment_${draftInSession.status}`;
        await draftInSession.save({ session });
        synchronized = true;
      }
    }

    if (normalizedStatus === "paid" && !paymentInSession.applied) {
      const claimedPayment = await Payment.findOneAndUpdate(
        { _id: paymentInSession._id, applied: false },
        { $set: { applied: true, status: "paid" } },
        { new: true, session }
      );

      if (claimedPayment) {
        const useSharedDispatcher =
          supportedSharedPaymentTypes.has(String(claimedPayment.type || ""))
          && (
            isSharedPaymentDispatcherEnabledFn()
            || String(claimedPayment.type || "") === "premium_overage_day"
            || String(claimedPayment.type || "") === "one_time_addon_day_planning"
          );
        const result = useSharedDispatcher
          ? await applyPaymentSideEffectsFn({
            payment: claimedPayment,
            session,
            source: "admin_verify",
          })
          : await applyAdminPaymentSideEffectsFn({ payment: claimedPayment, session });
        if (result.applied) {
          synchronized = true;
        } else {
          const mergedMetadata = Object.assign({}, claimedPayment.metadata || {}, { unappliedReason: result.reason });
          await Payment.updateOne(
            { _id: claimedPayment._id },
            { $set: { applied: true, status: "paid", metadata: mergedMetadata } },
            { session }
          );
        }
      }
    }

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error("adminController.verifyPaymentAdmin failed", {
      paymentId: id,
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Payment verification failed");
  }

  const latestPayment = await Payment.findById(id).lean();
  const user = latestPayment && latestPayment.userId ? await User.findById(latestPayment.userId).lean() : null;

  await writeActivityLogSafelyFn({
    entityType: "payment",
    entityId: id,
    action: "payment_verified_by_admin",
    byUserId: req.dashboardUserId,
    byRole: req.dashboardUserRole,
    meta: {
      provider: latestPayment ? latestPayment.provider : payment.provider,
      type: latestPayment ? latestPayment.type : payment.type,
      status: latestPayment ? latestPayment.status : normalizedStatus,
      applied: latestPayment ? Boolean(latestPayment.applied) : false,
      synchronized,
      providerInvoiceId: latestPayment ? latestPayment.providerInvoiceId || null : payment.providerInvoiceId || null,
      providerPaymentId: latestPayment ? latestPayment.providerPaymentId || null : null,
    },
  }, { paymentId: id });

  return res.status(200).json({
    ok: true,
    data: {
      payment: serializePaymentAdmin(latestPayment, user),
      providerInvoice: buildProviderInvoiceSummary(providerInvoice, latestPayment),
      checkedProvider: true,
      synchronized,
      applied: latestPayment ? Boolean(latestPayment.applied) : false,
    },
  });
}

async function getDashboardUser(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const user = await DashboardUser.findById(id).select("-passwordHash").lean();
  if (!user) {
    return errorResponse(res, 404, "NOT_FOUND", "Dashboard user not found");
  }

  return res.status(200).json({ ok: true, data: serializeDashboardUserAdmin(user) });
}

async function createDashboardUser(req, res) {
  const { email, role, password, isActive } = req.body || {};
  const normalizedEmail = normalizeDashboardEmail(email);
  if (!normalizedEmail || !role || !password) {
    return errorResponse(res, 400, "INVALID", "Missing email, role, or password");
  }
  if (!isValidEmailFormat(normalizedEmail)) {
    return errorResponse(res, 400, "INVALID", "Invalid email format");
  }
  if (!DASHBOARD_ROLES.has(role)) {
    return errorResponse(res, 400, "INVALID", "role must be one of: superadmin, admin, kitchen, courier");
  }
  const passwordValidation = validateDashboardPassword(password);
  if (!passwordValidation.ok) {
    return errorResponse(res, 400, "INVALID", passwordValidation.message);
  }
  const existing = await DashboardUser.findOne({
    email: { $regex: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i") },
  }).lean();
  if (existing) {
    return errorResponse(res, 409, "CONFLICT", "Dashboard user already exists");
  }
  const passwordHash = await hashDashboardPassword(password);
  const user = await DashboardUser.create({
    email: normalizedEmail,
    role,
    passwordHash,
    isActive: isActive === undefined ? true : Boolean(isActive),
    passwordChangedAt: new Date(),
  });
  return res.status(201).json({ ok: true, data: { id: user.id } });
}

async function updateDashboardUser(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const body = req.body || {};
  const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, "isActive");
  if (!hasRole && !hasIsActive) {
    return errorResponse(res, 400, "INVALID", "At least one of role or isActive is required");
  }

  const user = await DashboardUser.findById(id);
  if (!user) {
    return errorResponse(res, 404, "NOT_FOUND", "Dashboard user not found");
  }

  if (hasRole) {
    const normalizedRole = typeof body.role === "string" ? body.role.trim() : body.role;
    if (!DASHBOARD_ROLES.has(normalizedRole)) {
      return errorResponse(res, 400, "INVALID", "role must be one of: superadmin, admin, kitchen, courier");
    }
    if (String(user._id) === String(req.dashboardUserId) && normalizedRole !== user.role) {
      return errorResponse(res, 400, "INVALID", "You cannot change your own role");
    }
    user.role = normalizedRole;
  }

  if (hasIsActive) {
    if (typeof body.isActive !== "boolean") {
      return errorResponse(res, 400, "INVALID", "isActive must be a boolean");
    }
    if (String(user._id) === String(req.dashboardUserId) && body.isActive === false) {
      return errorResponse(res, 400, "INVALID", "You cannot deactivate your own account");
    }
    user.isActive = body.isActive;
  }

  await user.save();
  return res.status(200).json({ ok: true, data: serializeDashboardUserAdmin(user) });
}

async function deleteDashboardUser(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  if (String(id) === String(req.dashboardUserId)) {
    return errorResponse(res, 400, "INVALID", "You cannot delete your own account");
  }

  const deleted = await DashboardUser.findByIdAndDelete(id).lean();
  if (!deleted) {
    return errorResponse(res, 404, "NOT_FOUND", "Dashboard user not found");
  }

  return res.status(200).json({ ok: true });
}

async function resetDashboardUserPassword(req, res) {
  const { id } = req.params;
  if (!validateObjectIdOrRespond(res, id, "id")) {
    return undefined;
  }

  const { password } = req.body || {};
  if (!password) {
    return errorResponse(res, 400, "INVALID", "Missing password");
  }

  const passwordValidation = validateDashboardPassword(password);
  if (!passwordValidation.ok) {
    return errorResponse(res, 400, "INVALID", passwordValidation.message);
  }

  const user = await DashboardUser.findById(id);
  if (!user) {
    return errorResponse(res, 404, "NOT_FOUND", "Dashboard user not found");
  }

  user.passwordHash = await hashDashboardPassword(password);
  user.passwordChangedAt = new Date();
  user.failedAttempts = 0;
  user.lockUntil = null;
  await user.save();

  return res.status(200).json({
    ok: true,
    data: {
      id: user.id,
      user: serializeDashboardUserAdmin(user),
    },
  });
}

async function listActivityLogs(req, res) {
  const {
    entityType,
    entityId,
    action,
    from,
    to,
    byRole,
  } = req.query || {};

  const query = {};
  if (entityType) query.entityType = entityType;
  // MEDIUM AUDIT FIX: Validate filter ObjectIds/dates to avoid CastError and return controlled 400 responses.
  if (entityId) {
    try {
      validateObjectId(entityId, "entityId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.entityId = entityId;
  }
  if (action) query.action = action;
  if (byRole) query.byRole = byRole;
  const parsedFrom = from ? parseDateFilterOrNull(from, { bound: "start" }) : null;
  if (from && !parsedFrom) {
    return errorResponse(res, 400, "INVALID", "from must be a valid date");
  }
  const parsedTo = to ? parseDateFilterOrNull(to, { bound: "end" }) : null;
  if (to && !parsedTo) {
    return errorResponse(res, 400, "INVALID", "to must be a valid date");
  }
  if (parsedFrom && parsedTo && parsedFrom.value > parsedTo.value) {
    return errorResponse(res, 400, "INVALID", "from must be before or equal to to");
  }
  if (from || to) {
    query.createdAt = {};
    if (parsedFrom) query.createdAt[parsedFrom.operator] = parsedFrom.value;
    if (parsedTo) query.createdAt[parsedTo.operator] = parsedTo.value;
  }

  const pagination = resolvePaginationOrRespond(res, req.query || {});
  if (!pagination) {
    return undefined;
  }
  const skip = (pagination.page - 1) * pagination.limit;

  const [logs, total] = await Promise.all([
    ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pagination.limit)
      .lean(),
    ActivityLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
}

async function listNotificationLogs(req, res) {
  const { userId, entityId, from, to } = req.query || {};
  const query = {};
  if (userId) {
    try {
      validateObjectId(userId, "userId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.userId = userId;
  }
  // MEDIUM AUDIT FIX: Validate filter ObjectIds/dates to avoid CastError and return controlled 400 responses.
  if (entityId) {
    try {
      validateObjectId(entityId, "entityId");
    } catch (err) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    query.entityId = entityId;
  }
  const parsedFrom = from ? parseDateFilterOrNull(from, { bound: "start" }) : null;
  if (from && !parsedFrom) {
    return errorResponse(res, 400, "INVALID", "from must be a valid date");
  }
  const parsedTo = to ? parseDateFilterOrNull(to, { bound: "end" }) : null;
  if (to && !parsedTo) {
    return errorResponse(res, 400, "INVALID", "to must be a valid date");
  }
  if (parsedFrom && parsedTo && parsedFrom.value > parsedTo.value) {
    return errorResponse(res, 400, "INVALID", "from must be before or equal to to");
  }
  if (from || to) {
    query.createdAt = {};
    if (parsedFrom) query.createdAt[parsedFrom.operator] = parsedFrom.value;
    if (parsedTo) query.createdAt[parsedTo.operator] = parsedTo.value;
  }

  const pagination = resolvePaginationOrRespond(res, req.query || {});
  if (!pagination) {
    return undefined;
  }
  const skip = (pagination.page - 1) * pagination.limit;

  const [logs, total] = await Promise.all([
    NotificationLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(pagination.limit).lean(),
    NotificationLog.countDocuments(query),
  ]);

  return res.status(200).json({
    ok: true,
    data: logs,
    meta: buildPaginationMeta(pagination.page, pagination.limit, total),
  });
}

module.exports = {
  listPlansAdmin,
  getPlanAdmin,
  createPlan,
  updatePlan,
  deletePlan,
  togglePlanActive,
  updatePlanSortOrder,
  clonePlan,
  createGramsRow,
  cloneGramsRow,
  deleteGramsRow,
  toggleGramsRow,
  updateGramsSortOrder,
  createMealsOption,
  cloneMealsOption,
  deleteMealsOption,
  toggleMealsOption,
  updateMealsSortOrder,
  updateCutoff,
  updateDeliveryWindows,
  updateSkipAllowance,
  updatePremiumPrice,
  updateSubscriptionDeliveryFee,
  updateVatPercentage,
  updateCustomSaladBasePrice,
  updateCustomMealBasePrice,
  patchSettings,
  searchDashboard,
  getDashboardNotificationSummary,
  getTodayReport,
  listAppUsers,
  createAppUserAdmin,
  getAppUser,
  updateAppUser,
  listAppUserSubscriptions,
  listSubscriptionsAdmin,
  getSubscriptionsSummaryAdmin,
  exportSubscriptionsAdmin,
  getDashboardOverview,
  createSubscriptionAdmin,
  getSubscriptionAdmin,
  listSubscriptionDaysAdmin,
  cancelSubscriptionAdmin,
  extendSubscriptionAdmin,
  listOrdersAdmin,
  getOrderAdmin,
  listPaymentsAdmin,
  getPaymentAdmin,
  verifyPaymentAdmin,
  listDashboardUsers,
  getDashboardUser,
  createDashboardUser,
  updateDashboardUser,
  deleteDashboardUser,
  resetDashboardUserPassword,
  listActivityLogs,
  listNotificationLogs,
  triggerDailyCutoff: async (req, res) => {
    try {
      await processDailyCutoff();
      return res.status(200).json({ ok: true, message: "Cutoff processed successfully" });
    } catch (err) {
      if (err && err.code === "JOB_RUNNING") {
        // MEDIUM AUDIT FIX: Surface cutoff lock contention as explicit 409 so callers can retry safely.
        return errorResponse(res, 409, "JOB_RUNNING", "Daily cutoff job is already running");
      }
      logger.error("adminController.triggerDailyCutoff failed", { error: err.message, stack: err.stack });
      return errorResponse(res, 500, "INTERNAL", "Cutoff processing failed");
    }
  },

  freezeSubscriptionAdmin: async (req, res) => {
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    req.userId = sub.userId; 
    return freezeSubscription(req, res);
  },

  unfreezeSubscriptionAdmin: async (req, res) => {
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    req.userId = sub.userId; 
    return unfreezeSubscription(req, res);
  },

  skipSubscriptionDayAdmin: async (req, res) => {
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    req.userId = sub.userId; 
    return skipDay(req, res);
  },

  unskipSubscriptionDayAdmin: async (req, res) => {
    const sub = await Subscription.findById(req.params.id);
    if (!sub) return errorResponse(res, 404, "NOT_FOUND", "Subscription not found");
    req.userId = sub.userId; 
    return unskipDay(req, res);
  }
};

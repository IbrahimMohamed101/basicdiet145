"use strict";

const Plan = require("../../models/Plan");
const User = require("../../models/User");
const PremiumMeal = require("../../models/PremiumMeal");
const Addon = require("../../models/Addon");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Setting = require("../../models/Setting");
const mongoose = require("mongoose");
const dateUtils = require("../../utils/date");
const { addDaysToKSADateString } = dateUtils;
const { pickLang } = require("../../utils/i18n");
const { isGenericPremiumWalletMode } = require("../genericPremiumWalletService");
const {
  resolveSubscriptionFreezePolicy,
  resolveSubscriptionSkipPolicy,
  getSubscriptionContractReadView,
} = require("./subscriptionContractReadService");

function resolveEffectiveSubscriptionStatus(subscription, today = dateUtils.getTodayKSADate()) {
  if (!subscription || typeof subscription !== "object") {
    return null;
  }

  if (subscription.status === "active") {
    const endDate = subscription.validityEndDate || subscription.endDate;
    if (endDate && today > dateUtils.toKSADateString(endDate)) {
      return "expired";
    }
  }

  return subscription.status || null;
}

function countFrozenBlocks(dateStrings) {
  const uniqueSorted = Array.from(new Set(dateStrings || [])).sort();
  let blocks = 0;
  let previousDate = null;

  for (const date of uniqueSorted) {
    if (!previousDate || addDaysToKSADateString(previousDate, 1) !== date) {
      blocks += 1;
    }
    previousDate = date;
  }

  return blocks;
}

function normalizeSubscriptionId(value) {
  return value && typeof value === "object" && value._id ? String(value._id) : String(value || "");
}

function createErrorOutcome(status, code, message) {
  return {
    outcome: "error",
    status,
    code,
    message,
  };
}

const defaultRuntime = {
  async findSubscriptionByIdWithPlan(subscriptionId) {
    return Subscription.findById(subscriptionId).populate("planId").lean();
  },
  async findFrozenDays(subscriptionId) {
    return SubscriptionDay.find({
      subscriptionId,
      status: "frozen",
    }).select("date").lean();
  },
  async findTargetDays(subscriptionId, targetDates) {
    return SubscriptionDay.find({
      subscriptionId,
      date: { $in: targetDates },
    }).select("date status").lean();
  },
  async getCutoffTime() {
    const setting = await Setting.findOne({ key: "cutoff_time" }).lean();
    return setting && setting.value ? String(setting.value) : "00:00";
  },
  async buildUserMapByIds(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return new Map();
    }
    const users = await User.find({ _id: { $in: userIds } }).lean();
    return new Map(users.map((user) => [String(user._id), user]));
  },
  getTodayKSADate() {
    return dateUtils.getTodayKSADate();
  },
  getTomorrowKSADate() {
    return dateUtils.getTomorrowKSADate();
  },
  toKSADateString(value) {
    return dateUtils.toKSADateString(value);
  },
  isValidKSADateString(value) {
    return dateUtils.isValidKSADateString(value);
  },
  isOnOrAfterTodayKSADate(value) {
    return dateUtils.isOnOrAfterTodayKSADate(value);
  },
  isOnOrAfterKSADate(value, compareTo) {
    return dateUtils.isOnOrAfterKSADate(value, compareTo);
  },
  isInSubscriptionRange(value, endDate) {
    return dateUtils.isInSubscriptionRange(value, endDate);
  },
  isBeforeCutoff(cutoffTime) {
    return dateUtils.isBeforeCutoff(cutoffTime);
  },
  addDaysToKSADateString,
};

function resolveRuntime(runtimeOverrides = null) {
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return defaultRuntime;
  }
  return { ...defaultRuntime, ...runtimeOverrides };
}

function resolveLivePlan(subscription) {
  return subscription
    && subscription.planId
    && typeof subscription.planId === "object"
    && !Array.isArray(subscription.planId)
    ? subscription.planId
    : null;
}

function isOwnedByActor(subscription, actor) {
  if (!actor || actor.kind !== "client") {
    return true;
  }
  return String(subscription.userId) === String(actor.userId);
}

async function loadOwnedSubscriptionOrOutcome({ subscriptionId, actor, runtime }) {
  const subscription = await runtime.findSubscriptionByIdWithPlan(subscriptionId);
  if (!subscription) {
    return { outcome: "not_found" };
  }
  if (!isOwnedByActor(subscription, actor)) {
    return { outcome: "forbidden" };
  }
  return { outcome: "success", subscription };
}

async function buildSubscriptionOperationsMeta({ subscriptionId, actor, runtime: runtimeOverrides = null }) {
  const runtime = resolveRuntime(runtimeOverrides);
  const loaded = await loadOwnedSubscriptionOrOutcome({ subscriptionId, actor, runtime });
  if (loaded.outcome !== "success") {
    return loaded;
  }

  const subscription = loaded.subscription;
  const livePlan = resolveLivePlan(subscription);
  const today = runtime.getTodayKSADate();
  const effectiveStatus = resolveEffectiveSubscriptionStatus(subscription, today);
  const freezePolicy = resolveSubscriptionFreezePolicy(subscription, livePlan, {
    context: "subscription_operations_meta",
  });
  const skipPolicy = resolveSubscriptionSkipPolicy(subscription, livePlan, {
    context: "subscription_operations_meta",
  });

  const [frozenDays] = await Promise.all([
    runtime.findFrozenDays(subscriptionId),
  ]);

  const frozenDateStrings = frozenDays
    .map((day) => day && day.date)
    .filter((date) => typeof date === "string")
    .sort();
  const frozenDaysUsed = frozenDateStrings.length;
  const frozenBlocksUsed = countFrozenBlocks(frozenDateStrings);
  const activeWriteEligible = effectiveStatus === "active" && subscription.status === "active";
  const skipDaysUsed = Number(subscription.skipDaysUsed || 0);
  const skipDaysRemaining = Math.max(Number(skipPolicy.maxDays || 0) - skipDaysUsed, 0);

  return {
    outcome: "success",
    data: {
      subscriptionId: normalizeSubscriptionId(subscription._id),
      statusContext: {
        storedStatus: subscription.status,
        effectiveStatus,
        derivedEffectiveStatus: effectiveStatus !== subscription.status,
      },
      operations: {
        cancel: {
          supported: true,
          canSubmit: ["active", "pending_payment"].includes(subscription.status),
          reasonCode: ["active", "pending_payment"].includes(subscription.status) ? null : "INVALID_TRANSITION",
          allowedStoredStatuses: ["active", "pending_payment"],
          decisionBasis: "stored_status",
        },
        freeze: {
          supported: true,
          canSubmit: freezePolicy.enabled && activeWriteEligible,
          reasonCode: !freezePolicy.enabled
            ? "FREEZE_DISABLED"
            : activeWriteEligible
              ? null
              : effectiveStatus === "expired"
                ? "SUB_EXPIRED"
                : "SUB_INACTIVE",
          policy: freezePolicy,
          usage: {
            frozenDaysUsed,
            frozenDaysRemaining: Math.max(Number(freezePolicy.maxDays || 0) - frozenDaysUsed, 0),
            frozenBlocksUsed,
            frozenBlocksRemaining: Math.max(Number(freezePolicy.maxTimes || 0) - frozenBlocksUsed, 0),
          },
        },
        skip: {
          supported: true,
          canSubmit: skipPolicy.enabled && activeWriteEligible && skipDaysRemaining > 0,
          reasonCode: !skipPolicy.enabled
            ? "SKIP_DISABLED"
            : !activeWriteEligible
              ? effectiveStatus === "expired"
                ? "SUB_EXPIRED"
                : "SUB_INACTIVE"
              : skipDaysRemaining > 0
                ? null
                : "SKIP_LIMIT_REACHED",
          policy: {
            allowanceScope: "plan_policy_snapshot",
            enabled: skipPolicy.enabled,
            maxDays: Number(skipPolicy.maxDays || 0),
            compensationMode: "validity_extension",
          },
          usage: {
            usedDays: skipDaysUsed,
            remainingDays: skipDaysRemaining,
          },
        },
        delivery: {
          supported: true,
          canSubmit: activeWriteEligible,
          reasonCode: activeWriteEligible
            ? null
            : effectiveStatus === "expired"
              ? "SUB_EXPIRED"
              : "SUB_INACTIVE",
          currentMode: subscription.deliveryMode || null,
          modeChangeSupported: false,
          optionsEndpoint: "/api/subscriptions/delivery-options",
        },
        paymentMethods: {
          supported: false,
          canManage: false,
          reasonCode: "PROVIDER_TOKENIZATION_UNAVAILABLE",
          provider: "moyasar",
          mode: "invoice_only",
        },
      },
    },
  };
}

function buildTargetDatesOrOutcome({ startDate, days, runtime, fieldName = "days" }) {
  if (!startDate || !runtime.isValidKSADateString(startDate)) {
    return createErrorOutcome(400, "INVALID_DATE", "Invalid startDate");
  }

  const parsedDays = Number(days);
  if (!Number.isInteger(parsedDays) || parsedDays <= 0) {
    return createErrorOutcome(400, "INVALID", `${fieldName} must be a positive integer`);
  }

  return {
    outcome: "success",
    targetDates: Array.from({ length: parsedDays }, (_, index) => runtime.addDaysToKSADateString(startDate, index)),
  };
}

async function buildFreezePreview({
  subscriptionId,
  actor,
  startDate,
  days,
  runtime: runtimeOverrides = null,
}) {
  const runtime = resolveRuntime(runtimeOverrides);
  const loaded = await loadOwnedSubscriptionOrOutcome({ subscriptionId, actor, runtime });
  if (loaded.outcome !== "success") {
    return loaded;
  }

  const subscription = loaded.subscription;
  const livePlan = resolveLivePlan(subscription);
  const freezePolicy = resolveSubscriptionFreezePolicy(subscription, livePlan, {
    context: "subscription_freeze_preview",
  });
  if (!freezePolicy.enabled) {
    return createErrorOutcome(422, "FREEZE_DISABLED", "Freeze is disabled for this plan");
  }

  if (subscription.status !== "active") {
    return createErrorOutcome(422, "SUB_INACTIVE", "Subscription not active");
  }

  const range = buildTargetDatesOrOutcome({ startDate, days, runtime });
  if (range.outcome !== "success") {
    return range;
  }

  const baseEndDate = subscription.endDate || subscription.validityEndDate;
  if (!baseEndDate) {
    return createErrorOutcome(422, "SUB_EXPIRED", "Subscription expired");
  }

  const tomorrow = runtime.getTomorrowKSADate();
  for (const date of range.targetDates) {
    if (!runtime.isOnOrAfterTodayKSADate(date)) {
      return createErrorOutcome(400, "INVALID_DATE", "Date cannot be in the past");
    }
    if (!runtime.isOnOrAfterKSADate(date, tomorrow)) {
      return createErrorOutcome(400, "INVALID_DATE", "Date must be from tomorrow onward");
    }
    if (!runtime.isInSubscriptionRange(date, baseEndDate)) {
      return createErrorOutcome(422, "SUB_EXPIRED", "Subscription expired");
    }
  }

  if (range.targetDates.includes(tomorrow)) {
    const cutoffTime = await runtime.getCutoffTime();
    if (!runtime.isBeforeCutoff(cutoffTime)) {
      return createErrorOutcome(400, "LOCKED", "Cutoff time passed for tomorrow");
    }
  }

  const [currentFrozenDays, targetDays] = await Promise.all([
    runtime.findFrozenDays(subscriptionId),
    runtime.findTargetDays(subscriptionId, range.targetDates),
  ]);

  const targetDaysByDate = new Map(targetDays.map((day) => [day.date, day]));
  const blockedDay = range.targetDates.find((date) => {
    const day = targetDaysByDate.get(date);
    return day && !["open", "frozen"].includes(day.status);
  });
  if (blockedDay) {
    return createErrorOutcome(409, "LOCKED", `Day ${blockedDay} is not open for freeze`);
  }

  const currentFrozenDateStrings = currentFrozenDays
    .map((day) => day && day.date)
    .filter((date) => typeof date === "string")
    .sort();
  const currentFrozenSet = new Set(currentFrozenDateStrings);
  const prospectiveFrozenSet = new Set(currentFrozenDateStrings);
  const newlyFrozenDates = [];
  const alreadyFrozenDates = [];

  for (const date of range.targetDates) {
    if (prospectiveFrozenSet.has(date)) {
      alreadyFrozenDates.push(date);
    } else {
      prospectiveFrozenSet.add(date);
      newlyFrozenDates.push(date);
    }
  }

  if (prospectiveFrozenSet.size > freezePolicy.maxDays) {
    return createErrorOutcome(
      403,
      "FREEZE_LIMIT_REACHED",
      `Freeze days exceed plan limit of ${freezePolicy.maxDays}`
    );
  }

  const frozenBlocksUsedAfter = countFrozenBlocks(Array.from(prospectiveFrozenSet.values()));
  if (frozenBlocksUsedAfter > freezePolicy.maxTimes) {
    return createErrorOutcome(
      403,
      "FREEZE_LIMIT_REACHED",
      `Freeze periods exceed plan limit of ${freezePolicy.maxTimes}`
    );
  }

  const currentFrozenBlocksUsed = countFrozenBlocks(currentFrozenDateStrings);
  const currentValidityEndDate = subscription.validityEndDate || subscription.endDate;
  const validityEndDateAfter = runtime.toKSADateString(
    new Date(`${runtime.addDaysToKSADateString(runtime.toKSADateString(subscription.endDate), prospectiveFrozenSet.size)}T00:00:00+03:00`)
  );

  return {
    outcome: "success",
    data: {
      subscriptionId: normalizeSubscriptionId(subscription._id),
      request: {
        startDate,
        days: Number(days),
        endDate: range.targetDates[range.targetDates.length - 1] || startDate,
      },
      policy: freezePolicy,
      current: {
        endDate: runtime.toKSADateString(subscription.endDate),
        validityEndDate: runtime.toKSADateString(currentValidityEndDate),
        frozenDaysTotal: currentFrozenDateStrings.length,
        frozenBlocksUsed: currentFrozenBlocksUsed,
      },
      preview: {
        targetDates: range.targetDates,
        newlyFrozenDates,
        alreadyFrozenDates,
        frozenDaysTotalAfter: prospectiveFrozenSet.size,
        frozenBlocksUsedAfter,
        validityEndDateAfter,
        extensionDaysAdded: Math.max(prospectiveFrozenSet.size - currentFrozenDateStrings.length, 0),
      },
    },
  };
}


function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDateFilterOrNull(value, { bound = "start" } = {}) {
  if (!value) return null;
  const normalized = String(value).trim();
  const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
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

function buildAdminSubscriptionDisplayId(subscription) {
  return `SUB-${String(subscription && subscription._id ? subscription._id : "").slice(-6).toUpperCase()}`;
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

function parseAdminSubscriptionDisplaySuffix(value) {
  const match = /^sub-([a-f0-9]{1,24})$/i.exec(String(value || "").trim());
  return match ? match[1] : "";
}

async function findSubscriptionsByDisplaySuffix(suffix, limit) {
  if (!suffix) return [];

  return Subscription.aggregate([
    {
      $addFields: {
        _adminSubscriptionIdString: { $toString: "$_id" },
      },
    },
    {
      $match: {
        _adminSubscriptionIdString: {
          $regex: `${escapeRegExp(suffix)}$`,
          $options: "i",
        },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: Math.max(Number(limit) || 1, 1) },
    {
      $project: {
        _adminSubscriptionIdString: 0,
      },
    },
  ]);
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

function normalizeAdminSubscriptionStatusOrThrow(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "all") {
    return null;
  }
  if (normalized === "pending") {
    return "pending_payment";
  }
  if (normalized === "cancelled") {
    return "canceled";
  }
  if (["active", "pending_payment", "expired", "canceled", "ended"].includes(normalized)) {
    return normalized;
  }

  const err = new Error("status must be one of: active, pending_payment, pending, expired, canceled, ended, all");
  err.status = 400;
  err.code = "INVALID";
  throw err;
}

async function resolveAdminSubscriptionFiltersOrThrow(query = {}, { includeStatus = true } = {}) {
  const q = String(query.q || "").trim();
  const normalizedStatus = normalizeAdminSubscriptionStatusOrThrow(query.status);
  const parsedFrom = query.from ? parseDateFilterOrNull(query.from, { bound: "start" }) : null;
  if (query.from && !parsedFrom) {
    const err = new Error("from must be a valid date");
    err.status = 400;
    err.code = "INVALID";
    throw err;
  }
  const parsedTo = query.to ? parseDateFilterOrNull(query.to, { bound: "end" }) : null;
  if (query.to && !parsedTo) {
    const err = new Error("to must be a valid date");
    err.status = 400;
    err.code = "INVALID";
    throw err;
  }
  if (parsedFrom && parsedTo && parsedFrom.value > parsedTo.value) {
    const err = new Error("from must be before or equal to to");
    err.status = 400;
    err.code = "INVALID";
    throw err;
  }

  const match = {};
  if (includeStatus && normalizedStatus) {
    if (normalizedStatus === "ended") {
      match.status = { $in: ["expired", "canceled"] };
    } else {
      match.status = normalizedStatus;
    }
  }

  if (query.from || query.to) {
    match.startDate = {};
    if (parsedFrom) match.startDate[parsedFrom.operator] = parsedFrom.value;
    if (parsedTo) match.startDate[parsedTo.operator] = parsedTo.value;
  }

  if (!q) {
    return {
      q: "",
      normalizedStatus,
      from: query.from ? String(query.from).trim() : null,
      to: query.to ? String(query.to).trim() : null,
      match,
    };
  }

  const regex = new RegExp(escapeRegExp(q), "i");
  const exactObjectId = mongoose.Types.ObjectId.isValid(q) ? new mongoose.Types.ObjectId(q) : null;
  const displaySuffix = parseAdminSubscriptionDisplaySuffix(q);
  const [users, plans, displayRows] = await Promise.all([
    User.find({
      role: "client",
      $or: [{ name: regex }, { phone: regex }, { email: regex }],
    })
      .select("_id")
      .limit(200)
      .lean(),
    Plan.find({
      $or: [{ "name.ar": regex }, { "name.en": regex }],
    })
      .select("_id")
      .limit(200)
      .lean(),
    displaySuffix ? findSubscriptionsByDisplaySuffix(displaySuffix, 200) : Promise.resolve([]),
  ]);

  const orFilters = [
    ...(users.length ? [{ userId: { $in: users.map((user) => user._id) } }] : []),
    ...(plans.length ? [{ planId: { $in: plans.map((plan) => plan._id) } }] : []),
    ...(exactObjectId ? [{ _id: exactObjectId }] : []),
    ...(displayRows.length ? [{ _id: { $in: displayRows.map((row) => row._id) } }] : []),
  ];

  if (!orFilters.length) {
    match._id = { $exists: false };
  } else {
    match.$or = orFilters;
  }

  return {
    q,
    normalizedStatus,
    from: query.from ? String(query.from).trim() : null,
    to: query.to ? String(query.to).trim() : null,
    match,
  };
}

async function fetchAdminSubscriptionsPayload(query = {}, {
  paginate = true,
  includeStatus = true,
} = {}) {
  const filters = await resolveAdminSubscriptionFiltersOrThrow(query, { includeStatus });
  const pagination = paginate ? resolvePagination(query) : null;
  if (pagination && pagination.error) {
    const err = new Error(pagination.error.message);
    err.status = pagination.error.status;
    err.code = pagination.error.code;
    throw err;
  }

  const skip = pagination ? (pagination.page - 1) * pagination.limit : 0;
  const queryBuilder = Subscription.find(filters.match).sort({ createdAt: -1 });
  if (pagination) {
    queryBuilder.skip(skip).limit(pagination.limit);
  }

  const [subscriptions, total] = await Promise.all([
    queryBuilder.lean(),
    Subscription.countDocuments(filters.match),
  ]);
  const userIds = Array.from(new Set(subscriptions.map((subscription) => String(subscription.userId)).filter(Boolean)));
  const lang = String(query.lang || "ar");
  const [userMap, catalog] = await Promise.all([
    defaultRuntime.buildUserMapByIds(userIds),
    loadSubscriptionSummaryCatalog(subscriptions, lang),
  ]);

  return {
    filters,
    pagination,
    total,
    data: subscriptions.map((subscription) =>
      serializeSubscriptionAdminFromCatalog(subscription, userMap.get(String(subscription.userId)) || null, catalog)),
  };
}

async function performAdminSubscriptionsSearch(query = {}) {
  return fetchAdminSubscriptionsPayload(query, { paginate: true, includeStatus: true });
}


// End of fetchAdminSubscriptionsPayload related logic

module.exports = {
  resolveEffectiveSubscriptionStatus,
  buildSubscriptionOperationsMeta,
  buildFreezePreview,
  loadSubscriptionSummaryCatalog,
  serializeSubscriptionAdminFromCatalog,
  resolveAdminSubscriptionFiltersOrThrow,
  fetchAdminSubscriptionsPayload,
  performAdminSubscriptionsSearch,
  normalizeAdminSubscriptionStatusOrThrow,
};

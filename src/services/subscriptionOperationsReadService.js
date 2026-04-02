"use strict";

const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const Setting = require("../models/Setting");
const dateUtils = require("../utils/date");
const { addDaysToKSADateString } = dateUtils;
const { resolveSubscriptionFreezePolicy } = require("./subscriptionContractReadService");
const {
  getGlobalSkipAllowance,
  countAlreadySkippedDays,
} = require("./subscriptionService");

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
  async getSkipAllowance() {
    return getGlobalSkipAllowance();
  },
  async countSkippedDays(subscriptionId) {
    return countAlreadySkippedDays(subscriptionId);
  },
  async getCutoffTime() {
    const setting = await Setting.findOne({ key: "cutoff_time" }).lean();
    return setting && setting.value ? String(setting.value) : "00:00";
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

  const [frozenDays, skipAllowance, skippedCount] = await Promise.all([
    runtime.findFrozenDays(subscriptionId),
    runtime.getSkipAllowance(),
    runtime.countSkippedDays(subscriptionId),
  ]);

  const frozenDateStrings = frozenDays
    .map((day) => day && day.date)
    .filter((date) => typeof date === "string")
    .sort();
  const frozenDaysUsed = frozenDateStrings.length;
  const frozenBlocksUsed = countFrozenBlocks(frozenDateStrings);
  const activeWriteEligible = effectiveStatus === "active" && subscription.status === "active";

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
          canSubmit: activeWriteEligible,
          reasonCode: activeWriteEligible
            ? null
            : effectiveStatus === "expired"
              ? "SUB_EXPIRED"
              : "SUB_INACTIVE",
          policy: {
            allowanceScope: "global_setting",
            skipAllowance: Number(skipAllowance || 0),
            compensationMode: "none",
          },
          usage: {
            skippedCount: Number(skippedCount || 0),
            skipRemaining: Math.max(Number(skipAllowance || 0) - Number(skippedCount || 0), 0),
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

module.exports = {
  resolveEffectiveSubscriptionStatus,
  buildSubscriptionOperationsMeta,
  buildFreezePreview,
};

"use strict";

const SubscriptionEntitlementBatch = require("../../models/SubscriptionEntitlementBatch");
const { logger } = require("../../utils/logger");
const {
  isSubscriptionStackingReadEnabled,
} = require("../../utils/featureFlags");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const {
  isReadStackingEnabledForUser,
  isWriteStackingEnabledForUser,
} = require("./subscriptionStackingRolloutPolicyService");
const {
  normalizeDateString,
  projectSubscriptionEntitlements,
} = require("./subscriptionEntitlementProjectionService");

const TIMELINE_READ_EVENT = "subscription_stacking_timeline_read";

function timelineReadError(code, message, status = 503, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function resolveSelectedCount(day = {}) {
  if (day.meals && day.meals.selected !== undefined) {
    return normalizeCount(day.meals.selected);
  }
  if (day.selectedMeals !== undefined) return normalizeCount(day.selectedMeals);
  if (Array.isArray(day.mealSlots)) {
    return day.mealSlots.filter((slot) => slot && slot.status === "complete").length;
  }
  return 0;
}

function applyProjectionToTimelineDay(day, projection) {
  const required = normalizeCount(projection && projection.requiredMealsPerDay);
  const selected = resolveSelectedCount(day);
  const specified = normalizeCount(
    day && day.specifiedMealCount !== undefined ? day.specifiedMealCount : selected
  );
  const isSatisfied = required > 0 && selected >= required;
  const dailyMeals = day && day.dailyMeals && typeof day.dailyMeals === "object"
    ? day.dailyMeals
    : {};
  const meals = day && day.meals && typeof day.meals === "object"
    ? day.meals
    : {};

  return {
    ...day,
    selectedMeals: selected,
    requiredMeals: required,
    requiredMealCount: required,
    specifiedMealCount: specified,
    unspecifiedMealCount: Math.max(0, required - specified),
    meals: {
      ...meals,
      selected,
      required,
      isSatisfied,
    },
    dailyMeals: {
      ...dailyMeals,
      selected,
      required,
      remaining: Math.max(0, required - selected),
      isComplete: isSatisfied,
    },
    ...(day.plannerMeta && typeof day.plannerMeta === "object"
      ? {
        plannerMeta: {
          ...day.plannerMeta,
          requiredSlotCount: required,
        },
      }
      : {}),
    ...(day.planningMeta && typeof day.planningMeta === "object"
      ? {
        planningMeta: {
          ...day.planningMeta,
          requiredMealCount: required,
          isExactCountSatisfied: isSatisfied,
        },
      }
      : {}),
    ...(day.planning && typeof day.planning === "object"
      ? {
        planning: {
          ...day.planning,
          requiredMealCount: required,
          isExactCountSatisfied: isSatisfied,
        },
      }
      : {}),
  };
}

function rebuildMonthSummary(days = []) {
  const byKey = new Map();
  for (const day of days) {
    const calendar = day && day.calendar;
    const year = calendar && calendar.year;
    const month = calendar && calendar.month;
    if (!year || !month || !month.number) continue;
    const key = `${year}-${String(month.number).padStart(2, "0")}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        year,
        month,
        monthYearLabels: calendar.monthYearLabels || {},
        dayCount: 0,
      });
    }
    byKey.get(key).dayCount += 1;
  }
  return Array.from(byKey.values());
}

function filterTimelineVisibleBatches(batches, businessDate) {
  const currentDate = normalizeDateString(businessDate);
  return (Array.isArray(batches) ? batches : []).filter((batch) => {
    if (!batch) return false;
    if (String(batch.status || "") !== "paid_scheduled") return true;
    const startDate = normalizeDateString(batch.effectiveStartDate);
    return Boolean(currentDate && startDate && startDate <= currentDate);
  });
}

function applyProjectionToTimelineResult(timeline, batches, businessDate) {
  if (!timeline || typeof timeline !== "object" || !Array.isArray(timeline.days)) {
    return timeline;
  }

  const visibleBatches = filterTimelineVisibleBatches(batches, businessDate);
  const projectedDays = [];
  for (const day of timeline.days) {
    if (!day || !day.date) continue;
    const projection = projectSubscriptionEntitlements({
      batches: visibleBatches,
      businessDate: day.date,
      historicalLifecycle: true,
    });
    if (projection.batchCount === 0) continue;
    projectedDays.push(applyProjectionToTimelineDay(day, projection));
  }

  const currentProjection = projectSubscriptionEntitlements({
    batches: visibleBatches,
    businessDate,
  });
  const currentRequired = normalizeCount(currentProjection.requiredMealsPerDay);
  const currentRemaining = normalizeCount(currentProjection.mealBalance.remainingMeals);
  const currentTotal = normalizeCount(currentProjection.mealBalance.totalMeals);
  const canConsumeNow = currentProjection.batchCount > 0 && currentRemaining > 0;

  return {
    ...timeline,
    days: projectedDays,
    months: rebuildMonthSummary(projectedDays),
    dailyMealsRequired: currentRequired,
    dailyMealsConfig: {
      ...(timeline.dailyMealsConfig && typeof timeline.dailyMealsConfig === "object"
        ? timeline.dailyMealsConfig
        : {}),
      required: currentRequired,
    },
    mealBalance: {
      ...(timeline.mealBalance && typeof timeline.mealBalance === "object"
        ? timeline.mealBalance
        : {}),
      totalMeals: currentTotal,
      remainingMeals: currentRemaining,
      availableMeals: currentRemaining,
      reservedMeals: normalizeCount(currentProjection.mealBalance.reservedMeals),
      consumedMeals: normalizeCount(currentProjection.mealBalance.consumedMeals),
      forfeitedMeals: normalizeCount(currentProjection.mealBalance.forfeitedMeals),
      canConsumeNow,
      maxConsumableMealsNow: canConsumeNow ? currentRemaining : 0,
      mealBalancePolicy: "TOTAL_BALANCE_WITHIN_VALIDITY",
      dailyMealLimitEnforced: false,
      dailyMealsDefault: currentRequired,
    },
  };
}

function defaultRuntime() {
  return {
    globallyEnabled: () => isSubscriptionStackingReadEnabled(),
    readEnabledForUser: (userId) => isReadStackingEnabledForUser(userId),
    writeEnabledForUser: (userId) => isWriteStackingEnabledForUser(userId),
    getBusinessDate: () => getRestaurantBusinessDate(),
    async findBatchesByContainer(containerSubscriptionId) {
      return SubscriptionEntitlementBatch.find({
        containerSubscriptionId,
      }).sort({ effectiveStartDate: 1, createdAt: 1, _id: 1 }).lean();
    },
    info: (message, meta) => logger.info(message, meta),
    error: (message, meta) => logger.error(message, meta),
  };
}

function resolveRuntime(runtimeOverrides = null) {
  const runtime = defaultRuntime();
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return runtime;
  }
  return { ...runtime, ...runtimeOverrides };
}

function createTimelineReadWrapper(original, runtimeOverrides = null) {
  if (typeof original !== "function") {
    throw new TypeError("original timeline builder must be a function");
  }
  const runtime = resolveRuntime(runtimeOverrides);

  return async function buildSubscriptionTimelineWithStackingRead(
    subscriptionId,
    options = {}
  ) {
    const timeline = await original(subscriptionId, options);
    if (!runtime.globallyEnabled()) return timeline;

    let userId = "";
    try {
      const batches = await runtime.findBatchesByContainer(subscriptionId);
      if (!Array.isArray(batches) || batches.length === 0) return timeline;
      userId = String(batches[0] && batches[0].userId || "");
      if (!runtime.readEnabledForUser(userId)) return timeline;

      if (!timeline || typeof timeline !== "object" || !Array.isArray(timeline.days)) {
        throw timelineReadError(
          "STACKING_TIMELINE_SHAPE_INVALID",
          "Stacking timeline projection requires a valid days array",
          503,
          { hasTimeline: Boolean(timeline), daysType: typeof (timeline && timeline.days) }
        );
      }

      const embeddedBusinessDate = String(
        options.businessDate
        || timeline.businessDate
        || timeline.mealBalance && timeline.mealBalance.businessDate
        || ""
      );
      const businessDate = embeddedBusinessDate || String(await runtime.getBusinessDate() || "");
      if (!businessDate) {
        throw timelineReadError(
          "STACKING_TIMELINE_BUSINESS_DATE_MISSING",
          "Stacking timeline projection requires businessDate"
        );
      }

      const projected = applyProjectionToTimelineResult(
        timeline,
        batches,
        businessDate
      );
      runtime.info(TIMELINE_READ_EVENT, {
        outcome: "projection_applied",
        userId,
        subscriptionId: String(subscriptionId),
        businessDate,
        batchCount: batches.length,
        visibleDayCount: Array.isArray(projected.days) ? projected.days.length : 0,
      });
      return projected;
    } catch (err) {
      runtime.error(TIMELINE_READ_EVENT, {
        outcome: "error",
        userId: userId || null,
        subscriptionId: String(subscriptionId),
        error: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : undefined,
      });
      if (userId && runtime.writeEnabledForUser(userId)) {
        throw timelineReadError(
          "STACKING_TIMELINE_READ_UNAVAILABLE",
          "Stacking timeline is temporarily unavailable",
          503,
          { cause: err && err.message ? err.message : String(err) }
        );
      }
      return timeline;
    }
  };
}

module.exports = {
  TIMELINE_READ_EVENT,
  applyProjectionToTimelineDay,
  applyProjectionToTimelineResult,
  createTimelineReadWrapper,
  filterTimelineVisibleBatches,
  rebuildMonthSummary,
};

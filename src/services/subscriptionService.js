const { addDays } = require("date-fns");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");
const { createLocalizedError } = require("../utils/errorLocalization");
const { toKSADateString, addDaysToKSADateString } = require("../utils/date");
const { resolveMealsPerDay } = require("../utils/subscriptionDaySelectionSync");
const { formatMealsLabel } = require("../utils/subscriptionCatalog");
const { buildProjectedDayEntry } = require("./recurringAddonService");
const { resolveSubscriptionSkipPolicy } = require("./subscriptionContractReadService");
const { getRemainingPremiumCredits } = require("../services/genericPremiumWalletService");

/**
 * @typedef {import("../types/subscriptionTimeline").TimelineDay} TimelineDay
 * @typedef {import("../types/subscriptionTimeline").SubscriptionTimeline} SubscriptionTimeline
 */

function buildSkipDisabledError() {
  return createLocalizedError({
    code: "SKIP_DISABLED",
    status: 422,
    key: "errors.subscription.skipDisabled",
    fallbackMessage: "Skip is disabled for this plan",
  });
}

function buildValidityShrinkConflictError(newValidityEndStr, conflictDay) {
  return createLocalizedError({
    code: "VALIDITY_SHRINK_CONFLICT",
    key: "errors.subscription.validityShrinkConflict",
    params: { validityDate: newValidityEndStr, dayDate: conflictDay.date },
    fallbackMessage: `Cannot shrink validity to ${newValidityEndStr} because day ${conflictDay.date} has active data`,
  });
}

async function countCompensatedSkipDays(subscriptionId, session) {
  const query = SubscriptionDay.countDocuments({
    subscriptionId,
    status: "skipped",
    skipCompensated: true,
  });
  if (session) query.session(session);
  return query;
}

async function countAlreadySkippedDays(subscriptionId, session) {
  return countCompensatedSkipDays(subscriptionId, session);
}

async function countFrozenDays(subscriptionId, session) {
  const query = SubscriptionDay.countDocuments({
    subscriptionId,
    status: "frozen",
  });
  if (session) query.session(session);
  return query;
}

async function listCompensationSourceDays(subscriptionId, session) {
  const query = SubscriptionDay.find({
    subscriptionId,
    $or: [
      { status: "frozen" },
      { status: "skipped", skipCompensated: true },
    ],
  }).select("date status canonicalDayActionType skipCompensated");
  if (session) query.session(session);
  return query.lean();
}

function resolveCompensationTokenType(day) {
  if (!day || typeof day !== "object") return null;
  if (day.canonicalDayActionType === "freeze" || day.status === "frozen") {
    return "freeze";
  }
  if (
    day.skipCompensated
    && (day.canonicalDayActionType === "skip" || day.status === "skipped")
  ) {
    return "skip";
  }
  return null;
}

function sortCompensationTokens(tokens = []) {
  return [...tokens].sort((left, right) => {
    if (left.sourceDate !== right.sourceDate) {
      return left.sourceDate.localeCompare(right.sourceDate);
    }
    if (left.type === right.type) {
      return 0;
    }
    return left.type === "freeze" ? -1 : 1;
  });
}

async function getCompensationSnapshot(subscriptionId, session) {
  const sourceDays = await listCompensationSourceDays(subscriptionId, session);
  const tokens = sortCompensationTokens(
    sourceDays
      .map((day) => {
        const type = resolveCompensationTokenType(day);
        if (!type || typeof day.date !== "string") {
          return null;
        }
        return { type, sourceDate: day.date };
      })
      .filter(Boolean)
  );

  const freezeCount = tokens.filter((token) => token.type === "freeze").length;
  const skipCount = tokens.filter((token) => token.type === "skip").length;

  return {
    tokens,
    freezeCount,
    skipCount,
    totalCount: tokens.length,
  };
}

function buildExtensionSourceMap(tokens = [], endDateStr) {
  const extensionSourceMap = new Map();
  tokens.forEach((token, index) => {
    const extensionDate = addDaysToKSADateString(endDateStr, index + 1);
    extensionSourceMap.set(
      extensionDate,
      token.type === "freeze" ? "freeze_compensation" : "skip_compensation"
    );
  });
  return extensionSourceMap;
}

function buildRollbackUpdate(existingDay) {
  const rollbackUpdate = {
    $set: {
      status: existingDay?.status || "open",
      skippedByUser: existingDay?.skippedByUser || false,
      skipCompensated: existingDay?.skipCompensated || false,
      creditsDeducted: existingDay?.creditsDeducted || false,
    },
  };

  if (existingDay?.canonicalDayActionType !== undefined && existingDay?.canonicalDayActionType !== null) {
    rollbackUpdate.$set.canonicalDayActionType = existingDay.canonicalDayActionType;
  } else {
    rollbackUpdate.$unset = { canonicalDayActionType: 1 };
  }

  return rollbackUpdate;
}

async function rollbackDaySkipMutation({ dayId, existingDay, session }) {
  await SubscriptionDay.updateOne(
    { _id: dayId },
    buildRollbackUpdate(existingDay),
    { session }
  ).session(session);
}

/**
 * P2-S7-S2 — authoritative recomputation of validity based on all compensated days.
 * Rule: validityEndDate = endDate + frozenDays + compensatedSkipDays.
 */
async function syncSubscriptionValidity(subscription, session) {
  const baseEndDate = subscription.endDate;
  if (!baseEndDate) {
    throw createLocalizedError({
      code: "INVALID_SUB_DATA",
      key: "errors.subscription.baseEndDateMissing",
      fallbackMessage: "Subscription has no base end date",
    });
  }

  const compensation = await getCompensationSnapshot(subscription._id, session);
  const newValidityEndDate = addDays(baseEndDate, compensation.totalCount);
  const currentValidityEndDate = subscription.validityEndDate || baseEndDate;

  const newValidityEndStr = toKSADateString(newValidityEndDate);
  const currentValidityEndStr = toKSADateString(currentValidityEndDate);
  const baseEndStr = toKSADateString(baseEndDate);

  if (newValidityEndStr > currentValidityEndStr) {
    const existingDays = await SubscriptionDay.find({
      subscriptionId: subscription._id,
      date: { $gt: currentValidityEndStr, $lte: newValidityEndStr },
    })
      .select("date")
      .session(session)
      .lean();

    const existingDates = new Set(existingDays.map((day) => day.date));
    const daysToAdd = [];

    for (
      let currentDate = addDaysToKSADateString(currentValidityEndStr, 1);
      currentDate <= newValidityEndStr;
      currentDate = addDaysToKSADateString(currentDate, 1)
    ) {
      if (!existingDates.has(currentDate)) {
        daysToAdd.push(
          buildProjectedDayEntry({
            subscription,
            date: currentDate,
            status: "open",
          })
        );
      }
    }

    if (daysToAdd.length > 0) {
      await SubscriptionDay.insertMany(daysToAdd, { session });
    }
  }

  if (newValidityEndStr < currentValidityEndStr) {
    const extraDays = await SubscriptionDay.find({
      subscriptionId: subscription._id,
      date: { $gt: newValidityEndStr },
    }).session(session);

    const daysToDelete = extraDays.filter((day) => {
      const isBeyondBase = day.date > baseEndStr;
      return isBeyondBase && isRemovableExtensionDay(day);
    });

    const conflictDay = extraDays.find((day) => !isRemovableExtensionDay(day));
    if (conflictDay) {
      throw buildValidityShrinkConflictError(newValidityEndStr, conflictDay);
    }

    if (daysToDelete.length > 0) {
      await SubscriptionDay.deleteMany({
        _id: { $in: daysToDelete.map((day) => day._id) },
      }).session(session);
    }
  }

  subscription.validityEndDate = newValidityEndDate;
  await subscription.save({ session });

  return {
    validityEndDate: newValidityEndDate,
    frozenCount: compensation.freezeCount,
    compensatedSkipCount: compensation.skipCount,
    totalCompensationCount: compensation.totalCount,
    compensationTokens: compensation.tokens,
  };
}

function isRemovableExtensionDay(day) {
  if (Array.isArray(day.selections) && day.selections.length > 0) return false;
  if (Array.isArray(day.premiumSelections) && day.premiumSelections.length > 0) return false;
  if (Array.isArray(day.premiumUpgradeSelections) && day.premiumUpgradeSelections.length > 0) return false;
  if (Array.isArray(day.addonCreditSelections) && day.addonCreditSelections.length > 0) return false;
  if (day.assignedByKitchen || day.pickupRequested || day.creditsDeducted || day.skippedByUser) return false;
  if (day.lockedSnapshot || day.fulfilledSnapshot || day.lockedAt || day.fulfilledAt) return false;
  if (["locked", "fulfilled", "delivery_canceled"].includes(day.status)) return false;
  return true;
}

async function applyCompensatedSkipForDate({
  sub,
  date,
  session,
  syncValidityAfterApply = true,
}) {
  const existingDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);

  const policy = resolveSubscriptionSkipPolicy(sub, sub.planId, {
    context: "apply_skip_for_date",
  });

  if (existingDay && existingDay.status === "skipped") {
    return { status: "already_skipped", day: existingDay, policy };
  }

  if (existingDay && existingDay.status === "frozen") {
    return { status: "frozen", day: existingDay, policy };
  }

  if (existingDay && existingDay.status === "fulfilled") {
    return { status: "fulfilled", day: existingDay, policy };
  }

  if (existingDay && existingDay.status !== "open") {
    return { status: "locked", day: existingDay, policy };
  }

  if (!policy.enabled) {
    return { status: "skip_disabled", policy };
  }

  if (!policy.maxDays) {
    return { status: "limit_reached", day: existingDay, policy };
  }

  let dayUpdateResult;
  if (!existingDay) {
    const created = await SubscriptionDay.create(
      [{
        subscriptionId: sub._id,
        date,
        status: "skipped",
        skippedByUser: true,
        skipCompensated: true,
        creditsDeducted: false,
        canonicalDayActionType: "skip",
      }],
      { session }
    );
    dayUpdateResult = created[0];
  } else {
    dayUpdateResult = await SubscriptionDay.findOneAndUpdate(
      { _id: existingDay._id, status: "open" },
      {
        $set: {
          status: "skipped",
          skippedByUser: true,
          skipCompensated: true,
          creditsDeducted: false,
          canonicalDayActionType: "skip",
        },
      },
      { new: true, session }
    );
    if (!dayUpdateResult) {
      return { status: "locked", day: existingDay, policy };
    }
  }

  const updatedSubscription = await Subscription.findOneAndUpdate(
    {
      _id: sub._id,
      $or: [
        { skipDaysUsed: { $lt: policy.maxDays } },
        { skipDaysUsed: { $exists: false } },
      ],
    },
    { $inc: { skipDaysUsed: 1 } },
    { new: true, session }
  );

  if (!updatedSubscription) {
    await rollbackDaySkipMutation({
      dayId: dayUpdateResult._id,
      existingDay,
      session,
    });
    return { status: "limit_reached", day: existingDay, policy };
  }

  sub.skipDaysUsed = Number(updatedSubscription.skipDaysUsed || 0);

  let validitySync = null;
  if (syncValidityAfterApply) {
    validitySync = await syncSubscriptionValidity(sub, session);
  }

  return {
    status: "skipped",
    day: dayUpdateResult,
    policy,
    compensatedDaysAdded: 1,
    validitySync,
  };
}

async function applyOperationalSkipForDate({ sub, date, session }) {
  const existingDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date }).session(session);

  if (existingDay && existingDay.status === "skipped") {
    return { status: "already_skipped", day: existingDay };
  }

  if (existingDay && existingDay.status === "frozen") {
    return { status: "frozen", day: existingDay };
  }

  if (existingDay && existingDay.status === "fulfilled") {
    return { status: "fulfilled", day: existingDay };
  }

  const mealsToDeduct = resolveMealsPerDay(sub);

  let dayUpdateResult;
  if (!existingDay) {
    const created = await SubscriptionDay.create(
      [{
        subscriptionId: sub._id,
        date,
        status: "skipped",
        skippedByUser: false,
        skipCompensated: false,
        creditsDeducted: true,
        canonicalDayActionType: "skip",
      }],
      { session }
    );
    dayUpdateResult = created[0];
  } else {
    dayUpdateResult = await SubscriptionDay.findOneAndUpdate(
      { _id: existingDay._id, status: { $ne: "fulfilled" } },
      {
        $set: {
          status: "skipped",
          skippedByUser: false,
          skipCompensated: false,
          creditsDeducted: true,
          canonicalDayActionType: "skip",
        },
      },
      { new: true, session }
    );
    if (!dayUpdateResult) {
      return { status: "fulfilled", day: existingDay };
    }
  }

  const updatedSubscription = await Subscription.findOneAndUpdate(
    { _id: sub._id, remainingMeals: { $gte: mealsToDeduct } },
    { $inc: { remainingMeals: -mealsToDeduct, skippedCount: 1 } },
    { new: true, session }
  );

  if (!updatedSubscription) {
    await rollbackDaySkipMutation({
      dayId: dayUpdateResult._id,
      existingDay,
      session,
    });
    return { status: "insufficient_credits" };
  }

  sub.remainingMeals = Number(updatedSubscription.remainingMeals || 0);
  sub.skippedCount = Number(updatedSubscription.skippedCount || 0);

  return { status: "skipped", day: dayUpdateResult };
}

const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_KEYS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const DATE_LABEL_FORMATTERS = {
  ar: {
    weekdayLong: new Intl.DateTimeFormat("ar-EG-u-ca-gregory", { weekday: "long", timeZone: "UTC" }),
    weekdayShort: new Intl.DateTimeFormat("ar-EG-u-ca-gregory", { weekday: "short", timeZone: "UTC" }),
    monthLong: new Intl.DateTimeFormat("ar-EG-u-ca-gregory", { month: "long", timeZone: "UTC" }),
    monthShort: new Intl.DateTimeFormat("ar-EG-u-ca-gregory", { month: "short", timeZone: "UTC" }),
    fullDate: new Intl.DateTimeFormat("ar-EG-u-ca-gregory", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  },
  en: {
    weekdayLong: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }),
    weekdayShort: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }),
    monthLong: new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }),
    monthShort: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }),
    fullDate: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  },
};

function buildUtcDateFromDateString(dateStr) {
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function buildTimelineCalendar(dateStr) {
  const date = buildUtcDateFromDateString(dateStr);
  const weekdayIndex = date.getUTCDay();
  const monthIndex = date.getUTCMonth();
  const year = date.getUTCFullYear();

  const weekday = {
    index: weekdayIndex,
    key: WEEKDAY_KEYS[weekdayIndex],
    labels: {
      ar: DATE_LABEL_FORMATTERS.ar.weekdayLong.format(date),
      en: DATE_LABEL_FORMATTERS.en.weekdayLong.format(date),
    },
    shortLabels: {
      ar: DATE_LABEL_FORMATTERS.ar.weekdayShort.format(date),
      en: DATE_LABEL_FORMATTERS.en.weekdayShort.format(date),
    },
  };

  const month = {
    number: monthIndex + 1,
    key: MONTH_KEYS[monthIndex],
    labels: {
      ar: DATE_LABEL_FORMATTERS.ar.monthLong.format(date),
      en: DATE_LABEL_FORMATTERS.en.monthLong.format(date),
    },
    shortLabels: {
      ar: DATE_LABEL_FORMATTERS.ar.monthShort.format(date),
      en: DATE_LABEL_FORMATTERS.en.monthShort.format(date).toUpperCase(),
    },
  };

  return {
    year,
    dayOfMonth: date.getUTCDate(),
    weekday,
    month,
    monthYearLabels: {
      ar: `${month.labels.ar} ${year}`,
      en: `${month.labels.en} ${year}`,
    },
    fullDateLabels: {
      ar: DATE_LABEL_FORMATTERS.ar.fullDate.format(date),
      en: DATE_LABEL_FORMATTERS.en.fullDate.format(date),
    },
  };
}

function normalizeTimelineStatus(rawStatus) {
  switch (rawStatus) {
    case "open":
      return "open";
    case "fulfilled":
      return "delivered";
    case "delivery_canceled":
      return "delivery_canceled";
    case "canceled_at_branch":
      return "canceled_at_branch";
    case "no_show":
      return "no_show";
    case "locked":
    case "in_preparation":
    case "out_for_delivery":
    case "ready_for_pickup":
      return "locked";
    case "frozen":
      return "frozen";
    case "skipped":
      return "skipped";
    default:
      return "open";
  }
}

function normalizeTimelineCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function countSelectedBaseMeals(dbDay) {
  const planningCount = normalizeTimelineCount(dbDay?.planningMeta?.selectedBaseMealCount);
  if (planningCount !== null) return planningCount;

  const slotCount = Array.isArray(dbDay?.baseMealSlots)
    ? dbDay.baseMealSlots.filter((slot) => slot && slot.mealId).length
    : 0;
  if (slotCount > 0) return slotCount;

  return Array.isArray(dbDay?.selections) ? dbDay.selections.filter(Boolean).length : 0;
}

function countSelectedPremiumMeals(dbDay) {
  const planningCount = normalizeTimelineCount(dbDay?.planningMeta?.selectedPremiumMealCount);
  if (planningCount !== null) return planningCount;

  const directPremiumCount = Array.isArray(dbDay?.premiumSelections)
    ? dbDay.premiumSelections.filter(Boolean).length
    : 0;
  if (directPremiumCount > 0) return directPremiumCount;

  return Array.isArray(dbDay?.premiumUpgradeSelections)
    ? dbDay.premiumUpgradeSelections.filter((selection) => selection && selection.premiumMealId).length
    : 0;
}

function buildTimelineMeals(subscription, dbDay) {
  const fallbackRequired = resolveMealsPerDay(subscription);
  const requiredPlanningCount = normalizeTimelineCount(dbDay?.planningMeta?.requiredMealCount);
  const required = requiredPlanningCount && requiredPlanningCount > 0
    ? requiredPlanningCount
    : fallbackRequired;
  const selectedPlanningCount = normalizeTimelineCount(dbDay?.planningMeta?.selectedTotalMealCount);
  const selected = selectedPlanningCount !== null
    ? selectedPlanningCount
    : countSelectedBaseMeals(dbDay) + countSelectedPremiumMeals(dbDay);
  const isSatisfied = typeof dbDay?.planningMeta?.isExactCountSatisfied === "boolean"
    ? dbDay.planningMeta.isExactCountSatisfied
    : selected > 0 && selected === required;

  return {
    selected,
    required,
    isSatisfied,
  };
}

function buildTimelineDailyMeals(meals) {
  const selected = Number(meals && meals.selected) || 0;
  const required = Number(meals && meals.required) || 0;
  const isComplete = Boolean(meals && meals.isSatisfied);
  const remaining = Math.max(0, required - selected);

  return {
    selected,
    required,
    remaining,
    isComplete,
    titleLabels: {
      ar: "الوجبات اليومية",
      en: "Daily Meals",
    },
    requiredLabels: {
      ar: formatMealsLabel(required, "ar", true),
      en: formatMealsLabel(required, "en", true),
    },
    summaryLabels: {
      ar: `${selected} من ${required} مختارة`,
      en: `${selected} of ${required} selected`,
    },
  };
}

function buildTimelineMonthSummary(days = []) {
  const byMonth = new Map();

  for (const day of days) {
    const calendar = day && day.calendar;
    if (!calendar || !calendar.month || !calendar.month.key) continue;

    const monthKey = `${calendar.year}-${String(calendar.month.number).padStart(2, "0")}`;
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, {
        key: monthKey,
        year: calendar.year,
        month: {
          number: calendar.month.number,
          key: calendar.month.key,
          labels: { ...calendar.month.labels },
          shortLabels: { ...calendar.month.shortLabels },
        },
        monthYearLabels: { ...calendar.monthYearLabels },
        dayCount: 0,
      });
    }

    byMonth.get(monthKey).dayCount += 1;
  }

  return Array.from(byMonth.values());
}

async function buildSubscriptionTimeline(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription) {
    const err = new Error("Subscription not found");
    err.code = "SUBSCRIPTION_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const startDateStr = toKSADateString(subscription.startDate);
  const endDateStr = toKSADateString(subscription.endDate);
  const validityEndDateStr = toKSADateString(subscription.validityEndDate || subscription.endDate);

  const [days, compensation] = await Promise.all([
    SubscriptionDay.find({ subscriptionId }).lean(),
    getCompensationSnapshot(subscriptionId),
  ]);
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const extensionSourceMap = buildExtensionSourceMap(compensation.tokens, endDateStr);
  const requiredMealsPerDay = resolveMealsPerDay(subscription);

  const timelineDays = [];

  for (
    let currentDate = startDateStr;
    currentDate <= validityEndDateStr;
    currentDate = addDaysToKSADateString(currentDate, 1)
  ) {
    const dbDay = dayMap.get(currentDate);
    const isExtension = currentDate > endDateStr;
    const meals = buildTimelineMeals(subscription, dbDay);
    const calendar = buildTimelineCalendar(currentDate);

    let status;
    if (isExtension) {
      status = "extension";
    } else if (!dbDay) {
      status = "open";
    } else if (dbDay.canonicalDayActionType === "freeze") {
      status = "frozen";
    } else if (dbDay.canonicalDayActionType === "skip") {
      status = "skipped";
    } else {
      const normalizedStatus = normalizeTimelineStatus(dbDay.status);
      status = normalizedStatus === "open" && meals.selected > 0 ? "planned" : normalizedStatus;
    }

    timelineDays.push({
      date: currentDate,
      status,
      source: isExtension ? (extensionSourceMap.get(currentDate) || "freeze_compensation") : "base",
      locked: Boolean(dbDay && (dbDay.lockedSnapshot || status === "locked")),
      isExtension,
      calendar,
      meals,
      dailyMeals: buildTimelineDailyMeals(meals),
    });
  }

  return {
    subscriptionId: String(subscription._id),
    validity: {
      startDate: startDateStr,
      endDate: endDateStr,
      validityEndDate: validityEndDateStr,
      compensationDays: compensation.totalCount,
      freezeCompensationDays: compensation.freezeCount,
      skipCompensationDays: compensation.skipCount,
    },
    months: buildTimelineMonthSummary(timelineDays),
    dailyMealsConfig: {
      required: requiredMealsPerDay,
      labels: {
        ar: formatMealsLabel(requiredMealsPerDay, "ar", true),
        en: formatMealsLabel(requiredMealsPerDay, "en", true),
      },
      titleLabels: {
        ar: "الوجبات اليومية",
        en: "Daily Meals",
      },
    },
    premiumMealsRemaining: getRemainingPremiumCredits(subscription),
    days: timelineDays,
  };
}

module.exports = {
  applyOperationalSkipForDate,
  applySkipForDate: applyCompensatedSkipForDate,
  buildSkipDisabledError,
  countAlreadySkippedDays,
  countCompensatedSkipDays,
  countFrozenDays,
  getCompensationSnapshot,
  syncSubscriptionValidity,
  buildSubscriptionTimeline,
};

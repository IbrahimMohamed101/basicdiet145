const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const { toKSADateString, addDaysToKSADateString } = require("../../utils/date");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { formatMealsLabel } = require("../../utils/subscription/subscriptionCatalog");
const { getRemainingPremiumCredits } = require("../genericPremiumWalletService");
const { getCompensationSnapshot } = require("./subscriptionCompensationService");

/**
 * @typedef {import("../../types/subscriptionTimeline").TimelineDay} TimelineDay
 * @typedef {import("../../types/subscriptionTimeline").SubscriptionTimeline} SubscriptionTimeline
 */

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

module.exports = {
  buildSubscriptionTimeline,
};
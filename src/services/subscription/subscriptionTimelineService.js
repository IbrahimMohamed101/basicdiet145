const mongoose = require("mongoose");
const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Payment = require("../../models/Payment");
const BuilderProtein = require("../../models/BuilderProtein");
const { resolvePremiumKeyFromName } = require("../../utils/subscription/premiumIdentity");
const { toKSADateString, addDaysToKSADateString } = require("../../utils/date");
const { resolveMealsPerDay } = require("../../utils/subscription/subscriptionDaySelectionSync");
const { formatMealsLabel } = require("../../utils/subscription/subscriptionCatalog");
const {
  mapLegacySelectionType,
  NEW_TYPES,
} = require("../../utils/subscription/mealTypeMapper");
const { getCompensationSnapshot } = require("./subscriptionCompensationService");
const { buildDayCommercialState } = require("./subscriptionDayCommercialStateService");
const { buildSubscriptionDayFulfillmentState } = require("./subscriptionDayFulfillmentStateService");
const { getRestaurantBusinessDate } = require("../restaurantHoursService");
// Settlement on read is DISABLED — see pastSubscriptionDaySettlementService.js
const {
  buildFulfillmentReadFields,
  getPickupLocationsSetting,
} = require("./subscriptionFulfillmentSummaryService");
const { resolveReadLabel } = require("../../utils/subscription/subscriptionLocalizationCommon");
const { buildMealBalance } = require("./subscriptionClientSupportService");
const {
  resolveSameDayFulfillmentMethod,
  resolveScheduledDeliveryDateTime,
  DELIVERY_SELECTION_CUTOFF_HOURS,
} = require("./subscriptionDayModificationPolicyService");
const { resolveEffectiveFulfillmentMode } = require("./subscriptionFulfillmentPolicyService");

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
const DAY_PLANNING_PAYMENT_TYPES = [
  "day_planning_payment",
  "premium_extra_day",
  "one_time_addon_day_planning",
];
const TERMINAL_FAILED_PAYMENT_STATUSES = new Set(["failed", "canceled", "expired", "refunded"]);

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
    case "consumed_without_preparation":
      return "consumed_without_preparation";
    case "preparing":
    case "on_the_way":
    case "locked":
    case "in_preparation":
    case "out_for_delivery":
    case "ready_for_pickup":
    case "ready_for_delivery":
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

  // New slot-based count: Total complete slots minus premium count
  if (Array.isArray(dbDay?.mealSlots) && dbDay.mealSlots.length > 0) {
    const completeSlots = dbDay.mealSlots.filter(s => s && s.status === "complete");
    const premiumCount = completeSlots.filter(s => s.isPremium).length;
    return completeSlots.length - premiumCount;
  }

  const slotCount = Array.isArray(dbDay?.baseMealSlots)
    ? dbDay.baseMealSlots.filter((slot) => slot && slot.mealId).length
    : 0;
  if (slotCount > 0) return slotCount;

  return Array.isArray(dbDay?.selections) ? dbDay.selections.filter(Boolean).length : 0;
}

function countSelectedPremiumMeals(dbDay) {
  const planningCount = normalizeTimelineCount(dbDay?.planningMeta?.selectedPremiumMealCount);
  if (planningCount !== null) return planningCount;

  // New slot-based count
  if (Array.isArray(dbDay?.mealSlots) && dbDay.mealSlots.length > 0) {
      return dbDay.mealSlots.filter(s => s && s.status === "complete" && s.isPremium).length;
  }

  const directPremiumCount = Array.isArray(dbDay?.premiumUpgradeSelections)
    ? dbDay.premiumUpgradeSelections.filter(Boolean).length
    : 0;
  if (directPremiumCount > 0) return directPremiumCount;

  return 0;
}

function buildTimelineMeals(subscription, dbDay) {
  const fallbackRequired = resolveMealsPerDay(subscription);
  
  // High priority: Trust plannerMeta from the new slot system
  const plannerMeta = dbDay?.plannerMeta;
  if (plannerMeta && typeof plannerMeta.completeSlotCount === "number") {
    return {
      selected: plannerMeta.completeSlotCount,
      required: plannerMeta.requiredSlotCount || fallbackRequired,
      isSatisfied: Boolean(plannerMeta.isConfirmable || plannerMeta.completeSlotCount === plannerMeta.requiredSlotCount),
    };
  }

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

function normalizeTimelineMealSlots(dbDay) {
  if (!Array.isArray(dbDay?.mealSlots)) return [];

  return dbDay.mealSlots
    .filter((slot) => slot && (slot.slotIndex || slot.slotKey))
    .map((slot) => {
      const selectionType = slot && slot.selectionType
        ? mapLegacySelectionType(slot.selectionType, slot || {})
        : "empty";
      const shouldUseLegacyCarbId = selectionType === NEW_TYPES.STANDARD_MEAL || selectionType === NEW_TYPES.PREMIUM_MEAL;
      const carbs = Array.isArray(slot.carbs) && slot.carbs.length > 0
        ? slot.carbs.map((carb) => ({ carbId: carb.carbId ? String(carb.carbId) : null, grams: Number(carb.grams || 0) }))
        : (shouldUseLegacyCarbId && slot.carbId ? [{ carbId: String(slot.carbId), grams: 300 }] : []);
      const salad = slot.salad || (slot.customSalad && typeof slot.customSalad === "object" ? slot.customSalad : null);

      return {
        slotIndex: Number(slot.slotIndex || 0),
        slotKey: String(slot.slotKey || ""),
        status: String(slot.status || "empty"),
        selectionType,
        proteinId: slot.proteinId ? String(slot.proteinId) : null,
        carbs,
        sandwichId: slot.sandwichId ? String(slot.sandwichId) : null,
        salad,
        isPremium: Boolean(slot.isPremium),
        premiumKey: slot.premiumKey || null,
        premiumSource: slot.premiumSource ? String(slot.premiumSource) : "none",
        premiumExtraFeeHalala: Number(slot.premiumExtraFeeHalala || 0),
      };
    });
}

function getPaymentMetadata(payment) {
  return payment && payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata
    : {};
}

function buildDayPaymentLookup(payments = []) {
  const lookup = new Map();

  for (const payment of Array.isArray(payments) ? payments : []) {
    const metadata = getPaymentMetadata(payment);
    const keys = [
      metadata.dayId ? `id:${String(metadata.dayId)}` : null,
      metadata.date ? `date:${String(metadata.date)}` : null,
    ].filter(Boolean);

    for (const key of keys) {
      const existing = lookup.get(key) || [];
      existing.push(payment);
      lookup.set(key, existing);
    }
  }

  return lookup;
}

function resolveLatestApplicableDayPayment(day, commercialState, paymentLookup) {
  if (!day || !paymentLookup) return null;

  const keys = [
    day._id ? `id:${String(day._id)}` : null,
    day.date ? `date:${String(day.date)}` : null,
  ].filter(Boolean);
  const seen = new Set();
  const candidates = [];

  for (const key of keys) {
    for (const payment of paymentLookup.get(key) || []) {
      const paymentId = payment && payment._id ? String(payment._id) : "";
      if (paymentId && seen.has(paymentId)) continue;
      if (paymentId) seen.add(paymentId);
      candidates.push(payment);
    }
  }

  const currentRevisionHash = String(commercialState && commercialState.plannerRevisionHash || "");
  return candidates.find((payment) => {
    const metadata = getPaymentMetadata(payment);
    return !metadata.revisionHash
      || !currentRevisionHash
      || String(metadata.revisionHash) === currentRevisionHash;
  }) || null;
}

function normalizeTimelinePaymentStatus(payment, commercialState) {
  const rawStatus = String(payment && payment.status || "").trim();
  if (rawStatus === "initiated") return "pending";
  if (rawStatus) return rawStatus;

  const premiumStatus = String(
    commercialState
    && commercialState.premiumExtraPayment
    && commercialState.premiumExtraPayment.status
    || ""
  ).trim();
  if (["pending", "paid", "failed", "expired"].includes(premiumStatus)) {
    return premiumStatus;
  }
  return commercialState
    && commercialState.paymentRequirement
    && commercialState.paymentRequirement.requiresPayment
      ? "required"
      : "not_required";
}

/**
 * Determines whether the delivery selection cutoff has passed for a subscription day.
 *
 * The cutoff is DELIVERY_SELECTION_CUTOFF_HOURS before the start of the delivery window.
 * Only applies to same-day delivery days (date === businessDate).
 * For pickup days or future/past days this always returns { cutoffPassed: false }.
 *
 * @param {{ subscription: object, day: object, date: string, businessDate: string, now: Date }} param0
 * @returns {{ cutoffPassed: boolean, lockDateTime: Date|null, deliveryWindow: string|null }}
 */
function resolveDeliverySelectionCutoffState({ subscription, day, date, businessDate, now }) {
  // Determine effective fulfillment mode (respects day-level override)
  const effectiveMode = resolveEffectiveFulfillmentMode({ subscription, day, date });

  // Only applies to delivery mode, only on today (same-day)
  if (effectiveMode !== "delivery" || date !== businessDate) {
    return { cutoffPassed: false, lockDateTime: null, deliveryWindow: null };
  }

  const schedule = resolveScheduledDeliveryDateTime({ subscription, day, date });
  if (!(schedule.lockDateTime instanceof Date) || Number.isNaN(schedule.lockDateTime.getTime())) {
    return { cutoffPassed: false, lockDateTime: null, deliveryWindow: schedule.deliveryWindow || null };
  }

  return {
    cutoffPassed: now.getTime() >= schedule.lockDateTime.getTime(),
    lockDateTime: schedule.lockDateTime,
    deliveryWindow: schedule.deliveryWindow || null,
    cutoffHours: DELIVERY_SELECTION_CUTOFF_HOURS,
  };
}

function deriveTimelineCanEdit({ subscription, day, businessDate, now = new Date() }) {
  if (!day || String(subscription && subscription.status || "") !== "active") return false;
  if (String(day.status || "open") !== "open") return false;
  if (String(day.plannerState || day.planningState || "draft") === "confirmed") return false;
  if (!day.date || day.date < businessDate) return false;
  if (day.date > businessDate) return true;

  const fulfillmentMethod = resolveSameDayFulfillmentMethod({ subscription, day });
  if (fulfillmentMethod === "pickup") return true;
  if (fulfillmentMethod !== "delivery") return false;

  const schedule = resolveScheduledDeliveryDateTime({ subscription, day, date: day.date });
  return Boolean(
    schedule.lockDateTime instanceof Date
      && !Number.isNaN(schedule.lockDateTime.getTime())
      && now.getTime() < schedule.lockDateTime.getTime()
  );
}

function deriveTimelinePlanningContract({
  subscription,
  day,
  meals,
  commercialState,
  latestPayment = null,
  businessDate,
  now = new Date(),
}) {
  const hasSelection = Boolean(
    day
      && (
        Number(meals && meals.selected || 0) > 0
        || (Array.isArray(day.mealSlots) && day.mealSlots.length > 0)
        || (Array.isArray(day.addonSelections) && day.addonSelections.length > 0)
      )
  );
  const plannerState = String(day && (day.plannerState || day.planningState) || "draft");
  const subscriptionStatus = String(subscription && subscription.status || "");
  const paymentRequirement = commercialState && commercialState.paymentRequirement
    ? commercialState.paymentRequirement
    : {};
  const paymentStatus = normalizeTimelinePaymentStatus(latestPayment, commercialState);
  const paymentFailed = TERMINAL_FAILED_PAYMENT_STATUSES.has(paymentStatus);
  const paymentPending = paymentStatus === "pending" || paymentStatus === "required";
  const isPlanned = Boolean(
    hasSelection
      && plannerState === "confirmed"
      && commercialState
      && commercialState.commercialState === "confirmed"
      && paymentRequirement.requiresPayment !== true
      && subscriptionStatus === "active"
  );

  let timelineStatus = "draft";
  if (!hasSelection) {
    timelineStatus = "empty";
  } else if (paymentFailed) {
    timelineStatus = "failed";
  } else if (paymentRequirement.requiresPayment === true || paymentPending) {
    timelineStatus = "pending_payment";
  } else if (isPlanned) {
    timelineStatus = "planned";
  }

  return {
    hasSelection,
    selectionStatus: hasSelection ? (plannerState === "confirmed" ? "confirmed" : "draft") : "empty",
    paymentStatus,
    orderStatus: "none",
    subscriptionStatus,
    timelineStatus,
    isPlanned,
    canShowAsPlanned: isPlanned,
    canEdit: deriveTimelineCanEdit({ subscription, day, businessDate, now }),
    paymentStateReason: paymentRequirement.blockingReason || null,
  };
}

function resolveTimelineLegacyStatus({ isExtension, day, isPlanned }) {
  if (isExtension) return "extension";
  if (!day) return "open";
  if (day.canonicalDayActionType === "freeze") return "frozen";
  if (day.canonicalDayActionType === "skip") return "skipped";

  const normalizedStatus = normalizeTimelineStatus(day.status);
  return normalizedStatus === "open" && isPlanned ? "planned" : normalizedStatus;
}

function normalizeLegacySelectionIds(dbDay) {
  if (!Array.isArray(dbDay?.selections)) return [];
  return dbDay.selections.filter(Boolean).map((mealId) => String(mealId));
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

async function buildSubscriptionTimeline(subscriptionId, options = {}) {
  const lang = options && options.lang === "en" ? "en" : "ar";
  const businessDate = options.businessDate || await getRestaurantBusinessDate();
  const now = options.now instanceof Date ? options.now : new Date();
  let subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription) {
    const err = new Error("Subscription not found");
    err.code = "SUBSCRIPTION_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  // Final Resolution: If this is a non-canonical record, attempt to find the canonical one for the same user
  if (subscription.contractMode !== "canonical" && subscription.userId) {
      const canonicalSub = await Subscription.findOne({
          userId: subscription.userId,
          contractMode: "canonical",
          status: "active",
      }).sort({ createdAt: -1 }).lean();
      if (canonicalSub) {
          subscription = canonicalSub;
          subscriptionId = canonicalSub._id;
      }
  }

  // Settlement on read intentionally removed — meals are not consumed by date passage.

  const startDateStr = toKSADateString(subscription.startDate);
  const endDateStr = toKSADateString(subscription.endDate);
  const validityEndDateStr = toKSADateString(subscription.validityEndDate || subscription.endDate);

  const [days, compensation, pickupLocations, dayPayments] = await Promise.all([
    SubscriptionDay.find({ subscriptionId }).lean(),
    getCompensationSnapshot(subscriptionId),
    getPickupLocationsSetting(),
    Payment.find({
      subscriptionId,
      type: { $in: DAY_PLANNING_PAYMENT_TYPES },
    }).sort({ createdAt: -1 }).lean(),
  ]);
  const dayMap = new Map(days.map((day) => [day.date, day]));
  const dayPaymentLookup = buildDayPaymentLookup(dayPayments);
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
    const isPast = currentDate < businessDate;
    const meals = buildTimelineMeals(subscription, dbDay);
    const calendar = buildTimelineCalendar(currentDate);

    const commercialState = dbDay
      ? buildDayCommercialState(dbDay)
      : buildDayCommercialState({
        status: "open",
        plannerState: "draft",
        mealSlots: [],
        plannerMeta: {
          requiredSlotCount: requiredMealsPerDay,
          completeSlotCount: 0,
          partialSlotCount: 0,
          isDraftValid: true,
          premiumSlotCount: 0,
          premiumCoveredByBalanceCount: 0,
          premiumPendingPaymentCount: 0,
          premiumPaidExtraCount: 0,
          premiumTotalHalala: 0,
        },
      });
    const projectedDay = dbDay || { date: currentDate, status: "open" };
    const latestPayment = resolveLatestApplicableDayPayment(dbDay, commercialState, dayPaymentLookup);
    const planningContract = deriveTimelinePlanningContract({
      subscription,
      day: projectedDay,
      meals,
      commercialState,
      latestPayment,
      businessDate,
      now,
    });
    const cutoffState = resolveDeliverySelectionCutoffState({
      subscription,
      day: dbDay || { date: currentDate, status: "open" },
      date: currentDate,
      businessDate,
      now,
    });

    // Effective fulfillment mode per day (respects day-level pickup override)
    const effectiveFulfillmentMode = resolveEffectiveFulfillmentMode({
      subscription,
      day: dbDay || { date: currentDate, status: "open" },
      date: currentDate,
    });

    // --- Timeline status resolution ---
    // Start from the legacy status (based on DB day.status)
    let resolvedStatus = resolveTimelineLegacyStatus({
      isExtension,
      day: dbDay,
      isPlanned: planningContract.isPlanned,
    });
    let resolvedDayStatus = String((dbDay || { status: "open" }).status || "open");
    let cutoffLockedReason = null;
    let cutoffLockedMessage = null;

    // If the delivery selection cutoff has passed and the day is still shown as open,
    // force the timeline badge to "locked" and annotate with the cutoff reason.
    // This applies ONLY when no operational state has already been written (day.status === "open").
    if (
      cutoffState.cutoffPassed
      && effectiveFulfillmentMode === "delivery"
      && (resolvedStatus === "open" || resolvedStatus === "planned")
    ) {
      resolvedStatus = "locked";
      resolvedDayStatus = "locked";
      cutoffLockedReason = "DELIVERY_SELECTION_CUTOFF_PASSED";
      cutoffLockedMessage = "\u0627\u0646\u062a\u0647\u0649 \u0648\u0642\u062a \u0627\u062e\u062a\u064a\u0627\u0631 \u0648\u062c\u0628\u0627\u062a \u0647\u0630\u0627 \u0627\u0644\u064a\u0648\u0645";
    }

    const status = resolvedStatus;
    const dayStatus = resolvedDayStatus;
    const fulfillmentState = buildSubscriptionDayFulfillmentState({
      subscription,
      day: dbDay || { date: currentDate, status: "open" },
      derivedState: commercialState,
      today: businessDate,
    });
    const dayForFulfillment = projectedDay;
    const statusLabel = resolveReadLabel("timelineStatuses", status, lang)
      || resolveReadLabel("dayStatuses", dayStatus, lang);
    const fulfillmentReadFields = buildFulfillmentReadFields({
      subscription,
      day: dayForFulfillment,
      pickupLocations,
      lang,
      fulfillmentState: {
        ...commercialState,
        ...fulfillmentState,
      },
      statusLabel,
    });

    // Determine final lockedReason/lockedMessage: prefer cutoff annotation, then fulfillment fields
    const finalLockedReason = cutoffLockedReason || fulfillmentReadFields.lockedReason || null;
    const finalLockedMessage = cutoffLockedMessage || fulfillmentReadFields.lockedMessage || null;

    timelineDays.push({
      date: currentDate,
      status,
      dayStatus,
      fulfillmentMode: effectiveFulfillmentMode,
      isPast,
      autoSettled: Boolean(dbDay && dbDay.autoSettled),
      settledAt: dbDay && dbDay.settledAt ? dbDay.settledAt : null,
      settlementReason: dbDay && dbDay.settlementReason ? dbDay.settlementReason : null,
      consumedByPolicy: Boolean(dbDay && dbDay.autoSettled && dbDay.creditsDeducted),
      deliveryMode: subscription.deliveryMode || null,
      source: isExtension ? (extensionSourceMap.get(currentDate) || "freeze_compensation") : "base",
      locked: Boolean(dbDay && (dbDay.lockedSnapshot || status === "locked")),
      isExtension,
      calendar,
      meals,
      dailyMeals: buildTimelineDailyMeals(meals),
      selectedMealIds: normalizeLegacySelectionIds(dbDay),
      mealSlots: normalizeTimelineMealSlots(dbDay),
      ...commercialState,
      ...planningContract,
      ...fulfillmentState,
      ...fulfillmentReadFields,
      // Override lockedReason/lockedMessage with cutoff annotation when applicable
      lockedReason: finalLockedReason,
      lockedMessage: finalLockedMessage,
    });
  }

  // ── Additive meal balance fields (new policy) ──────────────────────────────
  const mealBalance = buildMealBalance(subscription, businessDate);
  // Optional override for dailyMealsDefault if timeline needs specifically requiredMealsPerDay
  mealBalance.dailyMealsDefault = requiredMealsPerDay;
  // ────────────────────────────────────────────────────────────────────────────

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
    mealBalance,
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
    premiumMealsRemaining: Array.isArray(subscription.premiumBalance) ? subscription.premiumBalance.reduce((s, row) => s + Number(row.remainingQty || 0), 0) : 0,
    premiumMealsSelected: Array.isArray(subscription.premiumSelections) ? subscription.premiumSelections.length : 0,
    premiumBalanceBreakdown: await (async () => {
      const balanceRows = subscription.premiumBalance || [];
      const missingKeyProteinIds = balanceRows
        .filter((row) => !row.premiumKey && mongoose.isValidObjectId(row.proteinId))
        .map((row) => new mongoose.Types.ObjectId(String(row.proteinId)));

      const proteinMap = new Map();
      if (missingKeyProteinIds.length > 0) {
        const proteins = await BuilderProtein.find({ _id: { $in: missingKeyProteinIds } })
          .select("_id premiumKey")
          .lean();
        for (const p of proteins) {
          proteinMap.set(String(p._id), p.premiumKey);
        }
      }

      return balanceRows.map((row) => {
        const proteinId = row.proteinId ? String(row.proteinId) : null;
        let premiumKey = row.premiumKey || (proteinId ? proteinMap.get(proteinId) : null);

        if (!premiumKey) {
          premiumKey = resolvePremiumKeyFromName(row.name || "");
        }

        if (!premiumKey) {
          throw new Error("Invalid premiumBalance row in timeline: premiumKey is required");
        }

        return {
          proteinId,
          premiumKey,
          purchasedQty: Number(row.purchasedQty || 0),
          remainingQty: Number(row.remainingQty || 0),
          unitExtraFeeHalala: Number(row.unitExtraFeeHalala || 0),
          currency: row.currency || "SAR",
        };
      });
    })(),
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
  deriveTimelinePlanningContract,
  resolveDeliverySelectionCutoffState,
  resolveTimelineLegacyStatus,
};

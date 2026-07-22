"use strict";

const { subHours } = require("date-fns");
const { formatInTimeZone, fromZonedTime } = require("date-fns-tz");
const dateUtils = require("../../utils/date");
const {
  assertRestaurantOpenForOrdering,
  getRestaurantBusinessDate,
} = require("../restaurantHoursService");
const { resolveEffectiveFulfillmentMode } = require("./subscriptionFulfillmentPolicyService");

const DELIVERY_SELECTION_CUTOFF_HOURS = 2;
const DELIVERY_SELECTION_CUTOFF_PASSED_CODE = "DELIVERY_SELECTION_CUTOFF_PASSED";
// Legacy alias kept for backward compatibility
const DAY_LOCKED_BEFORE_DELIVERY_CODE = DELIVERY_SELECTION_CUTOFF_PASSED_CODE;
const DAY_LOCKED_BEFORE_DELIVERY_MESSAGE_EN = "Meal selection is closed. The cutoff is 2 hours before the delivery window starts";
const DAY_LOCKED_BEFORE_DELIVERY_MESSAGE_AR = "انتهى وقت اختيار وجبات هذا اليوم. يُغلق الاختيار قبل بدء نافذة التوصيل بساعتين";
const DELIVERY_TIME_UNAVAILABLE_CODE = "DELIVERY_TIME_UNAVAILABLE";

function buildPolicyError({
  code,
  message,
  messageAr = null,
  status = 400,
  details = undefined,
}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (messageAr) {
    err.messageAr = messageAr;
  }
  if (details && typeof details === "object") {
    err.details = details;
  }
  return err;
}

function localizePolicyErrorMessage(err, lang = "en") {
  if (String(lang || "").toLowerCase() === "ar" && err && err.messageAr) {
    return err.messageAr;
  }
  return err && err.message ? err.message : "";
}

function normalizeWindowValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveSameDayFulfillmentMethod({ subscription, day } = {}) {
  const dayOverrideMode = String(day && day.fulfillmentModeOverride || "").trim();
  if (["pickup", "delivery"].includes(dayOverrideMode)) {
    return resolveEffectiveFulfillmentMode({ subscription, day, date: day && day.date });
  }

  const subscriptionMode = String(subscription && subscription.deliveryMode ? subscription.deliveryMode : "").trim();
  const subscriptionSlotType = String(
    subscription && subscription.deliverySlot && subscription.deliverySlot.type
      ? subscription.deliverySlot.type
      : ""
  ).trim();
  const daySlotType = String(day && day.deliverySlot && day.deliverySlot.type ? day.deliverySlot.type : "").trim();

  const knownValues = [subscriptionMode, subscriptionSlotType, daySlotType]
    .filter(Boolean)
    .filter((value) => value === "pickup" || value === "delivery");

  if (knownValues.includes("delivery")) return "delivery";
  if (knownValues.includes("pickup")) return "pickup";
  return "unknown";
}

function resolveEffectivePickupLocationId({ subscription, day } = {}) {
  return day && day.pickupLocationIdOverride
    ? day.pickupLocationIdOverride
    : subscription && subscription.pickupLocationId
      ? subscription.pickupLocationId
      : null;
}

function resolveEffectiveDeliveryWindow({ subscription, day } = {}) {
  const dayWindowOverride = normalizeWindowValue(day && day.deliveryWindowOverride);
  if (dayWindowOverride) {
    return {
      window: dayWindowOverride,
      source: "day.deliveryWindowOverride",
    };
  }

  const daySlotWindow = normalizeWindowValue(day && day.deliverySlot && day.deliverySlot.window);
  if (daySlotWindow) {
    return {
      window: daySlotWindow,
      source: "day.deliverySlot.window",
    };
  }

  const subscriptionSlotWindow = normalizeWindowValue(subscription && subscription.deliverySlot && subscription.deliverySlot.window);
  if (subscriptionSlotWindow) {
    return {
      window: subscriptionSlotWindow,
      source: "subscription.deliverySlot.window",
    };
  }

  const subscriptionWindow = normalizeWindowValue(subscription && subscription.deliveryWindow);
  if (subscriptionWindow) {
    return {
      window: subscriptionWindow,
      source: "subscription.deliveryWindow",
    };
  }

  return {
    window: "",
    source: null,
  };
}

function parseWindowStartTime(windowValue) {
  const raw = normalizeWindowValue(windowValue);
  const [from] = raw.split("-").map((value) => value.trim());
  return dateUtils.isValidTimeString(from) ? from : "";
}

function formatPolicyDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return formatInTimeZone(date, dateUtils.KSA_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function resolveScheduledDeliveryDateTime({ subscription, day, date }) {
  const fulfillmentMethod = resolveSameDayFulfillmentMethod({ subscription, day });
  const deliveryWindow = resolveEffectiveDeliveryWindow({ subscription, day });
  const deliveryTime = parseWindowStartTime(deliveryWindow.window);

  if (fulfillmentMethod !== "delivery" || !deliveryTime || !dateUtils.isValidKSADateString(date)) {
    return {
      fulfillmentMethod,
      deliveryWindow: deliveryWindow.window,
      deliveryWindowSource: deliveryWindow.source,
      deliveryTime: deliveryTime || null,
      deliveryDateTime: null,
      lockDateTime: null,
    };
  }

  const deliveryDateTime = fromZonedTime(
    `${date}T${deliveryTime}:00`,
    dateUtils.KSA_TIMEZONE
  );
  const lockDateTime = subHours(deliveryDateTime, DELIVERY_SELECTION_CUTOFF_HOURS);

  return {
    fulfillmentMethod,
    deliveryWindow: deliveryWindow.window,
    deliveryWindowSource: deliveryWindow.source,
    deliveryTime,
    deliveryDateTime,
    lockDateTime,
  };
}

async function assertSubscriptionDayModifiable({
  subscription,
  day = null,
  date,
  now = new Date(),
  getBusinessDateFn = getRestaurantBusinessDate,
  assertRestaurantOpenForOrderingFn = assertRestaurantOpenForOrdering,
} = {}) {
  if (!dateUtils.isValidKSADateString(date)) {
    throw buildPolicyError({
      code: "INVALID_DATE",
      message: "Invalid date format",
    });
  }

  const businessDate = await getBusinessDateFn();
  if (dateUtils.isBeforeKSADate(date, businessDate)) {
    throw buildPolicyError({
      code: "INVALID_DATE",
      message: "Date cannot be in the past",
    });
  }

  if (dateUtils.isAfterKSADate(date, businessDate)) {
    return {
      allowed: true,
      date,
      businessDate,
      fulfillmentMethod: resolveSameDayFulfillmentMethod({ subscription, day }),
      sameDay: false,
    };
  }

  const fulfillmentMethod = resolveSameDayFulfillmentMethod({ subscription, day });
  if (fulfillmentMethod === "pickup") {
    const pickupLocationId = resolveEffectivePickupLocationId({ subscription, day });
    const restaurantStatus = await assertRestaurantOpenForOrderingFn({
      pickupLocationId,
      deliveryMode: "pickup",
    });
    return {
      allowed: true,
      date,
      businessDate,
      fulfillmentMethod,
      sameDay: true,
      pickupLocationId: pickupLocationId ? String(pickupLocationId) : null,
      restaurantStatus,
    };
  }

  if (fulfillmentMethod !== "delivery") {
    throw buildPolicyError({
      code: "UNKNOWN_FULFILLMENT_METHOD",
      message: "Same-day order modification is unavailable because fulfillment method could not be determined",
      status: 400,
      details: {
        date,
        businessDate,
        fulfillmentMethod,
      },
    });
  }

  const deliverySchedule = resolveScheduledDeliveryDateTime({ subscription, day, date });
  if (!(deliverySchedule.deliveryDateTime instanceof Date) || Number.isNaN(deliverySchedule.deliveryDateTime.getTime())) {
    throw buildPolicyError({
      code: DELIVERY_TIME_UNAVAILABLE_CODE,
      message: "Same-day delivery order cannot be modified because delivery time is unavailable",
      status: 400,
      details: {
        date,
        businessDate,
        fulfillmentMethod,
        deliveryWindow: deliverySchedule.deliveryWindow,
        deliveryWindowSource: deliverySchedule.deliveryWindowSource,
      },
    });
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw buildPolicyError({
      code: "INVALID_DATE",
      message: "Invalid current time",
    });
  }

  if (now.getTime() >= deliverySchedule.lockDateTime.getTime()) {
    throw buildPolicyError({
      code: DELIVERY_SELECTION_CUTOFF_PASSED_CODE,
      message: DAY_LOCKED_BEFORE_DELIVERY_MESSAGE_EN,
      messageAr: DAY_LOCKED_BEFORE_DELIVERY_MESSAGE_AR,
      status: 400,
      details: {
        date,
        businessDate,
        fulfillmentMethod,
        deliveryWindow: deliverySchedule.deliveryWindow,
        deliveryWindowSource: deliverySchedule.deliveryWindowSource,
        deliveryTime: deliverySchedule.deliveryTime,
        deliveryDateTime: formatPolicyDateTime(deliverySchedule.deliveryDateTime),
        lockDateTime: formatPolicyDateTime(deliverySchedule.lockDateTime),
        cutoffHours: DELIVERY_SELECTION_CUTOFF_HOURS,
      },
    });
  }

  return {
    allowed: true,
    date,
    businessDate,
    fulfillmentMethod,
    sameDay: true,
    deliveryWindow: deliverySchedule.deliveryWindow,
    deliveryWindowSource: deliverySchedule.deliveryWindowSource,
    deliveryTime: deliverySchedule.deliveryTime,
    deliveryDateTime: deliverySchedule.deliveryDateTime,
    lockDateTime: deliverySchedule.lockDateTime,
  };
}

module.exports = {
  DELIVERY_SELECTION_CUTOFF_HOURS,
  DELIVERY_SELECTION_CUTOFF_PASSED_CODE,
  // Legacy alias
  DAY_LOCKED_BEFORE_DELIVERY_CODE,
  DAY_LOCKED_BEFORE_DELIVERY_MESSAGE_AR,
  DAY_LOCKED_BEFORE_DELIVERY_MESSAGE_EN,
  DELIVERY_TIME_UNAVAILABLE_CODE,
  assertSubscriptionDayModifiable,
  localizePolicyErrorMessage,
  resolveEffectiveDeliveryWindow,
  resolveEffectivePickupLocationId,
  resolveSameDayFulfillmentMethod,
  resolveScheduledDeliveryDateTime,
};

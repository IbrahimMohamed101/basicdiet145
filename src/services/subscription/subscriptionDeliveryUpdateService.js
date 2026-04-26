"use strict";

const Subscription = require("../../models/Subscription");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Zone = require("../../models/Zone");
const Setting = require("../../models/Setting");
const dateUtils = require("../../utils/date");
const { getRequestLang, pickLang } = require("../../utils/i18n");
const { resolvePickupLocationSelection } = require("../../utils/subscription/subscriptionCatalog");
const {
  CUTOFF_ACTIONS,
  assertTomorrowCutoffAllowed,
} = require("./subscriptionCutoffPolicyService");
const { getRestaurantBusinessTomorrow } = require("../restaurantHoursService");

function createDeliveryUpdateError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function resolveRequestedDeliveryType(payload, subscription) {
  const delivery = payload && payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const requestedType = String(
    delivery.type
    || payload.deliveryMode
    || subscription.deliveryMode
    || ""
  ).trim();

  return requestedType || subscription.deliveryMode || "delivery";
}

function normalizeDeliveryWindow(payload) {
  const delivery = payload && payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const slot = delivery.slot && typeof delivery.slot === "object" ? delivery.slot : {};
  if (slot.window !== undefined) {
    return slot.window;
  }
  return payload.deliveryWindow;
}

function normalizeDeliveryAddress(payload) {
  const delivery = payload && payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  if (Object.prototype.hasOwnProperty.call(delivery, "address")) {
    return delivery.address;
  }
  return payload.deliveryAddress;
}

function normalizeDeliveryZoneId(payload) {
  const delivery = payload && payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const rawValue = delivery.zoneId !== undefined ? delivery.zoneId : payload.deliveryZoneId;
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }
  const normalized = String(rawValue).trim();
  return normalized || null;
}

function normalizePickupLocationId(payload) {
  const delivery = payload && payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const rawValue = delivery.pickupLocationId !== undefined ? delivery.pickupLocationId : payload.pickupLocationId;
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }
  const normalized = String(rawValue).trim();
  return normalized || null;
}

function buildDeliverySlot(currentSlot, { type, window }) {
  return {
    type,
    window: window === undefined ? String((currentSlot && currentSlot.window) || "") : String(window || ""),
    slotId: currentSlot && currentSlot.slotId ? String(currentSlot.slotId) : "",
  };
}

const defaultRuntime = {
  async getDeliveryWindows() {
    return getSettingValue("delivery_windows", []);
  },
  async findZoneById(zoneId) {
    return Zone.findById(zoneId).lean();
  },
  async getPickupLocations() {
    return getSettingValue("pickup_locations", []);
  },
  resolvePickupLocationSelection(pickupLocations, locationId, lang, windows) {
    return resolvePickupLocationSelection(pickupLocations, locationId, lang, windows);
  },
};

function resolveRuntime(runtimeOverrides = null) {
  if (!runtimeOverrides || typeof runtimeOverrides !== "object" || Array.isArray(runtimeOverrides)) {
    return defaultRuntime;
  }
  return { ...defaultRuntime, ...runtimeOverrides };
}

async function resolveSubscriptionDeliveryDefaultsUpdate({
  subscription,
  payload = {},
  lang = "ar",
  allowModeChange = false,
  runtime: runtimeOverrides = null,
}) {
  const runtime = resolveRuntime(runtimeOverrides);
  const requestedType = resolveRequestedDeliveryType(payload, subscription);
  if (!["delivery", "pickup"].includes(requestedType)) {
    throw createDeliveryUpdateError(400, "INVALID", "delivery.type must be one of: delivery, pickup");
  }
  if (!allowModeChange && requestedType !== subscription.deliveryMode) {
    throw createDeliveryUpdateError(
      422,
      "DELIVERY_MODE_CHANGE_UNSUPPORTED",
      "Changing delivery mode for an active subscription is not supported"
    );
  }

  const [windows, pickupLocations] = await Promise.all([
    runtime.getDeliveryWindows(),
    requestedType === "pickup" ? runtime.getPickupLocations() : Promise.resolve([]),
  ]);

  const deliveryWindow = normalizeDeliveryWindow(payload);
  const deliveryAddress = normalizeDeliveryAddress(payload);
  const deliveryZoneId = normalizeDeliveryZoneId(payload);
  const pickupLocationId = normalizePickupLocationId(payload);

  if (requestedType === "delivery") {
    if (deliveryAddress === undefined && deliveryWindow === undefined && deliveryZoneId === undefined) {
      throw createDeliveryUpdateError(400, "INVALID", "Missing delivery update fields");
    }

    if (deliveryWindow && Array.isArray(windows) && windows.length && !windows.includes(deliveryWindow)) {
      throw createDeliveryUpdateError(400, "INVALID", "Invalid delivery window");
    }

    let zonePatch = {};
    if (deliveryZoneId !== undefined) {
      if (!deliveryZoneId) {
        throw createDeliveryUpdateError(400, "INVALID", "deliveryZoneId is required for delivery subscriptions");
      }

      const zone = await runtime.findZoneById(deliveryZoneId);
      if (!zone) {
        throw createDeliveryUpdateError(404, "NOT_FOUND", "Delivery zone not found");
      }
      if (zone.isActive === false) {
        throw createDeliveryUpdateError(400, "INVALID", "Selected delivery zone is currently unavailable");
      }

      zonePatch = {
        deliveryZoneId: zone._id,
        deliveryZoneName: pickLang(zone.name, lang) || "",
        deliveryFeeHalala: Number(zone.deliveryFeeHalala || 0),
      };
    }

    const patch = {
      ...zonePatch,
      pickupLocationId: "",
      deliverySlot: buildDeliverySlot(subscription.deliverySlot, {
        type: "delivery",
        window: deliveryWindow,
      }),
    };
    if (deliveryAddress !== undefined) {
      patch.deliveryAddress = deliveryAddress;
    }
    if (deliveryWindow !== undefined) {
      patch.deliveryWindow = deliveryWindow;
    }

    return {
      patch,
      currentMode: "delivery",
      willChangeAddress:
        deliveryAddress !== undefined
        && JSON.stringify(deliveryAddress) !== JSON.stringify(subscription.deliveryAddress || null),
      willChangeWindow:
        deliveryWindow !== undefined
        && String(deliveryWindow || "") !== String(subscription.deliveryWindow || ""),
      logMeta: {
        deliveryMode: "delivery",
        deliveryWindow: patch.deliveryWindow !== undefined ? patch.deliveryWindow : subscription.deliveryWindow || "",
        deliveryZoneId: patch.deliveryZoneId ? String(patch.deliveryZoneId) : String(subscription.deliveryZoneId || ""),
        pickupLocationId: "",
      },
    };
  }

  if (pickupLocationId === undefined) {
    throw createDeliveryUpdateError(400, "INVALID", "pickupLocationId is required for pickup subscriptions");
  }
  if (!pickupLocationId) {
    throw createDeliveryUpdateError(400, "INVALID", "pickupLocationId is required for pickup subscriptions");
  }

  const resolvedPickupLocation = runtime.resolvePickupLocationSelection(pickupLocations, pickupLocationId, lang, windows);
  if (!resolvedPickupLocation) {
    throw createDeliveryUpdateError(400, "INVALID", "Invalid pickup location");
  }

  const patch = {
    pickupLocationId: resolvedPickupLocation.id,
    deliveryAddress: resolvedPickupLocation.address || null,
    deliveryWindow: "",
    deliverySlot: buildDeliverySlot(subscription.deliverySlot, {
      type: "pickup",
      window: "",
    }),
    deliveryZoneId: null,
    deliveryZoneName: "",
    deliveryFeeHalala: 0,
  };

  return {
    patch,
    currentMode: "pickup",
    willChangeAddress: JSON.stringify(patch.deliveryAddress) !== JSON.stringify(subscription.deliveryAddress || null),
    willChangeWindow: String(subscription.deliveryWindow || "") !== "",
    logMeta: {
      deliveryMode: "pickup",
      deliveryWindow: "",
      deliveryZoneId: "",
      pickupLocationId: resolvedPickupLocation.id,
    },
  };
}

// --- PRIVATE HELPERS (Migrated from Controller - Byte-for-Byte Check) ---

function ensureActive(subscription, dateStr) {
  if (subscription.status !== "active") {
    const err = new Error("Subscription not active");
    err.code = "SUB_INACTIVE";
    err.status = 422;
    throw err;
  }
  if (dateStr) {
    const endDate = subscription.validityEndDate || subscription.endDate;
    if (endDate && dateUtils.isAfterKSADate(dateStr, endDate)) {
      const err = new Error("Subscription expired for this date");
      err.code = "SUB_EXPIRED";
      err.status = 422;
      throw err;
    }
  }
}

async function validateFutureDateOrThrow(date, sub, endDateOverride) {
  if (!dateUtils.isValidKSADateString(date)) {
    const err = new Error("Invalid date format");
    err.code = "INVALID_DATE";
    err.status = 400;
    throw err;
  }
  const tomorrow = await getRestaurantBusinessTomorrow();
  if (dateUtils.isBeforeKSADate(date, tomorrow)) {
    const err = new Error("Date must be from tomorrow onward");
    err.code = "INVALID_DATE";
    err.status = 400;
    throw err;
  }
  if (sub) {
    const endDate = endDateOverride || sub.validityEndDate || sub.endDate;
    if (endDate && dateUtils.isAfterKSADate(date, endDate)) {
      const err = new Error("Date is outside subscription validity");
      err.code = "SUB_EXPIRED";
      err.status = 422;
      throw err;
    }
  }
}

function hasDeliveryAddressOverride(day) {
  return day && day.deliveryAddressOverride !== undefined && day.deliveryAddressOverride !== null;
}

function hasDeliveryWindowOverride(day) {
  return day && day.deliveryWindowOverride !== undefined && day.deliveryWindowOverride !== null;
}

// --- ORCHESTRATION LAYER (Migrated from Controller) ---

async function performDeliveryDetailsUpdate({ userId, subscriptionId, payload, lang, runtimeOverrides }) {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) {
    throw createDeliveryUpdateError(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    throw createDeliveryUpdateError(403, "FORBIDDEN", "Forbidden");
  }
  ensureActive(sub);

  let resolvedUpdate;
  resolvedUpdate = await resolveSubscriptionDeliveryDefaultsUpdate({
    subscription: sub.toObject ? sub.toObject() : sub,
    payload,
    lang,
    allowModeChange: false,
    runtime: runtimeOverrides,
  });

  // Global delivery updates impact check
  if (resolvedUpdate.willChangeAddress || resolvedUpdate.willChangeWindow) {
    const tomorrow = await getRestaurantBusinessTomorrow();
    const endDate = sub.validityEndDate || sub.endDate;
    if (dateUtils.isInSubscriptionRange(tomorrow, endDate)) {
      const tomorrowDay = await SubscriptionDay.findOne({ subscriptionId: sub._id, date: tomorrow }).lean();
      const isTomorrowEditable = !tomorrowDay || tomorrowDay.status === "open";
      const addressImpactsTomorrow = resolvedUpdate.willChangeAddress && !hasDeliveryAddressOverride(tomorrowDay);
      const windowImpactsTomorrow = resolvedUpdate.willChangeWindow && !hasDeliveryWindowOverride(tomorrowDay);
      if (isTomorrowEditable && (addressImpactsTomorrow || windowImpactsTomorrow)) {
        await assertTomorrowCutoffAllowed({
          action: CUTOFF_ACTIONS.DELIVERY_DEFAULTS_CHANGE,
          date: tomorrow,
        });
      }
    }
  }

  Object.assign(sub, resolvedUpdate.patch);
  await sub.save();

  return {
    ok: true,
    sub,
    logMeta: resolvedUpdate.logMeta,
  };
}

async function performDeliveryDetailsUpdateForDate({ userId, subscriptionId, date, payload, lang }) {
  const { deliveryAddress, deliveryWindow } = payload || {};

  const sub = await Subscription.findById(subscriptionId);
  if (!sub) {
    throw createDeliveryUpdateError(404, "NOT_FOUND", "Subscription not found");
  }
  if (String(sub.userId) !== String(userId)) {
    throw createDeliveryUpdateError(403, "FORBIDDEN", "Forbidden");
  }

  ensureActive(sub, date);
  await validateFutureDateOrThrow(date, sub);
  await assertTomorrowCutoffAllowed({
    action: CUTOFF_ACTIONS.DELIVERY_DETAILS_FOR_DATE_CHANGE,
    date,
  });

  if (sub.deliveryMode !== "delivery") {
    throw createDeliveryUpdateError(400, "INVALID", "Delivery mode is not delivery");
  }

  const windows = await getSettingValue("delivery_windows", []);
  if (deliveryWindow && windows.length && !windows.includes(deliveryWindow)) {
    throw createDeliveryUpdateError(400, "INVALID", "Invalid delivery window");
  }

  const dayStatusCheck = await SubscriptionDay.findOne({ subscriptionId, date }).lean();
  if (dayStatusCheck && dayStatusCheck.status !== "open") {
    throw createDeliveryUpdateError(409, "LOCKED", "Day is locked");
  }

  const update = {};
  if (deliveryAddress !== undefined) update.deliveryAddressOverride = deliveryAddress;
  if (deliveryWindow !== undefined) update.deliveryWindowOverride = deliveryWindow;

  const updatedDay = await SubscriptionDay.findOneAndUpdate(
    { subscriptionId, date },
    { $set: update },
    { upsert: true, new: true }
  );

  return { ok: true, subscriptionId: sub.id, date, updatedDay };
}

module.exports = {
  resolveSubscriptionDeliveryDefaultsUpdate,
  performDeliveryDetailsUpdate,
  performDeliveryDetailsUpdateForDate,
};

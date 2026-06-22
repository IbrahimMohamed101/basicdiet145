const mongoose = require("mongoose");
const Setting = require("../models/Setting");
const { buildDefaultPickupLocation } = require("../constants/defaultPickupLocation");
const dateUtils = require("../utils/date");

const CLOSED_MESSAGE = "Restaurant is currently closed";
const CLOSED_MESSAGE_AR = "المطعم مغلق حاليًا. يمكنك الطلب خلال ساعات العمل.";
const CLOSED_MESSAGE_EN = "Restaurant is currently closed. Please order during working hours.";
const PICKUP_LOCATION_ID_FIELDS = [
  "_id",
  "id",
  "key",
  "code",
  "slug",
  "branchId",
  "pickupLocationId",
];

function cleanString(value) {
  return String(value || "").trim();
}

function readBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "closed"].includes(normalized)) return false;
  if (["true", "1", "yes", "open"].includes(normalized)) return true;
  return fallback;
}

function extractTimeValue(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  for (const key of keys) {
    const value = cleanString(source[key]);
    if (dateUtils.isValidTimeString(value)) return value;
  }
  return "";
}

function matchesPickupLocationField(location, wanted, fields) {
  if (!location || typeof location !== "object") return false;
  return fields.some((field) => cleanString(location[field]) === wanted);
}

function resolvePickupBranch(pickupLocations, id) {
  const wanted = cleanString(id) || "main";
  const locations = Array.isArray(pickupLocations) && pickupLocations.length
    ? pickupLocations
    : [buildDefaultPickupLocation()];

  if (mongoose.Types.ObjectId.isValid(wanted)) {
    const byObjectId = locations.find((location) => (
      matchesPickupLocationField(location, wanted, ["_id"])
    ));
    if (byObjectId) return byObjectId;
  }

  return locations.find((location) => (
    matchesPickupLocationField(location, wanted, PICKUP_LOCATION_ID_FIELDS)
  )) || null;
}

function getPickupLocationId(location) {
  if (!location || typeof location !== "object") return "";
  for (const field of PICKUP_LOCATION_ID_FIELDS) {
    const value = cleanString(location[field]);
    if (value) return value;
  }
  return "";
}

function isActivePickupLocation(location) {
  return Boolean(location)
    && typeof location === "object"
    && !Array.isArray(location)
    && location.isActive !== false
    && location.active !== false
    && location.enabled !== false
    && location.isEnabled !== false
    && location.isAvailable !== false
    && location.available !== false
    && location.pickupEnabled !== false
    && location.isPickupEnabled !== false
    && location.supportsPickup !== false
    && location.pickupAvailable !== false
    && location.availableForPickup !== false
    && location.acceptsPickup !== false;
}

function resolveWeeklyScheduleHours(weeklySchedule, now) {
  if (!Array.isArray(weeklySchedule) || !weeklySchedule.length) return {};
  const dayOfWeek = Number(dateUtils.formatKSA(now, "i")) % 7;
  const row = weeklySchedule.find((entry) => {
    const candidateRaw = Number(entry && (entry.dayOfWeek ?? entry.weekday ?? entry.day));
    const candidate = candidateRaw === 7 ? 0 : candidateRaw;
    return Number.isFinite(candidate) && candidate === dayOfWeek;
  });
  if (!row) return {};
  if (row.isClosed === true || row.closed === true) return { isOpen: false };
  return {
    openTime: extractTimeValue(row, ["openTime", "restaurant_open_time", "opensAt", "from"]),
    closeTime: extractTimeValue(row, ["closeTime", "restaurant_close_time", "closesAt", "to"]),
    isOpen: true,
  };
}

function buildRestaurantClosedDetails(hours = {}) {
  return {
    code: "RESTAURANT_CLOSED",
    reason: "RESTAURANT_CLOSED",
    message: CLOSED_MESSAGE,
    messageAr: CLOSED_MESSAGE_AR,
    messageEn: CLOSED_MESSAGE_EN,
    restaurantHours: {
      openTime: hours.openTime || null,
      closeTime: hours.closeTime || null,
      isOpenNow: false,
    },
  };
}

function createRestaurantClosedError(hours = {}) {
  const err = new Error(CLOSED_MESSAGE);
  err.code = "RESTAURANT_CLOSED";
  err.status = 409;
  err.details = buildRestaurantClosedDetails(hours);
  err.messageAr = CLOSED_MESSAGE_AR;
  err.messageEn = CLOSED_MESSAGE_EN;
  return err;
}

async function resolveRestaurantOpenState({
  pickupLocationId = null,
  branchId = null,
  now = new Date(),
} = {}) {
  const [
    openSetting,
    closeSetting,
    isOpenSetting,
    pickupLocationsSetting,
    weeklyScheduleSetting,
    temporaryClosureSetting,
  ] = await Promise.all([
    Setting.findOne({ key: "restaurant_open_time" }).lean(),
    Setting.findOne({ key: "restaurant_close_time" }).lean(),
    Setting.findOne({ key: "restaurant_is_open" }).lean(),
    Setting.findOne({ key: "pickup_locations" }).lean(),
    Setting.findOne({ key: "restaurant_hours" }).lean(),
    Setting.findOne({ key: "temporary_closure" }).lean(),
  ]);

  const hasConfiguredPickupLocations = Boolean(
    pickupLocationsSetting && Array.isArray(pickupLocationsSetting.value)
  );
  const pickupLocations = hasConfiguredPickupLocations
    ? pickupLocationsSetting.value
    : [buildDefaultPickupLocation()];
  const activePickupLocations = pickupLocations.filter(isActivePickupLocation);
  const defaultPickupLocationId = "main";
  const requestedPickupLocationId = cleanString(pickupLocationId || branchId);
  let selectedLocation = null;
  let pickupLocationError = null;

  if (requestedPickupLocationId === "main") {
    if (activePickupLocations.length === 1) {
      selectedLocation = activePickupLocations[0];
    } else if (activePickupLocations.length === 0) {
      pickupLocationError = {
        code: "INVALID_BRANCH",
        message: 'Cannot resolve branch ID "main": no active pickup branches are configured',
      };
    } else {
      pickupLocationError = {
        code: "AMBIGUOUS_BRANCH",
        message: 'Cannot resolve branch ID "main": multiple active pickup branches are configured',
      };
    }
  } else if (requestedPickupLocationId) {
    const matchedLocation = resolvePickupBranch(pickupLocations, requestedPickupLocationId);
    if (matchedLocation && isActivePickupLocation(matchedLocation)) {
      selectedLocation = matchedLocation;
    }
  }

  const resolvedPickupLocationId = selectedLocation
    ? getPickupLocationId(selectedLocation)
    : requestedPickupLocationId;
  const pickupLocationFound = !requestedPickupLocationId
    || Boolean(selectedLocation);
  const weeklyHours = resolveWeeklyScheduleHours(weeklyScheduleSetting && weeklyScheduleSetting.value, now);
  const openTime = weeklyHours.openTime || (openSetting && openSetting.value ? String(openSetting.value) : "00:00");
  const closeTime = weeklyHours.closeTime || (closeSetting && closeSetting.value ? String(closeSetting.value) : "23:59");
  const globalOpen = readBoolean(isOpenSetting && isOpenSetting.value, true);
  const temporaryClosure = temporaryClosureSetting && temporaryClosureSetting.value;
  const temporarilyClosed = temporaryClosure === true
    || (temporaryClosure && typeof temporaryClosure === "object" && temporaryClosure.isActive === true);
  const switchOpen = globalOpen && weeklyHours.isOpen !== false && !temporarilyClosed;
  const withinWindow = dateUtils.isCurrentTimeWithinWindow(openTime, closeTime, now);
  const isOpenNow = Boolean(switchOpen && withinWindow);
  let reason = null;
  if (!globalOpen) reason = "RESTAURANT_CLOSED";
  else if (weeklyHours.isOpen === false) reason = "RESTAURANT_CLOSED";
  else if (temporarilyClosed) reason = "TEMPORARY_CLOSURE";
  else if (!withinWindow) reason = "OUTSIDE_WORKING_HOURS";

  return {
    openTime,
    closeTime,
    isOpenNow,
    reason,
    message: isOpenNow ? null : CLOSED_MESSAGE,
    messageAr: isOpenNow ? null : CLOSED_MESSAGE_AR,
    messageEn: isOpenNow ? null : CLOSED_MESSAGE_EN,
    pickupLocationId: resolvedPickupLocationId || defaultPickupLocationId || null,
    resolvedPickupLocationId: resolvedPickupLocationId || null,
    pickupLocationFound,
    pickupLocationError,
    defaultPickupLocationId,
    availablePickupLocationIds: activePickupLocations.map(getPickupLocationId).filter(Boolean),
    businessDate: dateUtils.getCurrentBusinessDate(openTime, closeTime, now),
    businessTomorrow: dateUtils.addDaysToKSADateString(
      dateUtils.getCurrentBusinessDate(openTime, closeTime, now),
      1
    ),
  };
}

async function getRestaurantHours(options = {}) {
  return resolveRestaurantOpenState(options);
}

async function assertRestaurantOpenForOrdering(options = {}) {
  const effectiveOptions = { ...options };
  if (
    effectiveOptions.deliveryMode === "pickup"
    && !effectiveOptions.branchId
    && !effectiveOptions.pickupLocationId
  ) {
    effectiveOptions.branchId = "main";
  }

  const hours = await resolveRestaurantOpenState(effectiveOptions);
  if ((effectiveOptions.branchId || effectiveOptions.pickupLocationId) && !hours.pickupLocationFound) {
    const resolutionError = hours.pickupLocationError || {};
    const err = new Error(resolutionError.message || "Invalid branch ID");
    err.code = resolutionError.code || "INVALID_BRANCH";
    err.status = 400;
    throw err;
  }
  if (!hours.isOpenNow) {
    throw createRestaurantClosedError(hours);
  }
  return hours;
}

async function getRestaurantBusinessDate() {
  const restaurantHours = await getRestaurantHours();
  return restaurantHours.businessDate;
}

async function getRestaurantBusinessTomorrow() {
  const restaurantHours = await getRestaurantHours();
  return restaurantHours.businessTomorrow;
}

module.exports = {
  assertRestaurantOpenForOrdering,
  buildRestaurantClosedDetails,
  createRestaurantClosedError,
  getRestaurantHours,
  getRestaurantBusinessDate,
  getRestaurantBusinessTomorrow,
  resolveRestaurantOpenState,
  resolvePickupBranch,
};

const Setting = require("../models/Setting");
const dateUtils = require("../utils/date");

const CLOSED_MESSAGE = "Restaurant is currently closed";
const CLOSED_MESSAGE_AR = "المطعم مغلق حاليًا. يمكنك الطلب خلال ساعات العمل.";
const CLOSED_MESSAGE_EN = "Restaurant is currently closed. Please order during working hours.";

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

function findPickupLocation(pickupLocations, id) {
  const wanted = cleanString(id);
  if (!wanted || !Array.isArray(pickupLocations)) return null;
  return pickupLocations.find((location) => {
    if (!location || typeof location !== "object") return false;
    return [
      location.id,
      location._id,
      location.key,
      location.branchId,
      location.pickupLocationId,
    ].some((candidate) => cleanString(candidate) === wanted);
  }) || null;
}

function resolveLocationHours(location) {
  if (!location || typeof location !== "object" || Array.isArray(location)) return {};
  const nestedWorkingHours = location.workingHours && typeof location.workingHours === "object" && !Array.isArray(location.workingHours)
    ? location.workingHours
    : {};
  const nestedHours = location.hours && typeof location.hours === "object" && !Array.isArray(location.hours)
    ? location.hours
    : {};
  return {
    openTime: extractTimeValue(location, ["openTime", "restaurant_open_time", "opensAt", "from"])
      || extractTimeValue(nestedWorkingHours, ["openTime", "restaurant_open_time", "opensAt", "from"])
      || extractTimeValue(nestedHours, ["openTime", "restaurant_open_time", "opensAt", "from"]),
    closeTime: extractTimeValue(location, ["closeTime", "restaurant_close_time", "closesAt", "to"])
      || extractTimeValue(nestedWorkingHours, ["closeTime", "restaurant_close_time", "closesAt", "to"])
      || extractTimeValue(nestedHours, ["closeTime", "restaurant_close_time", "closesAt", "to"]),
    isOpen: readBoolean(location.isOpen ?? location.restaurant_is_open, true)
      && location.isActive !== false
      && location.enabled !== false,
  };
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

  const pickupLocations = Array.isArray(pickupLocationsSetting && pickupLocationsSetting.value)
    ? pickupLocationsSetting.value
    : [];
  const selectedLocation = findPickupLocation(pickupLocations, pickupLocationId || branchId);
  const locationHours = resolveLocationHours(selectedLocation);
  const weeklyHours = resolveWeeklyScheduleHours(weeklyScheduleSetting && weeklyScheduleSetting.value, now);
  const openTime = locationHours.openTime || weeklyHours.openTime || (openSetting && openSetting.value ? String(openSetting.value) : "00:00");
  const closeTime = locationHours.closeTime || weeklyHours.closeTime || (closeSetting && closeSetting.value ? String(closeSetting.value) : "23:59");
  const globalOpen = readBoolean(isOpenSetting && isOpenSetting.value, true);
  const temporaryClosure = temporaryClosureSetting && temporaryClosureSetting.value;
  const temporarilyClosed = temporaryClosure === true
    || (temporaryClosure && typeof temporaryClosure === "object" && temporaryClosure.isActive === true);
  const switchOpen = globalOpen && locationHours.isOpen !== false && weeklyHours.isOpen !== false && !temporarilyClosed;
  const withinWindow = dateUtils.isCurrentTimeWithinWindow(openTime, closeTime, now);
  const isOpenNow = Boolean(switchOpen && withinWindow);
  let reason = null;
  if (!globalOpen) reason = "RESTAURANT_CLOSED";
  else if (locationHours.isOpen === false) reason = "BRANCH_CLOSED";
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
  const hours = await resolveRestaurantOpenState(options);
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
};

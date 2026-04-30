"use strict";

const Setting = require("../../models/Setting");
const { pickLang, t } = require("../../utils/i18n");
const {
  formatWindowLabel,
  resolvePickupLocationSelection,
} = require("../../utils/subscription/subscriptionCatalog");
const { resolveEffectiveDeliveryWindow } = require("./subscriptionDayModificationPolicyService");
const { resolveReadLabel } = require("../../utils/subscription/subscriptionLocalizationCommon");

async function getPickupLocationsSetting() {
  const setting = await Setting.findOne({ key: "pickup_locations" }).lean();
  return Array.isArray(setting && setting.value) ? setting.value : [];
}

function cleanString(value) {
  return String(value || "").trim();
}

function pickValue(value, lang) {
  return cleanString(pickLang(value, lang) || value);
}

function buildFormattedAddress(address = {}, lang = "ar") {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "";
  const parts = [
    pickValue(address.label, lang),
    pickValue(address.line1, lang) || pickValue(address.street, lang),
    pickValue(address.line2, lang),
    pickValue(address.district, lang),
    pickValue(address.city, lang),
    pickValue(address.building, lang),
    pickValue(address.apartment, lang),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(" - ");
}

function buildDeliveryAddressSummary(address, { zoneName = "", lang = "ar" } = {}) {
  if (!address || typeof address !== "object" || Array.isArray(address)) return null;
  const summary = {
    label: pickValue(address.label, lang),
    line1: pickValue(address.line1, lang) || pickValue(address.street, lang),
    line2: pickValue(address.line2, lang),
    district: pickValue(address.district, lang),
    city: pickValue(address.city, lang),
    zoneName: pickValue(zoneName, lang),
    formatted: "",
    street: pickValue(address.street, lang),
    building: pickValue(address.building, lang),
    apartment: pickValue(address.apartment, lang),
    notes: pickValue(address.notes, lang),
  };
  summary.formatted = buildFormattedAddress({ ...address, label: summary.label }, lang)
    || [summary.line1, summary.district, summary.city, summary.zoneName].filter(Boolean).join(" - ");
  const hasContent = Object.values(summary).some((value) => cleanString(value));
  return hasContent ? summary : null;
}

function buildDeliveryWindowSummary(windowValue, lang = "ar") {
  const raw = cleanString(windowValue);
  if (!raw) return null;
  const [from = "", to = ""] = raw.split("-").map((part) => cleanString(part));
  return {
    from,
    to,
    label: formatWindowLabel(raw, lang) || raw,
  };
}

function buildDeliverySlotSummary(slot, subscription, lang = "ar") {
  const source = slot && typeof slot === "object" && !Array.isArray(slot)
    ? slot
    : {};
  const window = cleanString(source.window || (subscription && subscription.deliveryWindow));
  return {
    type: cleanString(source.type || (subscription && subscription.deliveryMode)),
    slotId: cleanString(source.slotId),
    window,
    label: window ? formatWindowLabel(window, lang) || window : "",
  };
}

function buildPickupLocationSummary(subscription, pickupLocations = [], lang = "ar") {
  const pickupLocationId = cleanString(subscription && subscription.pickupLocationId);
  if (!pickupLocationId) return null;

  const resolved = resolvePickupLocationSelection(pickupLocations, pickupLocationId, lang, []);
  if (!resolved) return null;

  const addressObject = resolved.address && typeof resolved.address === "object" && !Array.isArray(resolved.address)
    ? resolved.address
    : {};
  const formattedAddress = buildFormattedAddress(addressObject, lang)
    || pickValue(resolved.address, lang)
    || pickValue(resolved.label, lang);

  return {
    id: cleanString(resolved.id || pickupLocationId),
    name: pickValue(resolved.name, lang) || pickValue(resolved.label, lang),
    address: formattedAddress,
    phone: cleanString(resolved.phone || resolved.mobile || resolved.telephone),
    city: pickValue(addressObject.city || resolved.city, lang),
    district: pickValue(addressObject.district || resolved.district, lang),
    workingHours: pickValue(resolved.workingHours || resolved.hours, lang),
    latitude: addressObject.lat !== undefined ? addressObject.lat : (resolved.lat ?? resolved.latitude ?? null),
    longitude: addressObject.lng !== undefined ? addressObject.lng : (resolved.lng ?? resolved.longitude ?? null),
    mapUrl: cleanString(resolved.mapUrl || resolved.googleMapsUrl || resolved.mapsUrl) || null,
  };
}

function resolveEffectiveAddress(subscription, day) {
  if (day && day.deliveryAddressOverride && Object.keys(day.deliveryAddressOverride).length > 0) {
    return day.deliveryAddressOverride;
  }
  return subscription && subscription.deliveryAddress ? subscription.deliveryAddress : null;
}

function resolveStatusForLabel(day, fallbackStatus = "open") {
  return cleanString(day && day.status) || fallbackStatus;
}

function buildFulfillmentCopy({
  subscription,
  day = null,
  lang = "ar",
  pickupLocation = null,
  deliveryAddress = null,
  deliveryWindow = null,
  fulfillmentState = {},
  statusLabel = "",
} = {}) {
  const mode = subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery";
  const status = resolveStatusForLabel(day, subscription && subscription.status);
  const label = statusLabel || resolveReadLabel("dayStatuses", status, lang) || resolveReadLabel("subscriptionStatuses", status, lang);
  const title = mode === "pickup" ? t("read.fulfillment.pickupTitle", lang) : t("read.fulfillment.deliveryTitle", lang);
  let message = "";
  let nextAction = "";
  let lockedReason = null;
  let lockedMessage = null;

  if (mode === "pickup") {
    if (!pickupLocation) {
      lockedReason = "PICKUP_LOCATION_MISSING";
      lockedMessage = t("read.fulfillment.pickupLocationMissing", lang);
      message = lockedMessage;
    } else if (status === "ready_for_pickup") {
      message = t("read.fulfillment.readyForPickup", lang);
      nextAction = t("read.fulfillment.pickupUseCode", lang);
    } else if (status === "no_show") {
      message = t("read.fulfillment.pickupNoShow", lang);
    } else if (status === "consumed_without_preparation") {
      message = t("read.fulfillment.consumedWithoutPreparation", lang);
    } else if (status === "in_preparation") {
      message = t("read.fulfillment.pickupInPreparation", lang);
    } else if (status === "locked") {
      message = t("read.fulfillment.dayLocked", lang);
    } else {
      message = t("read.fulfillment.pickupScheduled", lang);
    }
  } else {
    if (!deliveryAddress) {
      lockedReason = "DELIVERY_ADDRESS_MISSING";
      lockedMessage = t("read.fulfillment.deliveryAddressMissing", lang);
      message = lockedMessage;
    } else if (!deliveryWindow) {
      lockedReason = "DELIVERY_WINDOW_MISSING";
      lockedMessage = t("read.fulfillment.deliveryWindowMissing", lang);
      message = lockedMessage;
    } else if (status === "out_for_delivery") {
      message = t("read.fulfillment.outForDelivery", lang);
      nextAction = t("read.fulfillment.deliveryOnWayAction", lang);
    } else if (status === "fulfilled") {
      message = t("read.fulfillment.delivered", lang);
    } else if (status === "delivery_canceled") {
      message = t("read.fulfillment.deliveryCanceled", lang);
    } else if (status === "locked" || status === "in_preparation") {
      lockedReason = "LOCKED";
      lockedMessage = t("read.fulfillment.dayLocked", lang);
      message = lockedMessage;
    } else {
      message = t("read.fulfillment.deliveryScheduled", lang);
    }
  }

  return {
    mode,
    title,
    status,
    statusLabel: label || "",
    message,
    nextAction,
    isEditable: !lockedReason && !["locked", "in_preparation", "out_for_delivery", "ready_for_pickup", "fulfilled"].includes(status),
    isFulfillable: Boolean(fulfillmentState.isFulfillable),
    planningReady: Boolean(fulfillmentState.planningReady),
    fulfillmentReady: Boolean(fulfillmentState.fulfillmentReady),
    lockedReason,
    lockedMessage,
  };
}

function buildFulfillmentReadFields({
  subscription,
  day = null,
  pickupLocations = [],
  lang = "ar",
  fulfillmentState = {},
  statusLabel = "",
} = {}) {
  const mode = subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery";
  const pickupLocation = mode === "pickup"
    ? buildPickupLocationSummary(subscription, pickupLocations, lang)
    : null;
  const effectiveAddress = mode === "delivery" ? resolveEffectiveAddress(subscription, day) : null;
  const deliveryAddress = mode === "delivery"
    ? buildDeliveryAddressSummary(effectiveAddress, {
      zoneName: subscription && subscription.deliveryZoneName,
      lang,
    })
    : null;
  const effectiveWindow = mode === "delivery"
    ? resolveEffectiveDeliveryWindow({ subscription, day }).window
    : cleanString(subscription && subscription.deliverySlot && subscription.deliverySlot.window);
  const deliveryWindow = buildDeliveryWindowSummary(effectiveWindow, lang);
  const deliverySlot = buildDeliverySlotSummary(subscription && subscription.deliverySlot, subscription, lang);
  const summary = buildFulfillmentCopy({
    subscription,
    day,
    lang,
    pickupLocation,
    deliveryAddress,
    deliveryWindow,
    fulfillmentState,
    statusLabel,
  });

  return {
    deliveryMode: mode,
    pickupLocation,
    deliveryAddress,
    deliveryWindow,
    deliverySlot,
    fulfillmentSummary: summary,
    lockedReason: summary.lockedReason,
    lockedMessage: summary.lockedMessage,
  };
}

module.exports = {
  buildDeliveryAddressSummary,
  buildDeliveryWindowSummary,
  buildFulfillmentReadFields,
  buildPickupLocationSummary,
  getPickupLocationsSetting,
};

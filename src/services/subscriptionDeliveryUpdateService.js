"use strict";

const Zone = require("../models/Zone");
const Setting = require("../models/Setting");
const { pickLang } = require("../utils/i18n");
const { resolvePickupLocationSelection } = require("../utils/subscriptionCatalog");

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

module.exports = {
  resolveSubscriptionDeliveryDefaultsUpdate,
};

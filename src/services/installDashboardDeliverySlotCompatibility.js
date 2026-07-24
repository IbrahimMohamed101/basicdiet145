"use strict";

const Setting = require("../models/Setting");
const subscriptionQuoteService = require("./subscription/subscriptionQuoteService");

const STATE_KEY = Symbol.for(
  "basicdiet.dashboardDeliverySlotCompatibility.state"
);
const WRAPPED_KEY = Symbol.for(
  "basicdiet.dashboardDeliverySlotCompatibility.wrapped"
);

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeDeliveryWindowOption(rawWindow, index) {
  const fallbackId = `delivery_slot_${index + 1}`;

  if (typeof rawWindow === "string") {
    const window = clean(rawWindow);
    return window
      ? {
          id: fallbackId,
          slotId: fallbackId,
          type: "delivery",
          window,
        }
      : null;
  }

  if (!rawWindow || typeof rawWindow !== "object" || Array.isArray(rawWindow)) {
    return null;
  }

  const window = clean(
    rawWindow.window || rawWindow.value || rawWindow.deliveryWindow
  );
  if (!window) return null;

  const id = clean(rawWindow.id || rawWindow.slotId || fallbackId);
  return {
    id,
    slotId: id,
    type: "delivery",
    window,
  };
}

function deliverySlotError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 422;
  return error;
}

function resolveDeliveryType(payload = {}, delivery = {}) {
  return clean(
    delivery.type
      || payload.deliveryMethod
      || payload.deliveryMode
      || (delivery.slot && delivery.slot.type)
      || "delivery"
  );
}

function normalizeDashboardDeliverySlotPayload(payload = {}, windows = []) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const delivery =
    payload.delivery
    && typeof payload.delivery === "object"
    && !Array.isArray(payload.delivery)
      ? { ...payload.delivery }
      : {};

  if (resolveDeliveryType(payload, delivery) !== "delivery") {
    return payload;
  }

  const rawSlot =
    delivery.slot
    && typeof delivery.slot === "object"
    && !Array.isArray(delivery.slot)
      ? { ...delivery.slot }
      : {};

  let slotId = clean(
    rawSlot.slotId
      || rawSlot.id
      || delivery.slotId
      || delivery.deliverySlotId
      || payload.deliverySlotId
      || payload.slotId
  );
  let requestedWindow = clean(
    rawSlot.window
      || rawSlot.value
      || delivery.window
      || delivery.deliveryWindow
      || payload.deliveryWindow
  );

  const options = (Array.isArray(windows) ? windows : [])
    .map(normalizeDeliveryWindowOption)
    .filter(Boolean);

  if (slotId) {
    const resolvedById = options.find(
      (option) => option.id === slotId || option.slotId === slotId
    );
    if (resolvedById && !requestedWindow) {
      requestedWindow = resolvedById.window;
    }
  } else if (requestedWindow) {
    const matches = options.filter(
      (option) => option.window === requestedWindow
    );
    if (matches.length === 1) {
      slotId = matches[0].slotId;
      requestedWindow = matches[0].window;
    } else if (matches.length === 0) {
      throw deliverySlotError(
        "INVALID_DELIVERY_SLOT",
        "Invalid delivery window"
      );
    } else {
      throw deliverySlotError(
        "INVALID_DELIVERY_SLOT",
        "Delivery window is ambiguous; delivery.slotId is required"
      );
    }
  } else if (options.length === 1) {
    slotId = options[0].slotId;
    requestedWindow = options[0].window;
  }

  const normalizedDelivery = {
    ...delivery,
    type: "delivery",
    ...(requestedWindow ? { window: requestedWindow } : {}),
    slot: {
      ...rawSlot,
      type: "delivery",
      window: requestedWindow,
      slotId,
    },
  };

  return {
    ...payload,
    delivery: normalizedDelivery,
  };
}

async function loadDeliveryWindows() {
  const setting = await Setting.findOne({ key: "delivery_windows" }).lean();
  return setting && Array.isArray(setting.value) ? setting.value : [];
}

function installDashboardDeliverySlotCompatibility() {
  const state = globalThis[STATE_KEY] || { installed: false };
  globalThis[STATE_KEY] = state;
  if (state.installed) return;
  state.installed = true;

  const original = subscriptionQuoteService.resolveCheckoutQuoteOrThrow;
  if (typeof original !== "function") {
    throw new Error(
      "subscriptionQuoteService.resolveCheckoutQuoteOrThrow is unavailable"
    );
  }

  const wrapped = async function dashboardDeliverySlotCompatibleQuote(
    payload,
    options
  ) {
    const delivery =
      payload
      && payload.delivery
      && typeof payload.delivery === "object"
      && !Array.isArray(payload.delivery)
        ? payload.delivery
        : {};
    const type = resolveDeliveryType(payload || {}, delivery);

    if (type !== "delivery") {
      return original(payload, options);
    }

    const windows = await loadDeliveryWindows();
    const normalizedPayload = normalizeDashboardDeliverySlotPayload(
      payload,
      windows
    );
    return original(normalizedPayload, options);
  };

  Object.defineProperty(wrapped, WRAPPED_KEY, {
    value: true,
    configurable: false,
  });
  Object.defineProperty(wrapped, "__dashboardDeliverySlotCompatible", {
    value: true,
    configurable: false,
  });

  subscriptionQuoteService.resolveCheckoutQuoteOrThrow = wrapped;
}

installDashboardDeliverySlotCompatibility();

module.exports = {
  installDashboardDeliverySlotCompatibility,
  normalizeDashboardDeliverySlotPayload,
  normalizeDeliveryWindowOption,
};

"use strict";

const { resolveStatusMeta } = require("./KitchenOperationsStatusResolver");
const { resolveActions } = require("./KitchenOperationsActionResolver");

const MODE_LABELS = {
  delivery: "توصيل",
  pickup: "استلام",
};

function formatTimeLabel(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ar-EG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Africa/Cairo",
  }).format(date);
}

function buildTiming(value) {
  const date = value ? new Date(value) : null;
  const isValid = date && !Number.isNaN(date.getTime());
  return {
    createdAt: isValid ? date.toISOString() : null,
    createdAtLabel: isValid ? formatTimeLabel(date) : null,
  };
}

function buildVerification(day, mode) {
  if (mode !== "pickup") return null;
  if (day.status === "no_show" || day.pickupNoShowAt) {
    return {
      status: "no_show",
      statusLabel: "لم يحضر",
    };
  }
  if (day.pickupVerifiedAt) {
    return {
      status: "verified",
      statusLabel: "تم التحقق",
    };
  }
  return {
    status: "not_verified",
    statusLabel: "لم يتم التحقق",
  };
}

function preferredLocalizedName(value, fallback = "") {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return String(value.ar || value.en || fallback || "");
  }
  return fallback;
}

function stringifyId(value) {
  return value ? String(value) : null;
}

function formatReference(prefix, date, id) {
  const compactDate = String(date || "").replace(/-/g, "");
  const suffix = String(id || "").slice(-6).toUpperCase();
  return `#${prefix}-${compactDate}-${suffix}`;
}

function parseTimeWindow(rawWindow) {
  const window = String(rawWindow || "").trim();
  if (!window) {
    return {
      from: null,
      to: null,
      label: "",
    };
  }

  const parts = window.split("-").map((part) => String(part || "").trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      from: parts[0],
      to: parts[1],
      label: `${parts[0]} - ${parts[1]}`,
    };
  }

  return {
    from: null,
    to: null,
    label: window,
  };
}

function buildMealItemsFromDay(day, mealNameById) {
  const sourcePlanning = day.lockedSnapshot && day.lockedSnapshot.planning
    ? day.lockedSnapshot.planning
    : (day.fulfilledSnapshot && day.fulfilledSnapshot.planning ? day.fulfilledSnapshot.planning : null);

  const items = [];
  const seen = new Set();
  const pushMeal = (mealId, fallbackName = "") => {
    const id = stringifyId(mealId);
    if (!id || seen.has(`meal:${id}`)) return;
    seen.add(`meal:${id}`);
    items.push({
      id,
      name: preferredLocalizedName(mealNameById.get(id), fallbackName || "وجبة"),
      kind: "meal",
    });
  };

  if (sourcePlanning && Array.isArray(sourcePlanning.baseMealSlots)) {
    sourcePlanning.baseMealSlots.forEach((slot) => pushMeal(slot && slot.mealId));
  }

  const fallbackMealIds = []
    .concat(Array.isArray(day.selections) ? day.selections : [])
    .concat(Array.isArray(day.premiumSelections) ? day.premiumSelections : []);

  fallbackMealIds.forEach((mealId) => pushMeal(mealId));

  return items;
}

function buildAddonItemsFromDay(day, addonNameById) {
  const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
  const items = [];
  const seen = new Set();
  const pushAddon = (addonId, fallbackName = "") => {
    const id = stringifyId(addonId);
    const dedupeKey = `addon:${id || fallbackName}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    items.push({
      id: id || fallbackName || "addon",
      name: preferredLocalizedName(addonNameById.get(id), fallbackName || "إضافة"),
      kind: "addon",
    });
  };

  const recurringAddons = snapshot && Array.isArray(snapshot.recurringAddons)
    ? snapshot.recurringAddons
    : (Array.isArray(day.recurringAddons) ? day.recurringAddons : []);
  recurringAddons.forEach((addon) => pushAddon(addon && addon.addonId, addon && addon.name));

  const subscriptionAddons = snapshot && Array.isArray(snapshot.subscriptionAddons)
    ? snapshot.subscriptionAddons
    : [];
  subscriptionAddons.forEach((addon) => pushAddon(addon && addon.addonId, addon && addon.name));

  const oneTimeAddons = snapshot && Array.isArray(snapshot.oneTimeAddonSelections)
    ? snapshot.oneTimeAddonSelections
    : (Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : []);
  oneTimeAddons.forEach((addon) => pushAddon(addon && addon.addonId, addon && addon.name));

  const addonIds = snapshot && Array.isArray(snapshot.addonsOneTime)
    ? snapshot.addonsOneTime
    : (Array.isArray(day.addonsOneTime) ? day.addonsOneTime : []);
  addonIds.forEach((addonId) => pushAddon(addonId));

  return items;
}

function buildCustomItems(prefix, count, kind) {
  const items = [];
  for (let index = 0; index < count; index += 1) {
    items.push({
      id: `${kind}_${index + 1}`,
      name: `${prefix} ${index + 1}`,
      kind,
    });
  }
  return items;
}

function buildCustomerFromSubscriptionDay(day) {
  const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
  const user = day.subscriptionId && day.subscriptionId.userId ? day.subscriptionId.userId : null;

  return {
    id: stringifyId((user && user._id) || (snapshot && snapshot.customerId)),
    name: String((user && user.name) || (snapshot && snapshot.customerName) || (user && user.phone) || ""),
    avatar: null,
  };
}

function mapSubscriptionDayToRow(day, context = {}, { entityType = "subscription_day" } = {}) {
  const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
  const subscription = day.subscriptionId || {};
  const mode = String((snapshot && snapshot.deliveryMode) || subscription.deliveryMode || "delivery");
  const timeWindow = parseTimeWindow((snapshot && snapshot.deliveryWindow) || subscription.deliveryWindow || day.deliveryWindowOverride);
  const items = []
    .concat(buildMealItemsFromDay(day, context.mealNameById || new Map()))
    .concat(buildAddonItemsFromDay(day, context.addonNameById || new Map()))
    .concat(buildCustomItems(
      "سلطة مخصصة",
      Array.isArray((snapshot && snapshot.customSalads) || day.customSalads) ? ((snapshot && snapshot.customSalads) || day.customSalads).length : 0,
      "addon"
    ))
    .concat(buildCustomItems(
      "وجبة مخصصة",
      Array.isArray((snapshot && snapshot.customMeals) || day.customMeals) ? ((snapshot && snapshot.customMeals) || day.customMeals).length : 0,
      "meal"
    ));

  const statusMeta = resolveStatusMeta({
    entityType: "subscription_day",
    rawStatus: day.status,
    mode,
    items,
  });

  const row = {
    id: stringifyId(day._id),
    entityType,
    reference: formatReference(entityType === "pickup_day" ? "PICK" : "SUB", day.date, day._id),
    customer: buildCustomerFromSubscriptionDay(day),
    date: day.date,
    mode,
    modeLabel: MODE_LABELS[mode] || mode,
    timeWindow,
    items,
    status: statusMeta.status,
    statusLabel: statusMeta.statusLabel,
    progress: statusMeta.progress,
    actions: [],
    badges: {
      locked: Boolean(day.lockedSnapshot || ["locked", "in_preparation", "ready_for_pickup", "out_for_delivery", "fulfilled"].includes(day.status)),
      assignedByKitchen: Boolean(day.assignedByKitchen),
      pickupRequested: Boolean(day.pickupRequested),
    },
    verification: buildVerification(day, mode),
    ui: {
      layout: entityType === "pickup_day" ? "card" : "table",
    },
    timing: buildTiming(day.createdAt || day.lockedAt || day.fulfilledAt || null),
    meta: {
      subscriptionId: stringifyId(subscription._id || day.subscriptionId),
      orderId: null,
      dayId: stringifyId(day._id),
    },
    operationFlags: {
      creditsDeducted: Boolean(day.creditsDeducted),
      pickupCodeIssued: Boolean(day.pickupCode),
      pickupVerified: Boolean(day.pickupVerifiedAt),
    },
    rawStatus: day.status,
    sortStatusOrder: 0,
    branchId: stringifyId((snapshot && snapshot.pickupLocationId) || subscription.pickupLocationId),
  };

  row.actions = resolveActions(row);

  return row;
}

function buildCustomerFromOrder(order) {
  const user = order.userId || null;
  return {
    id: stringifyId(user && user._id),
    name: String((user && user.name) || (user && user.phone) || ""),
    avatar: null,
  };
}

function mapOrderItems(order, mealNameById) {
  const items = [];

  (Array.isArray(order.items) ? order.items : []).forEach((item, index) => {
    const mealId = stringifyId(item && item.mealId);
    const quantity = Number(item && item.quantity) > 1 ? ` x${Number(item.quantity)}` : "";
    items.push({
      id: mealId || `order_item_${index + 1}`,
      name: `${item && item.name ? item.name : preferredLocalizedName(mealNameById.get(mealId), "وجبة")}${quantity}`,
      kind: "meal",
    });
  });

  items.push(...buildCustomItems("سلطة مخصصة", Array.isArray(order.customSalads) ? order.customSalads.length : 0, "addon"));
  items.push(...buildCustomItems("وجبة مخصصة", Array.isArray(order.customMeals) ? order.customMeals.length : 0, "meal"));

  return items;
}

function mapOrderToRow(order, context = {}) {
  const mode = order.deliveryMode === "pickup" ? "pickup" : "delivery";
  const items = mapOrderItems(order, context.mealNameById || new Map());
  const statusMeta = resolveStatusMeta({
    entityType: "order",
    rawStatus: order.status,
    mode,
    items,
  });

  const row = {
    id: stringifyId(order._id),
    entityType: "order",
    reference: formatReference("ORD", order.deliveryDate, order._id),
    customer: buildCustomerFromOrder(order),
    date: order.deliveryDate,
    mode,
    modeLabel: MODE_LABELS[mode] || mode,
    timeWindow: parseTimeWindow(order.deliveryWindow),
    items,
    status: statusMeta.status,
    statusLabel: statusMeta.statusLabel,
    progress: statusMeta.progress,
    actions: [],
    badges: {
      locked: ["preparing", "out_for_delivery", "ready_for_pickup", "fulfilled"].includes(order.status),
      assignedByKitchen: false,
      pickupRequested: false,
    },
    verification: buildVerification(order, mode),
    ui: {
      layout: "table",
    },
    timing: buildTiming(order.createdAt || order.confirmedAt || order.fulfilledAt || null),
    meta: {
      subscriptionId: null,
      orderId: stringifyId(order._id),
      dayId: null,
    },
    operationFlags: {
      creditsDeducted: false,
      pickupCodeIssued: false,
      pickupVerified: false,
    },
    rawStatus: order.status,
    sortStatusOrder: 0,
    branchId: null,
  };

  row.actions = resolveActions(row);

  return row;
}

function sanitizeRow(row) {
  return {
    id: row.id,
    entityType: row.entityType,
    reference: row.reference,
    customer: row.customer,
    date: row.date,
    mode: row.mode,
    modeLabel: row.modeLabel,
    timeWindow: row.timeWindow,
    items: row.items,
    status: row.status,
    statusLabel: row.statusLabel,
    progress: row.progress,
    actions: row.actions,
    badges: row.badges,
    verification: row.verification,
    ui: row.ui,
    timing: row.timing,
    meta: row.meta,
  };
}

module.exports = {
  preferredLocalizedName,
  parseTimeWindow,
  mapSubscriptionDayToRow,
  mapOrderToRow,
  sanitizeRow,
};

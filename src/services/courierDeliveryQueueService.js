"use strict";

const SubscriptionDay = require("../models/SubscriptionDay");
const Subscription = require("../models/Subscription");
const Order = require("../models/Order");
const Delivery = require("../models/Delivery");
const User = require("../models/User");
const { getTodayKSADate } = require("../utils/date");
const { mapSubscriptionDelivery, mapOneTimeOrderDelivery } = require("../mappers/deliveryMapper");
const { resolveEffectiveFulfillmentMode } = require("./subscription/subscriptionFulfillmentPolicyService");
const { shouldBlockOneTimeOrderDelivery } = require("../utils/oneTimeOrderDeliveryGate");
const { normalizeDeliveryStatus } = require("./deliveryWorkflowService");

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const VISIBLE_DELIVERY_DAY_STATUSES = new Set([
  "open",
  "locked",
  "in_preparation",
  "ready_for_delivery",
  "out_for_delivery",
  "fulfilled",
  "delivery_canceled",
]);

function createServiceError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function resolveBusinessDate(value) {
  if (value === undefined || value === null || value === "") {
    return getTodayKSADate();
  }

  const date = String(value).trim();
  if (!BUSINESS_DATE_PATTERN.test(date)) {
    throw createServiceError(400, "INVALID_DATE", "date must be in YYYY-MM-DD format");
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw createServiceError(400, "INVALID_DATE", "date must be a valid calendar date");
  }

  return date;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function canonicalPersistedDeliveryStatus(value) {
  const status = normalizeDeliveryStatus(value);
  if (["fulfilled", "delivered"].includes(status)) return "delivered";
  if (["cancelled", "canceled", "delivery_canceled"].includes(status)) return "canceled";
  if (["open", "locked", "confirmed", "preparing", "in_preparation"].includes(status)) {
    return "preparing";
  }
  return status;
}

function isVisibleDeliveryDayStatus(status) {
  return VISIBLE_DELIVERY_DAY_STATUSES.has(normalizeStatus(status));
}

function deliveryStatusFromSubscriptionDay(dayStatus) {
  switch (normalizeStatus(dayStatus)) {
    case "ready_for_delivery":
      return "ready_for_delivery";
    case "out_for_delivery":
      return "out_for_delivery";
    case "fulfilled":
      return "delivered";
    case "delivery_canceled":
      return "canceled";
    case "open":
    case "locked":
    case "in_preparation":
    default:
      return "preparing";
  }
}

function deliveryStatusFromOrder(orderStatus) {
  switch (normalizeStatus(orderStatus)) {
    case "out_for_delivery":
      return "out_for_delivery";
    case "fulfilled":
    case "delivered":
      return "delivered";
    case "cancelled":
    case "canceled":
      return "canceled";
    case "confirmed":
    case "in_preparation":
    case "preparing":
    default:
      return "preparing";
  }
}

function resolveSubscriptionDeliveryStatus(day, delivery) {
  const dayStatus = deliveryStatusFromSubscriptionDay(day && day.status);
  const persistedStatus = canonicalPersistedDeliveryStatus(delivery && delivery.status);

  if (["delivered", "canceled", "failed"].includes(persistedStatus)) {
    return persistedStatus;
  }
  if (persistedStatus === "out_for_delivery") {
    return "out_for_delivery";
  }
  if (persistedStatus === "ready_for_delivery" && dayStatus === "preparing") {
    return "ready_for_delivery";
  }

  return dayStatus;
}

function resolveOrderDeliveryStatus(order, delivery) {
  const persistedStatus = canonicalPersistedDeliveryStatus(delivery && delivery.status);
  if (persistedStatus && persistedStatus !== "scheduled") {
    return persistedStatus;
  }
  return deliveryStatusFromOrder(order && order.status);
}

function buildOneTimeOrderQuery(date) {
  return {
    $and: [
      { $or: [{ fulfillmentDate: date }, { deliveryDate: date }] },
      { $or: [{ fulfillmentMethod: "delivery" }, { deliveryMode: "delivery" }] },
    ],
    paymentStatus: "paid",
    status: { $nin: ["pending_payment", "failed_payment", "expired", "refunded"] },
  };
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function resolveDayAddress(day, subscription, delivery) {
  return firstObject(
    delivery && delivery.address,
    day && day.lockedSnapshot && day.lockedSnapshot.address,
    day && day.deliveryAddressOverride,
    subscription && subscription.deliveryAddress
  );
}

function resolveDayWindow(day, subscription, delivery) {
  return firstString(
    delivery && delivery.window,
    day && day.lockedSnapshot && day.lockedSnapshot.deliveryWindow,
    day && day.deliveryWindowOverride,
    subscription && subscription.deliveryWindow,
    subscription && subscription.deliverySlot && subscription.deliverySlot.window
  );
}

function resolveDayZoneName(day, subscription, delivery, address) {
  return firstString(
    delivery && delivery.zoneName,
    day && day.lockedSnapshot && day.lockedSnapshot.zoneName,
    subscription && subscription.deliveryZoneName,
    address && address.district,
    address && address.city
  );
}

function buildSubscriptionDeliverySnapshot(day, subscription, delivery) {
  const address = resolveDayAddress(day, subscription, delivery);
  const persisted = delivery || {};

  return {
    ...persisted,
    _id: persisted._id || day._id,
    subscriptionId: subscription._id,
    dayId: day,
    date: day.date,
    address,
    window: resolveDayWindow(day, subscription, persisted),
    zoneName: resolveDayZoneName(day, subscription, persisted, address),
    status: resolveSubscriptionDeliveryStatus(day, persisted),
    cancellationReason: persisted.cancellationReason || day.cancellationReason || null,
    cancellationNote: persisted.cancellationNote || day.cancellationNote || null,
    canceledAt: persisted.canceledAt || day.canceledAt || null,
    deliveredAt: persisted.deliveredAt || day.fulfilledAt || null,
  };
}

function buildOrderDeliverySnapshot(order, delivery) {
  return {
    ...(delivery || {}),
    status: resolveOrderDeliveryStatus(order, delivery),
  };
}

function makeQueueRowReadOnly(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  return {
    ...row,
    canCourierPickup: false,
    canMarkArrivingSoon: false,
    canMarkDelivered: false,
    canCancel: false,
    allowedActions: [],
    allowedActionIds: [],
  };
}

async function listCourierDeliveryQueue({ date } = {}) {
  const businessDate = resolveBusinessDate(date);

  const rawDays = await SubscriptionDay.find({ date: businessDate }).lean();
  const subscriptionIds = [...new Set(rawDays.map((day) => String(day.subscriptionId || "")).filter(Boolean))];
  const subscriptions = subscriptionIds.length
    ? await Subscription.find({ _id: { $in: subscriptionIds } }).lean()
    : [];
  const subscriptionMap = new Map(subscriptions.map((subscription) => [String(subscription._id), subscription]));

  const dayDocs = rawDays.filter((day) => {
    const subscription = subscriptionMap.get(String(day.subscriptionId));
    if (!subscription || !isVisibleDeliveryDayStatus(day.status)) return false;
    return resolveEffectiveFulfillmentMode({ subscription, day, date: day.date }) === "delivery";
  });

  const rawOrders = await Order.find(buildOneTimeOrderQuery(businessDate)).lean();
  const orders = rawOrders.filter((order) => !shouldBlockOneTimeOrderDelivery(order));

  const dayIds = dayDocs.map((day) => day._id);
  const orderIds = orders.map((order) => order._id);
  const userIds = [...new Set([
    ...dayDocs.map((day) => subscriptionMap.get(String(day.subscriptionId))?.userId),
    ...orders.map((order) => order.userId),
  ].filter(Boolean).map(String))];

  const [users, deliveries] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } }).select("name phone").lean()
      : [],
    dayIds.length || orderIds.length
      ? Delivery.find({
        $or: [
          ...(dayIds.length ? [{ dayId: { $in: dayIds } }] : []),
          ...(orderIds.length ? [{ orderId: { $in: orderIds } }] : []),
        ],
      }).lean()
      : [],
  ]);

  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const deliveryByDayId = new Map(
    deliveries.filter((delivery) => delivery.dayId).map((delivery) => [String(delivery.dayId), delivery])
  );
  const deliveryByOrderId = new Map(
    deliveries.filter((delivery) => delivery.orderId).map((delivery) => [String(delivery.orderId), delivery])
  );

  const mappedDays = dayDocs.map((day) => {
    const subscription = subscriptionMap.get(String(day.subscriptionId));
    const user = userMap.get(String(subscription.userId));
    const snapshot = buildSubscriptionDeliverySnapshot(
      day,
      subscription,
      deliveryByDayId.get(String(day._id))
    );
    return mapSubscriptionDelivery(snapshot, user);
  });

  const mappedOrders = orders.map((order) => {
    const user = userMap.get(String(order.userId));
    const snapshot = buildOrderDeliverySnapshot(
      order,
      deliveryByOrderId.get(String(order._id))
    );
    return mapOneTimeOrderDelivery(order, user, snapshot);
  });

  const sortedItems = [...mappedDays, ...mappedOrders].sort((a, b) => {
    const dateA = a.timestamps && a.timestamps.scheduledAt
      ? new Date(a.timestamps.scheduledAt).getTime()
      : 0;
    const dateB = b.timestamps && b.timestamps.scheduledAt
      ? new Date(b.timestamps.scheduledAt).getTime()
      : 0;
    return dateB - dateA;
  });

  const items = businessDate === getTodayKSADate()
    ? sortedItems
    : sortedItems.map(makeQueueRowReadOnly);

  return { date: businessDate, items };
}

module.exports = {
  buildOneTimeOrderQuery,
  buildOrderDeliverySnapshot,
  buildSubscriptionDeliverySnapshot,
  canonicalPersistedDeliveryStatus,
  deliveryStatusFromOrder,
  deliveryStatusFromSubscriptionDay,
  isVisibleDeliveryDayStatus,
  listCourierDeliveryQueue,
  makeQueueRowReadOnly,
  resolveBusinessDate,
  resolveDayZoneName,
  resolveOrderDeliveryStatus,
  resolveSubscriptionDeliveryStatus,
};

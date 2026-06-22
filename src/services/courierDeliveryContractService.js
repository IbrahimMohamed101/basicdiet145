"use strict";

const Delivery = require("../models/Delivery");
const Order = require("../models/Order");
const Subscription = require("../models/Subscription");
const SubscriptionDay = require("../models/SubscriptionDay");

function text(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function localizedText(value) {
  if (!value || typeof value !== "object") return text(value);
  return text(value.en) || text(value.ar);
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeAddress(source) {
  const address = source && typeof source === "object" ? source : {};
  const street = text(address.street) || text(address.line1);
  const building = text(address.building) || text(address.line2);
  const parts = [street, building, text(address.district), text(address.city)].filter(Boolean);
  return {
    label: text(address.label),
    city: text(address.city),
    district: text(address.district),
    street,
    building,
    floor: text(address.floor),
    apartment: text(address.apartment),
    notes: text(address.notes),
    latitude: numberOrNull(address.latitude !== undefined ? address.latitude : address.lat),
    longitude: numberOrNull(address.longitude !== undefined ? address.longitude : address.lng),
    formattedAddress: text(address.formattedAddress) || (parts.length ? parts.join(", ") : null),
  };
}

function contractStatus(delivery, fallbackStatus) {
  const status = String((delivery && delivery.status) || fallbackStatus || "").toLowerCase();
  if (status === "delivered" || status === "fulfilled") return "delivered";
  if (status === "canceled" || status === "cancelled" || status === "delivery_canceled") return "canceled";
  if (status === "failed") return "failed";
  if (delivery && delivery.arrivingSoonReminderSentAt) return "arriving_soon";
  if (status === "out_for_delivery") return "out_for_delivery";
  return "preparing";
}

function resolveSubscriptionDeliveryAddress({ delivery, day, subscription }) {
  return (day && day.deliveryAddressOverride)
    || (delivery && delivery.address)
    || (subscription && subscription.deliveryAddress)
    || null;
}

function serializeSubscriptionDelivery({ delivery, day, subscription, user }) {
  const window = (day && day.deliveryWindowOverride)
    || (delivery && delivery.window)
    || (subscription && subscription.deliveryWindow)
    || (subscription && subscription.deliverySlot && subscription.deliverySlot.window);
  return {
    id: String(delivery._id),
    type: "subscription_delivery",
    customerName: text(user && user.name) || "",
    customerPhone: text(user && (user.phoneE164 || user.phone)) || "",
    deliveryAddress: normalizeAddress(resolveSubscriptionDeliveryAddress({ delivery, day, subscription })),
    deliveryZone: text(subscription && subscription.deliveryZoneName),
    deliveryWindow: text(window),
    status: contractStatus(delivery, day && day.status),
    scheduledDate: text(day && day.date) || text(delivery.date),
    orderNumber: null,
    subscriptionId: subscription && subscription._id ? String(subscription._id) : null,
    subscriptionDayId: day && day._id ? String(day._id) : (delivery.dayId ? String(delivery.dayId) : null),
  };
}

function serializeOrderDelivery({ delivery, order, user }) {
  const address = (order && order.delivery && order.delivery.address)
    || (delivery && delivery.address)
    || (order && order.deliveryAddress)
    || null;
  const zoneName = order && order.delivery && order.delivery.zoneName;
  return {
    id: String(order._id),
    type: "one_time_order",
    customerName: text(user && user.name) || "",
    customerPhone: text(user && (user.phoneE164 || user.phone)) || text(address && address.phone) || "",
    deliveryAddress: normalizeAddress(address),
    deliveryZone: localizedText(zoneName),
    deliveryWindow: text((delivery && delivery.window) || (order && order.deliveryWindow)),
    status: contractStatus(delivery, order && order.status),
    scheduledDate: text(order && (order.fulfillmentDate || order.deliveryDate)),
    orderNumber: text(order && order.orderNumber),
    subscriptionId: null,
    subscriptionDayId: null,
  };
}

async function getSubscriptionDeliveryContract(deliveryId, { session } = {}) {
  const delivery = await Delivery.findById(deliveryId).session(session).lean();
  if (!delivery) return null;
  const [day, subscription] = await Promise.all([
    SubscriptionDay.findById(delivery.dayId).session(session).lean(),
    Subscription.findById(delivery.subscriptionId).populate("userId", "name phone phoneE164").session(session).lean(),
  ]);
  if (!day || !subscription) return null;
  return serializeSubscriptionDelivery({
    delivery,
    day,
    subscription,
    user: subscription.userId,
  });
}

async function getOrderDeliveryContract(orderId, { session } = {}) {
  const [order, delivery] = await Promise.all([
    Order.findById(orderId).populate("userId", "name phone phoneE164").session(session).lean(),
    Delivery.findOne({ orderId }).session(session).lean(),
  ]);
  if (!order || !delivery) return null;
  return serializeOrderDelivery({ order, delivery, user: order.userId });
}

module.exports = {
  contractStatus,
  getOrderDeliveryContract,
  getSubscriptionDeliveryContract,
  normalizeAddress,
  serializeOrderDelivery,
  serializeSubscriptionDelivery,
};

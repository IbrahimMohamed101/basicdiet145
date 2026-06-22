"use strict";

const { normalizeDeliveryStatus } = require("../services/deliveryWorkflowService");

function formatAddress(address) {
  if (!address) return null;
  const parts = [
    address.line1,
    address.line2,
    address.building ? `Bldg ${address.building}` : null,
    address.floor ? `Floor ${address.floor}` : null,
    address.apartment ? `Apt ${address.apartment}` : null,
    address.street,
    address.district,
    address.city
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function resolveStatus(deliveryStatus, arrivingSoonReminderSentAt) {
  const normalized = normalizeDeliveryStatus(deliveryStatus);
  if (normalized === "scheduled") return "preparing";
  if (normalized === "ready_for_delivery") return "ready_for_delivery";
  if (normalized === "out_for_delivery" && arrivingSoonReminderSentAt) return "arriving_soon";
  if (normalized === "out_for_delivery") return "out_for_delivery";
  if (normalized === "delivered") return "delivered";
  if (normalized === "canceled") return "canceled";
  if (normalized === "failed") return "failed";
  return normalized || "preparing";
}

function mapSubscriptionDelivery(delivery, user) {
  const addr = delivery.address || {};
  const day = delivery.dayId && typeof delivery.dayId === "object" ? delivery.dayId : null;
  const dayIdStr = day ? String(day._id) : (delivery.dayId ? String(delivery.dayId) : null);

  const mealCount = day ? (Array.isArray(day.selections) && day.selections.length > 0 ? day.selections.length : (Array.isArray(day.mealSlots) ? day.mealSlots.length : 0)) : 0;
  const addonCount = day ? (Array.isArray(day.addonSelections) ? day.addonSelections.length : 0) : 0;
  const premiumUpgradeCount = day ? (Array.isArray(day.premiumUpgradeSelections) ? day.premiumUpgradeSelections.length : 0) : 0;

  const statusResolved = resolveStatus(delivery.status, delivery.arrivingSoonReminderSentAt);

  const canCourierPickup = delivery.status === "ready_for_delivery";
  const canMarkArrivingSoon = delivery.status === "out_for_delivery" && !delivery.arrivingSoonReminderSentAt;
  const canMarkDelivered = statusResolved === "out_for_delivery" || statusResolved === "arriving_soon";
  const canCancel = delivery.status !== "delivered" && delivery.status !== "canceled" && delivery.status !== "failed";

  return {
    id: String(delivery._id),
    type: "subscription_delivery",
    customerName: user ? user.name || "" : "",
    customerPhone: user ? user.phone || "" : "",
    deliveryAddress: {
      label: addr.label || null,
      city: addr.city || null,
      district: addr.district || null,
      street: addr.street || null,
      building: addr.building || null,
      floor: addr.floor || null,
      apartment: addr.apartment || null,
      notes: addr.notes || null,
      latitude: addr.lat || null,
      longitude: addr.lng || null,
      formattedAddress: formatAddress(addr) || addr.line1 || null,
    },
    deliveryZone: delivery.zoneName || null,
    deliveryWindow: delivery.window || null,
    status: statusResolved,
    preparationStatus: day ? day.status : (delivery.status === "ready_for_delivery" ? "ready_for_delivery" : "preparing"),
    scheduledDate: delivery.date || null,
    orderNumber: null,
    subscriptionId: delivery.subscriptionId ? String(delivery.subscriptionId) : null,
    subscriptionDayId: dayIdStr,
    mealCount,
    addonCount,
    premiumUpgradeCount,
    canCourierPickup,
    canMarkArrivingSoon,
    canMarkDelivered,
    canCancel,
  };
}

function mapOneTimeOrderDelivery(order, user, delivery) {
  const addr = (order.delivery && order.delivery.address) || order.deliveryAddress || {};
  const deliv = delivery || {};
  
  let zoneName = null;
  if (order.delivery && order.delivery.zoneName) {
    if (typeof order.delivery.zoneName === "string") {
      zoneName = order.delivery.zoneName;
    } else {
      zoneName = order.delivery.zoneName.en || order.delivery.zoneName.ar || null;
    }
  }

  const mealCount = order.items ? order.items.filter(i => (i.itemType || "").includes("meal")).reduce((acc, i) => acc + (i.qty || 1), 0) : 0;
  const addonCount = order.items ? order.items.filter(i => !(i.itemType || "").includes("meal")).reduce((acc, i) => acc + (i.qty || 1), 0) : 0;
  const premiumUpgradeCount = order.items ? order.items.filter(i => i.selections && i.selections.isPremium).reduce((acc, i) => acc + (i.qty || 1), 0) : 0;

  const statusResolved = resolveStatus(
    deliv.status || (order.status === "fulfilled" ? "delivered" : (order.status === "cancelled" || order.status === "canceled" ? "canceled" : "preparing")),
    deliv.arrivingSoonReminderSentAt
  );

  const canCourierPickup = deliv.status === "ready_for_delivery";
  const canMarkArrivingSoon = deliv.status === "out_for_delivery" && !deliv.arrivingSoonReminderSentAt;
  const canMarkDelivered = statusResolved === "out_for_delivery" || statusResolved === "arriving_soon";
  const canCancel = deliv.status !== "delivered" && deliv.status !== "canceled" && deliv.status !== "failed";

  return {
    id: String(order._id),
    type: "one_time_order",
    customerName: user ? user.name || "" : "",
    customerPhone: user ? user.phone || "" : "",
    deliveryAddress: {
      label: addr.label || null,
      city: addr.city || null,
      district: addr.district || null,
      street: addr.street || null,
      building: addr.building || null,
      floor: addr.floor || null,
      apartment: addr.apartment || null,
      notes: addr.notes || null,
      latitude: addr.lat || null,
      longitude: addr.lng || null,
      formattedAddress: formatAddress(addr) || addr.line1 || null,
    },
    deliveryZone: zoneName,
    deliveryWindow: order.deliveryWindow || null,
    status: statusResolved,
    preparationStatus: order.status || null,
    scheduledDate: order.fulfillmentDate || order.deliveryDate || null,
    orderNumber: order.orderNumber || null,
    subscriptionId: null,
    subscriptionDayId: null,
    mealCount,
    addonCount,
    premiumUpgradeCount,
    canCourierPickup,
    canMarkArrivingSoon,
    canMarkDelivered,
    canCancel,
  };
}

module.exports = {
  mapSubscriptionDelivery,
  mapOneTimeOrderDelivery,
};

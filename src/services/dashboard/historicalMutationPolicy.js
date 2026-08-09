"use strict";

const dateUtils = require("../../utils/date");

const HISTORICAL_DELIVERY_FULFILL_ROLES = new Set(["admin", "superadmin", "courier"]);
const HISTORICAL_DELIVERY_FULFILL_STATUSES = new Set(["ready_for_delivery", "out_for_delivery"]);

function resolveBusinessDate(doc = {}) {
  return doc.date
    || doc.fulfillmentDate
    || doc.deliveryDate
    || doc.scheduledDate
    || doc.pickupDate
    || doc.serviceDate
    || null;
}

function normalizeEntityType(entityType) {
  if (entityType === "subscription_day" || entityType === "pickup_day") return "subscription";
  return String(entityType || "").trim().toLowerCase();
}

function canRecoverHistoricalDeliveryFulfillment({
  entityType,
  actionId,
  status,
  role,
  mode,
  businessDate,
  today = dateUtils.getTodayKSADate(),
} = {}) {
  const normalizedEntityType = normalizeEntityType(entityType);
  const normalizedAction = String(actionId || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedMode = String(mode || "").trim().toLowerCase();
  const historical = Boolean(businessDate && today && businessDate < today);

  return Boolean(
    historical
    && normalizedEntityType === "subscription"
    && normalizedAction === "fulfill"
    && normalizedMode === "delivery"
    && HISTORICAL_DELIVERY_FULFILL_ROLES.has(normalizedRole)
    && HISTORICAL_DELIVERY_FULFILL_STATUSES.has(normalizedStatus)
  );
}

module.exports = {
  HISTORICAL_DELIVERY_FULFILL_ROLES,
  HISTORICAL_DELIVERY_FULFILL_STATUSES,
  resolveBusinessDate,
  canRecoverHistoricalDeliveryFulfillment,
};

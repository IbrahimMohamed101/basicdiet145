"use strict";

const dateUtils = require("../../utils/date");
const { isBranchOperator } = require("../../constants/dashboardRoles");

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

function isHistoricalBusinessDate(businessDate, today = dateUtils.getTodayKSADate()) {
  return Boolean(businessDate && today && businessDate < today);
}

function canRecoverHistoricalDeliveryFulfillment({
  entityType,
  actionId,
  status,
  role,
  mode,
  businessDate,
  today = dateUtils.getTodayKSADate(),
  allowSettledReplay = false,
} = {}) {
  const normalizedEntityType = normalizeEntityType(entityType);
  const normalizedAction = String(actionId || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedMode = String(mode || "").trim().toLowerCase();
  const branchPreviousDay = isBranchOperator(normalizedRole)
    && businessDate === dateUtils.addDaysToKSADateString(today, -1);

  return Boolean(
    isHistoricalBusinessDate(businessDate, today)
    && normalizedEntityType === "subscription"
    && normalizedAction === "fulfill"
    && normalizedMode === "delivery"
    && (HISTORICAL_DELIVERY_FULFILL_ROLES.has(normalizedRole) || branchPreviousDay)
    && (HISTORICAL_DELIVERY_FULFILL_STATUSES.has(normalizedStatus)
      || (allowSettledReplay && normalizedStatus === "fulfilled"))
  );
}

function canRecordHistoricalNoShow({ actionId, role, entityType }) {
  return actionId === "no_show"
    && ["admin", "superadmin"].includes(String(role || ""))
    && ["subscription", "subscription_pickup_request"].includes(normalizeEntityType(entityType));
}

module.exports = {
  HISTORICAL_DELIVERY_FULFILL_ROLES,
  HISTORICAL_DELIVERY_FULFILL_STATUSES,
  resolveBusinessDate,
  isHistoricalBusinessDate,
  canRecoverHistoricalDeliveryFulfillment,
  canRecordHistoricalNoShow,
};

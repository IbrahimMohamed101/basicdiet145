"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Subscription = require("../../models/Subscription");
const Delivery = require("../../models/Delivery");
const Zone = require("../../models/Zone");
const ActivityLog = require("../../models/ActivityLog");
const opsTransitionService = require("../../services/dashboard/opsTransitionService");
const opsActionPolicy = require("../../services/dashboard/opsActionPolicy");
const errorResponse = require("../../utils/errorResponse");
const dateUtils = require("../../utils/date");
const { getRequestLang } = require("../../utils/i18n");
const { getRestaurantBusinessDate } = require("../../services/restaurantHoursService");
const {
  settlePastSubscriptionDaysForDate,
} = require("../../services/subscription/pastSubscriptionDaySettlementService");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value) {
  const date = String(value || "").trim();
  return DATE_RE.test(date) ? date : dateUtils.toKSADateString(new Date());
}

function normalizeStatusList(value, fallback) {
  if (!value) return fallback;
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function getDeliveryMode(subscription) {
  return subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery";
}

function getAddress(day, subscription) {
  return day.deliveryAddressOverride
    || (subscription && subscription.deliveryAddress)
    || null;
}

function getWindow(day, subscription) {
  return day.deliveryWindowOverride
    || (subscription && subscription.deliveryWindow)
    || "";
}

function summarizeLatestAction(log) {
  if (!log) return null;
  return {
    action: log.action || null,
    at: log.createdAt || null,
    by: log.byUserId ? String(log.byUserId) : null,
    role: log.byRole || null,
    meta: log.meta || null,
  };
}

async function buildLatestActionMap(dayIds) {
  if (!dayIds.length) return new Map();
  const logs = await ActivityLog.find({
    entityType: "subscription",
    entityId: { $in: dayIds },
  }).sort({ createdAt: -1 }).lean();
  const map = new Map();
  for (const log of logs) {
    const key = String(log.entityId);
    if (!map.has(key)) map.set(key, summarizeLatestAction(log));
  }
  return map;
}

async function buildZoneMap(subscriptions) {
  const ids = Array.from(new Set(
    subscriptions.map((sub) => sub && sub.deliveryZoneId ? String(sub.deliveryZoneId) : null).filter(Boolean)
  ));
  if (!ids.length) return new Map();
  const zones = await Zone.find({ _id: { $in: ids } }).lean();
  return new Map(zones.map((zone) => [String(zone._id), zone]));
}

function mapDay(day, latestAction, zoneMap, lang, role) {
  const subscription = day.subscriptionId || {};
  const user = subscription.userId || {};
  const mode = getDeliveryMode(subscription);
  const zone = subscription.deliveryZoneId ? zoneMap.get(String(subscription.deliveryZoneId)) : null;
  const allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "subscription",
    status: day.status,
    mode,
    role,
    lang,
  });

  return {
    id: String(day._id),
    entityId: String(day._id),
    entityType: "subscription_day",
    subscriptionDayId: String(day._id),
    subscriptionId: subscription && subscription._id ? String(subscription._id) : String(day.subscriptionId || ""),
    user: {
      id: user && user._id ? String(user._id) : null,
      name: user && user.name ? String(user.name) : "",
      phone: user && user.phone ? String(user.phone) : "",
    },
    date: day.date,
    status: day.status,
    deliveryMethod: mode,
    deliveryMode: mode,
    delivery: {
      method: mode,
      address: getAddress(day, subscription),
      zone: zone ? { id: String(zone._id), name: zone.name || null } : null,
      zoneId: subscription.deliveryZoneId ? String(subscription.deliveryZoneId) : null,
      deliveryWindow: getWindow(day, subscription),
      pickupLocationId: subscription.pickupLocationId ? String(subscription.pickupLocationId) : null,
    },
    pickup: {
      pickupLocationId: subscription.pickupLocationId ? String(subscription.pickupLocationId) : null,
      pickupRequested: Boolean(day.pickupRequested),
      pickupPreparedAt: day.pickupPreparedAt || null,
      pickupCodeIssuedAt: day.pickupCodeIssuedAt || null,
      pickupVerifiedAt: day.pickupVerifiedAt || null,
      pickupNoShowAt: day.pickupNoShowAt || null,
    },
    mealSlots: day.mealSlots || [],
    materializedMeals: day.materializedMeals || [],
    addonSelections: day.addonSelections || day.oneTimeAddonSelections || day.addonsOneTime || [],
    premiumUpgradeSelections: day.premiumUpgradeSelections || [],
    notes: day.cancellationNote || (day.deliveryAddressOverride && day.deliveryAddressOverride.notes) || null,
    lastActionAt: latestAction && latestAction.at ? latestAction.at : null,
    lastActionBy: latestAction && latestAction.by ? latestAction.by : null,
    latestAction,
    allowedActions,
    createdAt: day.createdAt || null,
    updatedAt: day.updatedAt || null,
  };
}

function matchesSearch(item, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    item.user.name,
    item.user.phone,
    item.subscriptionId,
    item.subscriptionDayId,
  ].filter(Boolean).join(" ").toLowerCase().includes(needle);
}

async function queryBoardDays(req, { screen }) {
  const date = normalizeDate(req.query.date);
  const method = String(req.query.method || (screen === "pickup" ? "pickup" : screen === "courier" ? "delivery" : "all")).trim();
  const q = String(req.query.q || req.query.search || "").trim();
  const role = req.dashboardUserRole || req.userRole || "admin";
  const lang = getRequestLang(req);
  const businessDate = await getRestaurantBusinessDate();
  const isPastDate = date < businessDate;
  const defaultStatuses = screen === "courier"
    ? ["in_preparation", "out_for_delivery", "fulfilled", "delivery_canceled"]
    : screen === "pickup"
      ? ["in_preparation", "ready_for_pickup", "fulfilled", "canceled_at_branch", "no_show"]
      : ["open", "locked", "in_preparation", "ready_for_pickup", "out_for_delivery", "delivery_canceled", "canceled_at_branch"];
  const statuses = normalizeStatusList(
    req.query.status,
    isPastDate
      ? Array.from(new Set(defaultStatuses.concat(["consumed_without_preparation", "no_show"])))
      : defaultStatuses
  );

  await settlePastSubscriptionDaysForDate({
    date,
    actor: {
      actorType: role,
      dashboardUserId: req.dashboardUserId || req.userId || null,
    },
  });

  const dayQuery = { date, status: { $in: statuses } };
  const days = await SubscriptionDay.find(dayQuery)
    .populate({
      path: "subscriptionId",
      select: "_id userId deliveryMode deliveryWindow deliveryAddress deliveryZoneId pickupLocationId",
      populate: { path: "userId", select: "_id name phone" },
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const filteredByMethod = days.filter((day) => {
    const mode = getDeliveryMode(day.subscriptionId || {});
    if (method === "all") return true;
    return mode === method;
  });

  const [latestActionMap, zoneMap] = await Promise.all([
    buildLatestActionMap(filteredByMethod.map((day) => day._id)),
    buildZoneMap(filteredByMethod.map((day) => day.subscriptionId || {})),
  ]);

  let items = filteredByMethod.map((day) => mapDay(
    day,
    latestActionMap.get(String(day._id)),
    zoneMap,
    lang,
    role
  ));

  if (req.query.zoneId) {
    items = items.filter((item) => item.delivery.zoneId === String(req.query.zoneId));
  }
  if (req.query.branchId) {
    items = items.filter((item) => item.pickup.pickupLocationId === String(req.query.branchId));
  }
  items = items.filter((item) => matchesSearch(item, q));

  return { date, items, filters: { status: statuses, method, q: q || null, zoneId: req.query.zoneId || null, branchId: req.query.branchId || null } };
}

async function queue(req, res) {
  const screen = req.params.screen;
  const role = req.dashboardUserRole || req.userRole;
  if (screen === "kitchen" && !["superadmin", "admin", "kitchen"].includes(role)) {
    return errorResponse(res, 403, "FORBIDDEN", "Kitchen board requires kitchen or admin role");
  }
  if (screen === "courier" && !["superadmin", "admin", "courier"].includes(role)) {
    return errorResponse(res, 403, "FORBIDDEN", "Courier board requires courier or admin role");
  }
  if (screen === "pickup" && !["superadmin", "admin", "kitchen"].includes(role)) {
    return errorResponse(res, 403, "FORBIDDEN", "Pickup board requires kitchen or admin role");
  }

  const data = await queryBoardDays(req, { screen });
  return res.status(200).json({ status: true, data });
}

async function queueDetail(req, res) {
  const existingDay = await SubscriptionDay.findById(req.params.dayId).select("date").lean();
  if (existingDay) {
    await settlePastSubscriptionDaysForDate({
      date: existingDay.date,
      actor: {
        actorType: req.dashboardUserRole || req.userRole || "admin",
        dashboardUserId: req.dashboardUserId || req.userId || null,
      },
    });
  }
  const day = await SubscriptionDay.findById(req.params.dayId)
    .populate({
      path: "subscriptionId",
      select: "_id userId deliveryMode deliveryWindow deliveryAddress deliveryZoneId pickupLocationId",
      populate: { path: "userId", select: "_id name phone" },
    })
    .lean();
  if (!day) return errorResponse(res, 404, "NOT_FOUND", "Subscription day not found");
  const [latestActionMap, zoneMap] = await Promise.all([
    buildLatestActionMap([day._id]),
    buildZoneMap([day.subscriptionId || {}]),
  ]);
  return res.status(200).json({
    status: true,
    data: mapDay(day, latestActionMap.get(String(day._id)), zoneMap, getRequestLang(req), req.dashboardUserRole),
  });
}

async function action(req, res) {
  const actionId = req.params.action;
  const entityId = req.body && req.body.entityId;
  const payload = req.body && req.body.payload ? req.body.payload : {};
  if (!entityId) return errorResponse(res, 400, "INVALID_REQUEST", "entityId is required");

  const existingDay = await SubscriptionDay.findById(entityId).select("date").lean();
  if (existingDay) {
    await settlePastSubscriptionDaysForDate({
      date: existingDay.date,
      actor: {
        actorType: req.dashboardUserRole || req.userRole || "admin",
        dashboardUserId: req.dashboardUserId || req.userId || null,
      },
    });
  }
  const day = await SubscriptionDay.findById(entityId).populate("subscriptionId", "deliveryMode").lean();
  if (!day) return errorResponse(res, 404, "NOT_FOUND", "Subscription day not found");
  const mode = getDeliveryMode(day.subscriptionId || {});
  const validation = opsActionPolicy.validateAction({
    entityType: "subscription",
    status: day.status,
    mode,
    role: req.dashboardUserRole,
    actionId,
  });
  if (!validation.allowed) {
    return errorResponse(res, 409, validation.reason, `Action ${actionId} is not allowed in current state`);
  }

  await opsTransitionService.executeAction(actionId, {
    entityId,
    entityType: "subscription_day",
    userId: req.dashboardUserId,
    role: req.dashboardUserRole,
    payload,
  });

  req.params.dayId = entityId;
  return queueDetail(req, res);
}

function countBy(items, predicate) {
  return items.filter(predicate).length;
}

async function deliverySchedule(req, res) {
  req.query.method = "delivery";
  const data = await queryBoardDays(req, { screen: "courier" });
  const items = data.items;
  const groupedByWindow = {};
  const groupedByZone = {};
  for (const item of items) {
    const window = item.delivery.deliveryWindow || "unscheduled";
    const zone = item.delivery.zoneId || "unassigned";
    groupedByWindow[window] = (groupedByWindow[window] || 0) + 1;
    groupedByZone[zone] = (groupedByZone[zone] || 0) + 1;
  }
  return res.status(200).json({
    status: true,
    data: {
      date: data.date,
      summary: {
        total: items.length,
        pendingPreparation: countBy(items, (item) => ["open", "locked", "in_preparation"].includes(item.status)),
        ready: countBy(items, (item) => item.status === "in_preparation"),
        outForDelivery: countBy(items, (item) => item.status === "out_for_delivery"),
        fulfilled: countBy(items, (item) => item.status === "fulfilled"),
        canceled: countBy(items, (item) => item.status === "delivery_canceled"),
      },
      groupedByWindow,
      groupedByZone,
      items,
      filters: data.filters,
    },
  });
}

module.exports = {
  queue,
  queueDetail,
  action,
  deliverySchedule,
};

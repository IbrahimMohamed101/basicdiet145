"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Subscription = require("../../models/Subscription");
const Order = require("../../models/Order");
const Delivery = require("../../models/Delivery");
const Zone = require("../../models/Zone");
const ActivityLog = require("../../models/ActivityLog");
const opsTransitionService = require("../../services/dashboard/opsTransitionService");
const opsActionPolicy = require("../../services/dashboard/opsActionPolicy");
const dashboardDtoService = require("../../services/dashboard/dashboardDtoService");
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
    item.user && item.user.name,
    item.user && item.user.phone,
    item.customer && item.customer.name,
    item.customer && item.customer.phone,
    item.subscriptionId,
    item.subscriptionDayId,
    item.orderId,
    item.orderNumber,
    item.reference
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

  let activeOrderStatuses = [];
  if (req.query.status) {
    const requested = normalizeStatusList(req.query.status, []);
    for (const s of requested) {
      if (s === "open" || s === "locked" || s === "confirmed") activeOrderStatuses.push("confirmed");
      if (s === "in_preparation") activeOrderStatuses.push("in_preparation");
      if (s === "out_for_delivery") activeOrderStatuses.push("out_for_delivery");
      if (s === "ready_for_pickup") activeOrderStatuses.push("ready_for_pickup");
      if (s === "fulfilled") activeOrderStatuses.push("fulfilled");
      if (s === "delivery_canceled" || s === "canceled_at_branch" || s === "cancelled" || s === "canceled") {
        activeOrderStatuses.push("cancelled", "canceled");
      }
    }
  } else {
    // Default statuses
    if (screen === "kitchen") {
      activeOrderStatuses = ["confirmed", "in_preparation"];
    } else if (screen === "courier") {
      activeOrderStatuses = ["in_preparation", "out_for_delivery"];
    } else if (screen === "pickup") {
      activeOrderStatuses = ["in_preparation", "ready_for_pickup"];
    } else {
      activeOrderStatuses = ["confirmed", "in_preparation", "out_for_delivery", "ready_for_pickup"];
    }
  }

  const orderQuery = {
    $or: [{ deliveryDate: date }, { fulfillmentDate: date }],
    paymentStatus: "paid",
  };
  if (activeOrderStatuses.length > 0) {
    orderQuery.status = { $in: activeOrderStatuses };
  }

  const orders = await Order.find(orderQuery)
    .populate("userId", "_id name phone")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const filteredOrderItems = orders.filter((order) => {
    const oMode = order.fulfillmentMethod || order.deliveryMode || "delivery";
    if (method === "all") return true;
    return oMode === method;
  });

  const orderItems = filteredOrderItems.map((order) => {
    return dashboardDtoService.mapOrderToDTO(order, null, order.userId, role, lang);
  });

  items = [...items, ...orderItems];

  if (req.query.zoneId) {
    items = items.filter((item) => (item.delivery && item.delivery.zoneId) === String(req.query.zoneId));
  }
  if (req.query.branchId) {
    items = items.filter((item) => {
      const p = item.pickup || {};
      return p.pickupLocationId === String(req.query.branchId) || p.branchId === String(req.query.branchId);
    });
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

  let entityType = "subscription_day";
  if (req.body && (req.body.entityType === "order" || req.body.source === "one_time_order")) {
    entityType = "order";
  }

  if (entityType === "order") {
    const order = await Order.findById(entityId).lean();
    if (!order) return errorResponse(res, 404, "NOT_FOUND", "Order not found");
    const mode = order.fulfillmentMethod || order.deliveryMode || "delivery";
    const validation = opsActionPolicy.validateAction({
      entityType: "order",
      status: order.status,
      mode,
      role: req.dashboardUserRole,
      actionId,
    });
    if (!validation.allowed) {
      return errorResponse(res, 409, validation.reason, `Action ${actionId} is not allowed in current state`);
    }
    
    await opsTransitionService.executeAction(actionId, {
      entityId,
      entityType: "order",
      userId: req.dashboardUserId,
      role: req.dashboardUserRole,
      payload,
    });
    return res.status(200).json({ status: true, data: { action: "dispatched" } });
  }

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
    const window = (item.context && item.context.window) || (item.delivery && item.delivery.deliveryWindow) || "unscheduled";
    const zone = (item.delivery && item.delivery.zoneId) || "unassigned";
    groupedByWindow[window] = (groupedByWindow[window] || 0) + 1;
    groupedByZone[zone] = (groupedByZone[zone] || 0) + 1;
  }
  return res.status(200).json({
    status: true,
    data: {
      date: data.date,
      summary: {
        total: items.length,
        pendingPreparation: countBy(items, (item) => ["open", "locked", "in_preparation", "confirmed"].includes(item.status)),
        ready: countBy(items, (item) => item.status === "in_preparation" || item.status === "ready_for_pickup"),
        outForDelivery: countBy(items, (item) => item.status === "out_for_delivery"),
        fulfilled: countBy(items, (item) => item.status === "fulfilled"),
        canceled: countBy(items, (item) => ["delivery_canceled", "canceled_at_branch", "cancelled", "canceled", "no_show"].includes(item.status)),
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

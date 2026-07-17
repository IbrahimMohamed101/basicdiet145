"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const Subscription = require("../../models/Subscription");
const mongoose = require("mongoose");
const Order = require("../../models/Order");
const Delivery = require("../../models/Delivery");
const Zone = require("../../models/Zone");
const ActivityLog = require("../../models/ActivityLog");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const MenuProduct = require("../../models/MenuProduct");
const MenuOption = require("../../models/MenuOption");
const SaladIngredient = require("../../models/SaladIngredient");
const Addon = require("../../models/Addon");
const Meal = require("../../models/Meal");
const Sandwich = require("../../models/Sandwich");
const opsTransitionService = require("../../services/dashboard/opsTransitionService");
const opsActionPolicy = require("../../services/dashboard/opsActionPolicy");
const dashboardDtoService = require("../../services/dashboard/dashboardDtoService");
const { executeDashboardOrderAction } = require("../../services/orders/orderDashboardService");
const { validateSubscriptionDayOperationalGate } = require("../../services/dashboard/subscriptionDayOperationalGateService");
const errorResponse = require("../../utils/errorResponse");
const dateUtils = require("../../utils/date");
const { getRequestLang } = require("../../utils/i18n");
const { getRestaurantBusinessDate } = require("../../services/restaurantHoursService");
const { shouldBlockOneTimeOrderDelivery } = require("../../utils/oneTimeOrderDeliveryGate");
const {
  buildDeliveryPayload,
  buildKitchenDetailsPayload,
  buildPaymentValidityPayload,
  buildPickupPayload,
  buildPlanPayload,
} = require("../../services/dashboard/opsPayloadService");
const { resolveEffectiveFulfillmentMode } = require("../../services/subscription/subscriptionFulfillmentPolicyService");
const {
  isTruthyQuery,
  normalizeKitchenQueueItem,
  normalizeKitchenQueueResponse,
  shouldUseCleanQueueContract,
} = require("../../services/dashboard/kitchenQueueContractService");
const { buildKitchenCatalogMaps } = require("../../services/dashboard/kitchenCatalogService");
const { buildKitchenProjection } = require("../../services/dashboard/kitchenProjectionService");
const {
  serializeKitchenOperationsCollection,
} = require("../../services/dashboard/kitchenOperationsContractService");
// Settlement on read is DISABLED — see pastSubscriptionDaySettlementService.js

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value) {
  const date = String(value || "").trim();
  return DATE_RE.test(date) ? date : dateUtils.getTodayKSADate();
}

function normalizeStatusList(value, fallback) {
  if (!value) return fallback;
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function getDeliveryMode(subscription) {
  return subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery";
}

function getEffectiveDeliveryMode(day, subscription) {
  return resolveEffectiveFulfillmentMode({
    subscription: subscription || {},
    day,
    date: day && day.date,
  });
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

function mapDay(day, latestAction, zoneMap, lang, role, delivery = null, catalogMaps = {}) {
  const subscription = day.subscriptionId || {};
  const user = subscription.userId || {};
  const mode = getEffectiveDeliveryMode(day, subscription);
  const zone = subscription.deliveryZoneId ? zoneMap.get(String(subscription.deliveryZoneId)) : null;
  const allowedActions = opsActionPolicy.getAllowedActions({
    entityType: "subscription",
    status: day.status,
    mode,
    role,
    lang,
  });

  const deliveryPayload = buildDeliveryPayload(delivery, {
    date: day.date,
    address: getAddress(day, subscription),
    window: getWindow(day, subscription),
    zoneId: subscription.deliveryZoneId || null,
  });
  const kitchenDetails = buildKitchenDetailsPayload(day, subscription, lang, catalogMaps);

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
    fulfillmentType: mode === "pickup" ? "branch_pickup" : "home_delivery",
    plan: buildPlanPayload(subscription, lang),
    kitchenDetails,
    ...buildKitchenProjection(kitchenDetails),
    paymentValidity: buildPaymentValidityPayload(day),
    deliveryMethod: mode,
    deliveryMode: mode,
    delivery: {
      ...deliveryPayload,
      method: mode,
      address: getAddress(day, subscription),
      zone: zone ? { id: String(zone._id), name: zone.name || null } : null,
      zoneId: subscription.deliveryZoneId ? String(subscription.deliveryZoneId) : null,
      deliveryWindow: getWindow(day, subscription),
      pickupLocationId: subscription.pickupLocationId ? String(subscription.pickupLocationId) : null,
    },
    pickup: {
      ...buildPickupPayload({ subscription, day }),
      pickupLocationId: subscription.pickupLocationId ? String(subscription.pickupLocationId) : null,
      pickupRequested: Boolean(day.pickupRequested),
      pickupPreparedAt: day.pickupPreparedAt || null,
      pickupCode: day.pickupCode || null,
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



function mapPickupRequest(pickupRequest, subscription, user, lang, role, catalogMaps = {}) {
  return dashboardDtoService.mapSubscriptionPickupRequestToDTO(
    pickupRequest,
    subscription || {},
    user || null,
    role,
    lang,
    catalogMaps
  );
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

function respondToActionError(res, err) {
  if (err && (err.status || err.code)) {
    return errorResponse(res, err.status || 500, err.code || "INTERNAL", err.message || "Action failed", err.details);
  }
  if (err && err.message === "INVALID_STATE_TRANSITION") {
    return errorResponse(res, 409, "INVALID_TRANSITION", "This transition is not allowed");
  }
  if (err && err.message === "INVALID_PICKUP_CODE") {
    return errorResponse(res, 400, "INVALID_PICKUP_CODE", "The provided pickup code is incorrect");
  }
  throw err;
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
      ? ["locked", "in_preparation", "ready_for_pickup", "fulfilled", "canceled_at_branch", "no_show"]
      : ["open", "locked", "in_preparation", "ready_for_pickup", "out_for_delivery", "delivery_canceled", "canceled_at_branch"];
  const statuses = normalizeStatusList(
    req.query.status,
    isPastDate
      ? Array.from(new Set(defaultStatuses.concat(["consumed_without_preparation", "no_show"])))
      : defaultStatuses
  );

  // Settlement on read intentionally removed — meals are not consumed by date passage.

  const dayQuery = { date, status: { $in: statuses } };
  const days = await SubscriptionDay.find(dayQuery)
    .populate({
      path: "subscriptionId",
      select: "_id userId planId selectedGrams selectedMealsPerDay totalMeals remainingMeals deliveryMode deliveryWindow deliveryAddress deliveryZoneId pickupLocationId startDate addonSubscriptions",
      populate: [
        { path: "userId", select: "_id name phone" },
        { path: "planId", select: "_id key name daysCount durationDays" },
      ],
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  let filteredByMethod = days.filter((day) => {
    const mode = getEffectiveDeliveryMode(day, day.subscriptionId || {});
    if (method === "all") return true;
    return mode === method;
  });
  if (screen === "pickup") {
    filteredByMethod = filteredByMethod.filter((day) => getEffectiveDeliveryMode(day, day.subscriptionId || {}) === "pickup");
  }

  const [latestActionMap, zoneMap, deliveryDocs] = await Promise.all([
    buildLatestActionMap(filteredByMethod.map((day) => day._id)),
    buildZoneMap(filteredByMethod.map((day) => day.subscriptionId || {})),
    Delivery.find({
      $or: [
        { dayId: { $in: filteredByMethod.map((day) => day._id) } },
        {
          subscriptionId: { $in: filteredByMethod.map((day) => day.subscriptionId && day.subscriptionId._id).filter(Boolean) },
          date,
        },
      ],
    }).lean(),
  ]);
  const deliveryByDayMap = new Map(deliveryDocs.filter((delivery) => delivery.dayId).map((delivery) => [String(delivery.dayId), delivery]));
  const deliveryBySubscriptionDateMap = new Map(deliveryDocs
    .filter((delivery) => delivery.subscriptionId && delivery.date)
    .map((delivery) => [`${String(delivery.subscriptionId)}:${delivery.date}`, delivery]));
  let items = [];

  let activeOrderStatuses = [];
  if (req.query.status) {
    const requested = normalizeStatusList(req.query.status, []);
    for (const s of requested) {
      if (s === "open" || s === "locked" || s === "confirmed") activeOrderStatuses.push("confirmed");
      if (s === "in_preparation") activeOrderStatuses.push("in_preparation", "preparing");
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
      activeOrderStatuses = ["confirmed", "in_preparation", "preparing"];
    } else if (screen === "courier") {
      activeOrderStatuses = ["in_preparation", "preparing", "out_for_delivery"];
    } else if (screen === "pickup") {
      activeOrderStatuses = ["in_preparation", "preparing", "ready_for_pickup"];
    } else {
      activeOrderStatuses = ["confirmed", "in_preparation", "preparing", "out_for_delivery", "ready_for_pickup"];
    }
  }

  const orderQuery = {
    fulfillmentDate: date,
    paymentStatus: "paid",
  };
  if (activeOrderStatuses.length > 0) {
    orderQuery.status = { $in: activeOrderStatuses };
  }

  const orders = await Order.find(orderQuery)
    .populate("userId", "_id name phone")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
  const orderDeliveries = await Delivery.find({ orderId: { $in: orders.map((order) => order._id) } }).lean();
  const deliveryByOrderMap = new Map(orderDeliveries.map((delivery) => [String(delivery.orderId), delivery]));

  const filteredOrderItems = orders.filter((order) => {
    const oMode = order.fulfillmentMethod || order.deliveryMode || "delivery";
    if (shouldBlockOneTimeOrderDelivery(order)) return false;
    if (method === "all") return true;
    return oMode === method;
  });

  let orderItems = [];
  let pickupRequestItems = [];
  let pickupRequests = [];
  if (method === "all" || method === "pickup") {
    const defaultPickupRequestStatuses = screen === "pickup" || screen === "kitchen"
      ? ["locked", "in_preparation", "ready_for_pickup", "fulfilled"]
      : ["locked", "in_preparation", "ready_for_pickup"];
    const pickupRequestStatuses = req.query.status
      ? statuses.filter((status) => ["locked", "in_preparation", "ready_for_pickup", "fulfilled", "no_show", "canceled"].includes(status))
      : defaultPickupRequestStatuses;
    pickupRequests = await SubscriptionPickupRequest.find({
      date,
      status: { $in: pickupRequestStatuses.length ? pickupRequestStatuses : defaultPickupRequestStatuses },
    })
      .populate({
        path: "subscriptionId",
        select: "_id userId planId selectedGrams selectedMealsPerDay totalMeals remainingMeals deliveryMode pickupLocationId startDate addonSubscriptions",
        populate: [
          { path: "userId", select: "_id name phone" },
          { path: "planId", select: "_id key name daysCount durationDays" },
        ],
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();
  }

  const catalogMaps = await buildKitchenCatalogMaps([...filteredByMethod, ...filteredOrderItems, ...pickupRequests]);
  items = filteredByMethod.map((day) => mapDay(
    day,
    latestActionMap.get(String(day._id)),
    zoneMap,
    lang,
    role,
    deliveryByDayMap.get(String(day._id))
      || deliveryBySubscriptionDateMap.get(`${String(day.subscriptionId && day.subscriptionId._id || day.subscriptionId)}:${day.date}`)
      || null,
    catalogMaps
  ));
  orderItems = filteredOrderItems.map((order) => {
    return dashboardDtoService.mapOrderToDTO(order, deliveryByOrderMap.get(String(order._id)) || null, order.userId, role, lang, catalogMaps);
  });

  if (method === "all" || method === "pickup") {
    const pickupRequestDayIds = new Set(
      pickupRequests
        .map((pickupRequest) => pickupRequest.subscriptionDayId ? String(pickupRequest.subscriptionDayId) : null)
        .filter(Boolean)
    );
    if (pickupRequestDayIds.size > 0) {
      items = items.filter((item) => item.entityType !== "subscription_day" || !pickupRequestDayIds.has(String(item.entityId)));
    }

    pickupRequestItems = pickupRequests.map((pickupRequest) => {
      const subscription = pickupRequest.subscriptionId || {};
      return mapPickupRequest(
        pickupRequest,
        subscription,
        subscription.userId || null,
        lang,
        role,
        catalogMaps
      );
    });
  }

  items = [...items, ...orderItems, ...pickupRequestItems];

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
  if (screen === "kitchen" && !isTruthyQuery(req.query.includeCanceled) && !req.query.status) {
    items = items.filter((item) => {
      const isCanceled = ["canceled_at_branch", "delivery_canceled", "cancelled", "canceled", "no_show"].includes(String(item.status || ""));
      const mealCount = item.kitchenDetails && Array.isArray(item.kitchenDetails.mealSlots) ? item.kitchenDetails.mealSlots.length : 0;
      const hasIdentity = Boolean((item.customer && item.customer.id) || (item.user && item.user.id) || item.subscriptionId || item.orderId || item.requestId);
      return !(isCanceled && mealCount === 0 && !hasIdentity);
    });
  }

  return { date, businessDate, items, filters: { status: statuses, method, q: q || null, zoneId: req.query.zoneId || null, branchId: req.query.branchId || null } };
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
  if (screen === "kitchen") {
    return res.status(200).json({
      status: true,
      data: serializeKitchenOperationsCollection(data, {
        includeLegacy: isTruthyQuery(req.query.includeLegacy),
        includeRaw: isTruthyQuery(req.query.includeRaw),
      }),
    });
  }
  if (shouldUseCleanQueueContract(screen, req.query)) {
    return res.status(200).json({
      status: true,
      data: normalizeKitchenQueueResponse(data, {
        includeRaw: isTruthyQuery(req.query.includeRaw),
        includeLegacyAliases: isTruthyQuery(req.query.includeLegacyAliases),
        includeCanceled: isTruthyQuery(req.query.includeCanceled) || Boolean(req.query.status),
      }),
    });
  }
  return res.status(200).json({ status: true, data });
}

async function queueDetail(req, res) {
  const existingDay = await SubscriptionDay.findById(req.params.dayId).select("date").lean();
  // Settlement on read intentionally removed — meals are not consumed by date passage.
  const day = await SubscriptionDay.findById(req.params.dayId)
    .populate({
      path: "subscriptionId",
      select: "_id userId planId selectedGrams selectedMealsPerDay totalMeals remainingMeals deliveryMode deliveryWindow deliveryAddress deliveryZoneId pickupLocationId startDate addonSubscriptions",
      populate: [
        { path: "userId", select: "_id name phone" },
        { path: "planId", select: "_id key name daysCount durationDays" },
      ],
    })
    .lean();
  if (!day) {
    const pickupRequest = await SubscriptionPickupRequest.findById(req.params.dayId)
      .populate({
        path: "subscriptionId",
        select: "_id userId planId selectedGrams selectedMealsPerDay totalMeals remainingMeals deliveryMode pickupLocationId startDate addonSubscriptions",
        populate: [
          { path: "userId", select: "_id name phone" },
          { path: "planId", select: "_id key name daysCount durationDays" },
        ],
      })
      .lean();
    if (!pickupRequest) return errorResponse(res, 404, "NOT_FOUND", "Subscription day not found");
    const subscription = pickupRequest.subscriptionId || {};
    const catalogMaps = await buildKitchenCatalogMaps([pickupRequest]);
    const detail = mapPickupRequest(pickupRequest, subscription, subscription.userId || null, getRequestLang(req), req.dashboardUserRole, catalogMaps);
    return res.status(200).json({
      status: true,
      data: shouldUseCleanQueueContract(req.params.screen, req.query)
        ? normalizeKitchenQueueItem(detail, {
          includeRaw: isTruthyQuery(req.query.includeRaw),
          includeLegacyAliases: isTruthyQuery(req.query.includeLegacyAliases),
        })
        : detail,
    });
  }
  const [latestActionMap, zoneMap, catalogMaps, delivery] = await Promise.all([
    buildLatestActionMap([day._id]),
    buildZoneMap([day.subscriptionId || {}]),
    buildKitchenCatalogMaps([day]),
    Delivery.findOne({
      $or: [
        { dayId: day._id },
        {
          subscriptionId: day.subscriptionId && day.subscriptionId._id ? day.subscriptionId._id : day.subscriptionId,
          date: day.date,
        },
      ],
    }).lean(),
  ]);
  const detail = mapDay(day, latestActionMap.get(String(day._id)), zoneMap, getRequestLang(req), req.dashboardUserRole, delivery, catalogMaps);
  return res.status(200).json({
    status: true,
    data: shouldUseCleanQueueContract(req.params.screen, req.query)
      ? normalizeKitchenQueueItem(detail, {
        includeRaw: isTruthyQuery(req.query.includeRaw),
        includeLegacyAliases: isTruthyQuery(req.query.includeLegacyAliases),
      })
      : detail,
  });
}

async function action(req, res) {
  const actionId = opsActionPolicy.normalizeActionId(req.params.action);
  const entityId = req.body && req.body.entityId;
  const payload = { ...((req.body && req.body.payload) ? req.body.payload : {}) };
  if (req.body && req.body.code !== undefined) payload.code = req.body.code;
  if (req.body && req.body.pickupCode !== undefined) payload.pickupCode = req.body.pickupCode;
  if (!entityId) return errorResponse(res, 400, "INVALID_REQUEST", "entityId is required");
  if (req.body && req.body.entityType === undefined && req.body.source !== "one_time_order") {
    return errorResponse(res, 400, "INVALID_REQUEST", "entityType is required");
  }
  if (!mongoose.Types.ObjectId.isValid(entityId)) {
    return errorResponse(res, 400, "INVALID_ENTITY_ID", "Invalid entityId");
  }

  let entityType = "subscription_day";
  if (req.body && (req.body.entityType === "order" || req.body.source === "one_time_order")) {
    entityType = "order";
  } else if (req.body && req.body.entityType === "subscription_pickup_request") {
    entityType = "subscription_pickup_request";
  } else if (req.body && req.body.entityType && !["subscription_day", "pickup_day", "subscription", "order"].includes(req.body.entityType)) {
    return errorResponse(res, 400, "INVALID_ENTITY_TYPE", "Unsupported entityType");
  }

  if (entityType === "order") {
    try {
      const data = await executeDashboardOrderAction({
        orderId: entityId,
        action: actionId,
        actor: { userId: req.dashboardUserId, role: req.dashboardUserRole },
        payload,
      });
      return res.status(200).json({ status: true, data });
    } catch (err) {
      return errorResponse(
        res,
        err.status || 500,
        err.code || "INTERNAL",
        err.message || "Dashboard order action failed",
        err.details
      );
    }
  }

  if (entityType === "subscription_pickup_request") {
    const pickupRequest = await SubscriptionPickupRequest.findById(entityId).lean();
    if (!pickupRequest) return errorResponse(res, 404, "NOT_FOUND", "Pickup request not found");
    const validation = opsActionPolicy.validateAction({
      entityType: "subscription_pickup_request",
      status: pickupRequest.status,
      mode: "pickup",
      role: req.dashboardUserRole,
      actionId,
    });
    if (!validation.allowed) {
      const code = validation.reason === "INVALID_STATE_TRANSITION" ? "INVALID_TRANSITION" : validation.reason;
      return errorResponse(res, 409, code, `Action ${actionId} is not allowed in current state`);
    }

    try {
      await opsTransitionService.executeAction(actionId, {
        entityId,
        entityType: "subscription_pickup_request",
        userId: req.dashboardUserId,
        role: req.dashboardUserRole,
        payload,
      });
    } catch (err) {
      return respondToActionError(res, err);
    }

    req.params.dayId = entityId;
    return queueDetail(req, res);
  }

  const existingDay = await SubscriptionDay.findById(entityId).select("date").lean();
  // Settlement on read intentionally removed — meals are not consumed by date passage.
  const day = await SubscriptionDay.findById(entityId)
    .populate("subscriptionId", "deliveryMode selectedMealsPerDay deliveryWindow deliveryAddress startDate")
    .lean();
  if (!day) return errorResponse(res, 404, "NOT_FOUND", "Subscription day not found");
  const mode = getEffectiveDeliveryMode(day, day.subscriptionId || {});
  if (mode === "pickup" && ["prepare", "start_preparation", "ready_for_pickup", "ready-for-pickup", "fulfill", "no_show"].includes(actionId)) {
    return errorResponse(res, 422, "PICKUP_REQUEST_REQUIRED", "Pickup preparation requires an explicit client request");
  }
  const validation = opsActionPolicy.validateAction({
    entityType: "subscription",
    status: day.status,
    mode,
    role: req.dashboardUserRole,
    actionId,
  });
  if (!validation.allowed) {
    const code = validation.reason === "INVALID_STATE_TRANSITION" ? "INVALID_TRANSITION" : validation.reason;
    return errorResponse(res, 409, code, `Action ${actionId} is not allowed in current state`);
  }

  const gate = validateSubscriptionDayOperationalGate(day, actionId, { subscription: day.subscriptionId || {} });
  if (!gate.allowed) {
    return errorResponse(res, gate.status, gate.code, gate.message);
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
  queryBoardDays,
};

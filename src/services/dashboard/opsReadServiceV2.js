"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const Order = require("../../models/Order");
const Delivery = require("../../models/Delivery");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const dashboardDtoService = require("./dashboardDtoService");
const { buildKitchenCatalogMaps } = require("./kitchenCatalogService");
const { hydrateSubscriptionDayForOps } = require("./subscriptionDayOpsMealSourceService");
const { shouldBlockOneTimeOrderDelivery } = require("../../utils/oneTimeOrderDeliveryGate");
const { enrichCustomerUser, enrichCustomerUsers } = require("./customerDisplayNameService");
const ar = require("../../locales/ar");
const en = require("../../locales/en");

const LOCALES = { ar, en };

function getLocalizedLabel(status, lang) {
  const dict = LOCALES[lang] || ar;
  const statusKey = status === "out_for_delivery" ? "on_the_way" : status;
  return (dict.read && dict.read.dayStatuses && dict.read.dayStatuses[statusKey]) || status;
}

async function listOperations({ date, role, lang = "ar" }) {
  const rawDays = await SubscriptionDay.find({ date }).lean();
  const days = rawDays.map((day) => hydrateSubscriptionDayForOps(day));

  const orders = await Order.find({
    fulfillmentDate: date,
    paymentStatus: "paid",
    status: { $in: ["confirmed", "in_preparation", "preparing", "ready_for_pickup", "out_for_delivery", "fulfilled"] },
  }).lean();
  const pickupRequests = await SubscriptionPickupRequest.find({
    date,
    status: { $in: ["locked", "in_preparation", "ready_for_pickup"] },
  }).lean();
  const pickupRequestDayKeys = new Set(
    pickupRequests
      .filter((request) => request.subscriptionId && request.date)
      .map((request) => `${String(request.subscriptionId)}:${request.date}`)
  );

  const subscriptionIds = [...new Set(days
    .map((day) => day.subscriptionId)
    .concat(pickupRequests.map((request) => request.subscriptionId))
    .filter(Boolean)
    .map(String))];

  const [subscriptions, users, deliveries] = await Promise.all([
    Subscription.find({ _id: { $in: subscriptionIds } })
      .populate("planId", "_id key name daysCount durationDays")
      .lean(),
    Subscription.find({ _id: { $in: subscriptionIds } }).lean().then((subs) => {
      const userIds = [...new Set([
        ...subs.map((subscription) => subscription.userId),
        ...orders.filter((order) => !shouldBlockOneTimeOrderDelivery(order)).map((order) => order.userId),
        ...pickupRequests.map((request) => request.userId),
      ].filter(Boolean).map(String))];
      return User.find({ _id: { $in: userIds } }).lean();
    }),
    Delivery.find({
      $or: [
        { dayId: { $in: days.map((day) => day._id) } },
        { orderId: { $in: orders.filter((order) => !shouldBlockOneTimeOrderDelivery(order)).map((order) => order._id) } },
      ],
    }).lean(),
  ]);

  const enrichedUsers = await enrichCustomerUsers(users);
  const subMap = new Map(subscriptions.map((subscription) => [String(subscription._id), subscription]));
  const userMap = new Map(enrichedUsers.map((user) => [String(user._id), user]));
  const deliveryByDayMap = new Map(deliveries.filter((delivery) => delivery.dayId).map((delivery) => [String(delivery.dayId), delivery]));
  const deliveryByOrderMap = new Map(deliveries.filter((delivery) => delivery.orderId).map((delivery) => [String(delivery.orderId), delivery]));

  const catalogMaps = await buildKitchenCatalogMaps([...days, ...orders, ...pickupRequests]);

  const dayDTOs = days.filter((day) => {
    const subscription = subMap.get(String(day.subscriptionId));
    const effectiveMode = day.fulfillmentModeOverride || (subscription && subscription.deliveryMode === "pickup" ? "pickup" : "delivery");
    return !(effectiveMode === "pickup" && pickupRequestDayKeys.has(`${String(day.subscriptionId)}:${day.date}`));
  }).map((day) => {
    const subscription = subMap.get(String(day.subscriptionId));
    const user = subscription ? userMap.get(String(subscription.userId)) : null;
    const dto = dashboardDtoService.mapSubscriptionDayToDTO(
      day,
      deliveryByDayMap.get(String(day._id)),
      subscription || {},
      user,
      role,
      lang,
      catalogMaps
    );
    dto.ui.label = getLocalizedLabel(day.status, lang);
    dto.statusLabel = dto.ui.label;
    return dto;
  });

  const orderDTOs = orders.filter((order) => !shouldBlockOneTimeOrderDelivery(order)).map((order) => {
    const user = userMap.get(String(order.userId));
    const dto = dashboardDtoService.mapOrderToDTO(
      order,
      deliveryByOrderMap.get(String(order._id)),
      user,
      role,
      lang,
      catalogMaps
    );
    dto.ui.label = getLocalizedLabel(dto.status, lang);
    dto.statusLabel = dto.ui.label;
    return dto;
  });

  const pickupRequestDTOs = pickupRequests.map((pickupRequest) => {
    const subscription = subMap.get(String(pickupRequest.subscriptionId));
    const user = userMap.get(String(pickupRequest.userId));
    const dto = dashboardDtoService.mapSubscriptionPickupRequestToDTO(
      pickupRequest,
      subscription || {},
      user,
      role,
      lang,
      catalogMaps
    );
    dto.ui.label = getLocalizedLabel(pickupRequest.status, lang);
    dto.statusLabel = dto.ui.label;
    return dto;
  });

  return [...dayDTOs, ...orderDTOs, ...pickupRequestDTOs].sort((a, b) => (
    new Date(b.timestamps.createdAt) - new Date(a.timestamps.createdAt)
  ));
}

async function getEnrichedDTO({ entityId, entityType, role, lang = "ar" }) {
  if (entityType === "subscription_pickup_request") {
    const pickupRequest = await SubscriptionPickupRequest.findById(entityId).lean();
    if (!pickupRequest) return null;
    const [subscription, rawUser] = await Promise.all([
      Subscription.findById(pickupRequest.subscriptionId).populate("planId", "_id key name daysCount durationDays").lean(),
      User.findById(pickupRequest.userId).lean(),
    ]);
    const user = await enrichCustomerUser(rawUser);
    const catalogMaps = await buildKitchenCatalogMaps([pickupRequest]);
    const dto = dashboardDtoService.mapSubscriptionPickupRequestToDTO(pickupRequest, subscription || {}, user, role, lang, catalogMaps);
    dto.ui.label = getLocalizedLabel(pickupRequest.status, lang);
    dto.statusLabel = dto.ui.label;
    return dto;
  }

  if (entityType === "subscription") {
    const rawDay = await SubscriptionDay.findById(entityId).lean();
    if (!rawDay) return null;
    const day = hydrateSubscriptionDayForOps(rawDay);

    const [subscription, delivery, pickupRequest] = await Promise.all([
      Subscription.findById(day.subscriptionId).populate("planId", "_id key name daysCount durationDays").lean(),
      Delivery.findOne({ dayId: day._id }).lean(),
      SubscriptionPickupRequest.findOne({
        subscriptionId: day.subscriptionId,
        date: day.date,
        status: { $ne: "canceled" },
      }).lean(),
    ]);

    const rawUser = subscription ? await User.findById(subscription.userId).lean() : null;
    const user = await enrichCustomerUser(rawUser);
    const catalogMaps = await buildKitchenCatalogMaps([day]);
    const dto = dashboardDtoService.mapSubscriptionDayToDTO(day, delivery, subscription || {}, user, role, lang, catalogMaps, pickupRequest);
    dto.ui.label = getLocalizedLabel(day.status, lang);
    dto.statusLabel = dto.ui.label;
    return dto;
  }

  const order = await Order.findById(entityId).lean();
  if (!order) return null;
  const [delivery, rawUser] = await Promise.all([
    Delivery.findOne({ orderId: order._id }).lean(),
    User.findById(order.userId).lean(),
  ]);
  const user = await enrichCustomerUser(rawUser);
  const catalogMaps = await buildKitchenCatalogMaps([order]);
  const dto = dashboardDtoService.mapOrderToDTO(order, delivery, user, role, lang, catalogMaps);
  dto.ui.label = getLocalizedLabel(dto.status, lang);
  dto.statusLabel = dto.ui.label;
  return dto;
}

module.exports = {
  listOperations,
  getEnrichedDTO,
};

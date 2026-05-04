"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Order = require("../../models/Order");
const Delivery = require("../../models/Delivery");
const Subscription = require("../../models/Subscription");
const User = require("../../models/User");
const dashboardDtoService = require("./dashboardDtoService");
const ar = require("../../locales/ar");
const en = require("../../locales/en");
// Settlement on read is DISABLED — see pastSubscriptionDaySettlementService.js

const LOCALES = { ar, en };

function getLocalizedLabel(status, lang) {
  const dict = LOCALES[lang] || ar;
  // Map internal status to locale key
  const statusKey = status === "out_for_delivery" ? "on_the_way" : status;
  return (dict.read && dict.read.dayStatuses && dict.read.dayStatuses[statusKey]) || status;
}

async function listOperations({ date, role, lang = "ar" }) {
  // Settlement on read intentionally removed — meals are not consumed by date passage.
  // 1. Fetch SubscriptionDays for the date
  const days = await SubscriptionDay.find({ date }).lean();
  
  // 2. Fetch One-time Orders for the date
  const orders = await Order.find({ deliveryDate: date, paymentStatus: "paid" }).lean();
  
  // 3. Collect IDs for mass fetching
  const subscriptionIds = [...new Set(days.map(d => d.subscriptionId))];
  
  // 4. Enrich data
  const [subscriptions, users, deliveries] = await Promise.all([
    Subscription.find({ _id: { $in: subscriptionIds } }).lean(),
    Subscription.find({ _id: { $in: subscriptionIds } }).lean().then((subs) => {
      const userIds = [
        ...new Set([
          ...subs.map((subscription) => subscription.userId),
          ...orders.map((order) => order.userId),
        ].filter(Boolean).map(String)),
      ];
      return User.find({ _id: { $in: userIds } }).lean();
    }),
    Delivery.find({ 
      $or: [
        { dayId: { $in: days.map(d => d._id) } },
        { orderId: { $in: orders.map(o => o._id) } }
      ]
    }).lean()
  ]);
  
  const subMap = new Map(subscriptions.map(s => [String(s._id), s]));
  const userMap = new Map(users.map(u => [String(u._id), u]));
  const deliveryByDayMap = new Map(deliveries.filter(d => d.dayId).map(d => [String(d.dayId), d]));
  const deliveryByOrderMap = new Map(deliveries.filter(d => d.orderId).map(d => [String(d.orderId), d]));

  // 5. Map to DTOs
  const dayDTOs = days.map(day => {
    const sub = subMap.get(String(day.subscriptionId));
    const user = sub ? userMap.get(String(sub.userId)) : null;
    const dto = dashboardDtoService.mapSubscriptionDayToDTO(
      day,
      deliveryByDayMap.get(String(day._id)),
      sub || {},
      user,
      role,
      lang
    );
    dto.ui.label = getLocalizedLabel(day.status, lang);
    return dto;
  });

  const orderDTOs = orders.map(order => {
    const user = userMap.get(String(order.userId));
    const dto = dashboardDtoService.mapOrderToDTO(
      order,
      deliveryByOrderMap.get(String(order._id)),
      user,
      role,
      lang
    );
    dto.ui.label = getLocalizedLabel(order.status, lang);
    return dto;
  });

  // 6. Merge and Sort (by createdAt desc for now)
  const all = [...dayDTOs, ...orderDTOs].sort((a, b) => {
    const dateA = new Date(a.timestamps.createdAt);
    const dateB = new Date(b.timestamps.createdAt);
    return dateB - dateA;
  });

  return all;
}

async function getEnrichedDTO({ entityId, entityType, role, lang = "ar" }) {
  if (entityType === "subscription") {
    const existingDay = await SubscriptionDay.findById(entityId).select("date").lean();
    // Settlement on read intentionally removed — meals are not consumed by date passage.
    const day = await SubscriptionDay.findById(entityId).lean();
    if (!day) return null;

    const [sub, delivery] = await Promise.all([
      Subscription.findById(day.subscriptionId).lean(),
      Delivery.findOne({ dayId: day._id }).lean()
    ]);

    const user = sub ? await User.findById(sub.userId).lean() : null;

    const dto = dashboardDtoService.mapSubscriptionDayToDTO(day, delivery, sub || {}, user, role, lang);
    dto.ui.label = getLocalizedLabel(day.status, lang);
    return dto;
  } else {
    const order = await Order.findById(entityId).lean();
    if (!order) return null;

    const [delivery, user] = await Promise.all([
      Delivery.findOne({ orderId: order._id }).lean(),
      User.findById(order.userId).lean()
    ]);

    const dto = dashboardDtoService.mapOrderToDTO(order, delivery, user, role, lang);
    dto.ui.label = getLocalizedLabel(order.status, lang);
    return dto;
  }
}

module.exports = {
  listOperations,
  getEnrichedDTO,
};

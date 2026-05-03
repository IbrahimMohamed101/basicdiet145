"use strict";

const User = require("../../models/User");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Subscription = require("../../models/Subscription");
const Order = require("../../models/Order");
const dashboardDtoService = require("./dashboardDtoService");

/**
 * Fast Operational Search Service.
 * Searches across Users, Subscriptions, and Orders.
 */

async function search({ q, role, lang = "ar" }) {
  const query = String(q || "").trim();
  if (query.length < 3) return [];

  // 1. Search Users by Phone (Exact First) then Name
  const usersByPhone = await User.find({ phone: query }).limit(5).lean();
  let users = usersByPhone;
  
  if (users.length < 10) {
    const extraUsers = await User.find({
      _id: { $nin: usersByPhone.map(u => u._id) },
      name: { $regex: query, $options: "i" }
    }).limit(10).lean();
    users = [...users, ...extraUsers];
  }
  
  const userIds = users.map(u => u._id);
  
  // 2. Fetch Subscriptions for these users + Reference search
  const isReferenceSearch = query.startsWith("SUB-") || query.startsWith("ORD-");
  const referenceId = isReferenceSearch ? query.split("-")[1] : null;

  const orderSearchConditions = [];
  if (isReferenceSearch && query.startsWith("ORD-") && referenceId && referenceId.length >= 6) {
    orderSearchConditions.push({ _id: { $regex: referenceId, $options: "i" } });
  } else {
    orderSearchConditions.push({ orderNumber: { $regex: query, $options: "i" } });
  }

  const [subscriptions, ordersByRef] = await Promise.all([
    Subscription.find({ userId: { $in: userIds } }).lean(),
    Order.find({ $or: orderSearchConditions }).limit(5).lean()
  ]);
  
  const subIds = subscriptions.map(s => s._id);
  
  // 3. Search Orders for users
  const ordersByUser = await Order.find({ 
    userId: { $in: userIds },
    paymentStatus: "paid"
  }).limit(20).lean();

  const allOrders = [...ordersByRef, ...ordersByUser];

  // 4. Search SubscriptionDays (By User Subscriptions or Pickup Code)
  const days = await SubscriptionDay.find({
    $or: [
      { subscriptionId: { $in: subIds } },
      { pickupCode: query }
    ]
  })
  .sort({ date: -1 })
  .limit(30)
  .lean();

  // 5. Build DTOs
  const userMap = new Map(users.map(u => [String(u._id), u]));
  const subMap = new Map(subscriptions.map(s => [String(s._id), s]));

  // Deduping by ID to avoid duplicates if multiple match criteria hit
  const seenIds = new Set();
  const results = [];

  for (const day of days) {
    if (seenIds.has(String(day._id))) continue;
    const sub = subMap.get(String(day.subscriptionId));
    const user = sub ? userMap.get(String(sub.userId)) : null;
    results.push(dashboardDtoService.mapSubscriptionDayToDTO(day, null, sub || {}, user, role, lang));
    seenIds.add(String(day._id));
  }

  for (const order of allOrders) {
    if (seenIds.has(String(order._id))) continue;
    const user = userMap.get(String(order.userId));
    results.push(dashboardDtoService.mapOrderToDTO(order, null, user, role, lang));
    seenIds.add(String(order._id));
  }

  return results.slice(0, 50);
}

module.exports = {
  search,
};

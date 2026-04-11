"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Order = require("../../models/Order");
const Meal = require("../../models/Meal");
const Addon = require("../../models/Addon");

function attachSession(query, session) {
  return session ? query.session(session) : query;
}

async function fetchSubscriptionDaysByDate(date, { session } = {}) {
  let query = SubscriptionDay.find({
    date: String(date),
    status: { $nin: ["skipped", "frozen"] },
  })
    .select([
      "_id",
      "subscriptionId",
      "date",
      "status",
      "selections",
      "premiumSelections",
      "recurringAddons",
      "oneTimeAddonSelections",
      "addonsOneTime",
      "assignedByKitchen",
      "pickupRequested",
      "pickupCode",
      "pickupVerifiedAt",
      "pickupNoShowAt",
      "creditsDeducted",
      "deliveryWindowOverride",
      "customSalads",
      "customMeals",
      "lockedSnapshot",
      "fulfilledSnapshot",
      "lockedAt",
      "fulfilledAt",
      "createdAt",
    ].join(" "))
    .populate({
      path: "subscriptionId",
      select: "_id userId deliveryMode deliveryWindow pickupLocationId deliveryAddress",
      populate: {
        path: "userId",
        select: "_id name phone",
      },
    });

  query = attachSession(query, session);
  return query.lean();
}

async function fetchOrdersByDate(date, { session } = {}) {
  let query = Order.find({ deliveryDate: String(date) })
    .select([
      "_id",
      "userId",
      "status",
      "deliveryMode",
      "deliveryDate",
      "deliveryWindow",
      "items",
      "customSalads",
      "customMeals",
      "createdAt",
      "confirmedAt",
      "fulfilledAt",
    ].join(" "))
    .populate({
      path: "userId",
      select: "_id name phone",
    });

  query = attachSession(query, session);
  return query.lean();
}

async function fetchMealNameMap(mealIds, { session } = {}) {
  const ids = Array.from(new Set((Array.isArray(mealIds) ? mealIds : []).filter(Boolean).map(String)));
  if (ids.length === 0) return new Map();

  let query = Meal.find({ _id: { $in: ids } }).select("_id name");
  query = attachSession(query, session);
  const meals = await query.lean();

  return new Map(meals.map((meal) => [String(meal._id), meal.name]));
}

async function fetchAddonNameMap(addonIds, { session } = {}) {
  const ids = Array.from(new Set((Array.isArray(addonIds) ? addonIds : []).filter(Boolean).map(String)));
  if (ids.length === 0) return new Map();

  let query = Addon.find({ _id: { $in: ids } }).select("_id name");
  query = attachSession(query, session);
  const addons = await query.lean();

  return new Map(addons.map((addon) => [String(addon._id), addon.name]));
}

function collectSubscriptionDayMealIds(days) {
  const ids = [];
  (Array.isArray(days) ? days : []).forEach((day) => {
    const planning = day.lockedSnapshot && day.lockedSnapshot.planning
      ? day.lockedSnapshot.planning
      : (day.fulfilledSnapshot && day.fulfilledSnapshot.planning ? day.fulfilledSnapshot.planning : null);

    if (planning && Array.isArray(planning.baseMealSlots)) {
      planning.baseMealSlots.forEach((slot) => {
        if (slot && slot.mealId) ids.push(String(slot.mealId));
      });
    }

    (Array.isArray(day.selections) ? day.selections : []).forEach((mealId) => ids.push(String(mealId)));
    (Array.isArray(day.premiumSelections) ? day.premiumSelections : []).forEach((mealId) => ids.push(String(mealId)));
  });

  return ids;
}

function collectOrderMealIds(orders) {
  const ids = [];
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    (Array.isArray(order.items) ? order.items : []).forEach((item) => {
      if (item && item.mealId) ids.push(String(item.mealId));
    });
  });
  return ids;
}

function collectSubscriptionDayAddonIds(days) {
  const ids = [];
  (Array.isArray(days) ? days : []).forEach((day) => {
    const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
    const recurringAddons = snapshot && Array.isArray(snapshot.recurringAddons)
      ? snapshot.recurringAddons
      : (Array.isArray(day.recurringAddons) ? day.recurringAddons : []);
    recurringAddons.forEach((addon) => {
      if (addon && addon.addonId) ids.push(String(addon.addonId));
    });

    const subscriptionAddons = snapshot && Array.isArray(snapshot.subscriptionAddons)
      ? snapshot.subscriptionAddons
      : [];
    subscriptionAddons.forEach((addon) => {
      if (addon && addon.addonId) ids.push(String(addon.addonId));
    });

    const oneTimeAddons = snapshot && Array.isArray(snapshot.oneTimeAddonSelections)
      ? snapshot.oneTimeAddonSelections
      : (Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : []);
    oneTimeAddons.forEach((addon) => {
      if (addon && addon.addonId) ids.push(String(addon.addonId));
    });

    const addonIds = snapshot && Array.isArray(snapshot.addonsOneTime)
      ? snapshot.addonsOneTime
      : (Array.isArray(day.addonsOneTime) ? day.addonsOneTime : []);
    addonIds.forEach((addonId) => {
      if (addonId) ids.push(String(addonId));
    });
  });
  return ids;
}

module.exports = {
  fetchSubscriptionDaysByDate,
  fetchOrdersByDate,
  fetchMealNameMap,
  fetchAddonNameMap,
  collectSubscriptionDayMealIds,
  collectOrderMealIds,
  collectSubscriptionDayAddonIds,
};

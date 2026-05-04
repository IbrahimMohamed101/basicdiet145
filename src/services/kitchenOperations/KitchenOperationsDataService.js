"use strict";

const SubscriptionDay = require("../../models/SubscriptionDay");
const Order = require("../../models/Order");
const Addon = require("../../models/Addon");
const BuilderProtein = require("../../models/BuilderProtein");
const BuilderCarb = require("../../models/BuilderCarb");
const Meal = require("../../models/Meal");
// Settlement on read is DISABLED — see pastSubscriptionDaySettlementService.js

function attachSession(query, session) {
  return session ? query.session(session) : query;
}

async function fetchSubscriptionDaysByDate(date, { session } = {}) {
  let query = SubscriptionDay.find({ date: String(date), status: { $nin: ["skipped", "frozen"] } })
    .select(["_id","subscriptionId","date","status","materializedMeals","mealSlots","plannerMeta","planningMeta","selections","recurringAddons","oneTimeAddonSelections","addonsOneTime","assignedByKitchen","pickupRequested","pickupRequestedAt","pickupPreparationStartedAt","pickupPreparedAt","pickupCode","pickupVerifiedAt","pickupNoShowAt","creditsDeducted","dayEndConsumptionReason","deliveryWindowOverride","customSalads","customMeals","lockedSnapshot","fulfilledSnapshot","lockedAt","fulfilledAt","createdAt"].join(" "))
    .populate({ path: "subscriptionId", select: "_id userId deliveryMode deliveryWindow pickupLocationId deliveryAddress", populate: { path: "userId", select: "_id name phone" } });
  query = attachSession(query, session);
  return query.lean();
}

async function fetchOrdersByDate(date, { session } = {}) {
  let query = Order.find({ deliveryDate: String(date) })
    .select(["_id","userId","status","deliveryMode","deliveryDate","deliveryWindow","items","customSalads","customMeals","createdAt","confirmedAt","fulfilledAt"].join(" "))
    .populate({ path: "userId", select: "_id name phone" });
  query = attachSession(query, session);
  return query.lean();
}

async function fetchMealNameMap(mealKeys, { session } = {}) {
  const keys = Array.from(new Set((Array.isArray(mealKeys) ? mealKeys : []).filter(Boolean).map(String)));
  if (!keys.length) return new Map();

  const proteinIds = [];
  const carbIds = [];
  const sandwichIds = [];
  for (const key of keys) {
    if (key.startsWith("sandwich:")) {
      sandwichIds.push(String(key.split(":")[1] || ""));
      continue;
    }
    if (key.startsWith("salad:")) {
      continue;
    }
    const [proteinId, carbId] = String(key).split(":");
    if (proteinId) proteinIds.push(proteinId);
    if (carbId) carbIds.push(carbId);
  }

  let proteinQuery = BuilderProtein.find({ _id: { $in: proteinIds } }).select("_id name");
  let carbQuery = BuilderCarb.find({ _id: { $in: carbIds } }).select("_id name");
  let sandwichQuery = Meal.find({ _id: { $in: sandwichIds } }).select("_id name");
  proteinQuery = attachSession(proteinQuery, session);
  carbQuery = attachSession(carbQuery, session);
  sandwichQuery = attachSession(sandwichQuery, session);
  const [proteins, carbs, sandwiches] = await Promise.all([proteinQuery.lean(), carbQuery.lean(), sandwichQuery.lean()]);
  const proteinMap = new Map(proteins.map((item) => [String(item._id), item.name]));
  const carbMap = new Map(carbs.map((item) => [String(item._id), item.name]));
  const sandwichMap = new Map(sandwiches.map((item) => [String(item._id), item.name]));

  return new Map(keys.map((key) => {
    if (String(key).startsWith("sandwich:")) {
      const sandwichId = String(key).split(":")[1] || "";
      const sandwichName = sandwichMap.get(String(sandwichId));
      const name = sandwichName && (sandwichName.ar || sandwichName.en || "");
      return [key, name || key];
    }
    if (String(key).startsWith("salad:")) {
      return [key, "Premium Large Salad"];
    }
    const [proteinId, carbId] = String(key).split(":");
    const proteinName = proteinMap.get(proteinId);
    const carbName = carbMap.get(carbId);
    const name = [proteinName && (proteinName.ar || proteinName.en || ""), carbName && (carbName.ar || carbName.en || "")].filter(Boolean).join(" / ");
    return [key, name || key];
  }));
}

async function fetchAddonNameMap(addonIds, { session } = {}) {
  const ids = Array.from(new Set((Array.isArray(addonIds) ? addonIds : []).filter(Boolean).map(String)));
  if (!ids.length) return new Map();
  let query = Addon.find({ _id: { $in: ids } }).select("_id name");
  query = attachSession(query, session);
  const addons = await query.lean();
  return new Map(addons.map((addon) => [String(addon._id), addon.name]));
}

function collectSubscriptionDayMealIds(days) {
  const ids = [];
  (Array.isArray(days) ? days : []).forEach((day) => {
    const snapshot = day.lockedSnapshot || day.fulfilledSnapshot || null;
    const materializedMeals = snapshot && Array.isArray(snapshot.materializedMeals) ? snapshot.materializedMeals : (Array.isArray(day.materializedMeals) ? day.materializedMeals : []);
    materializedMeals.forEach((item) => {
      if (!item) return;
      if (item.operationalSku) {
        ids.push(String(item.operationalSku));
        return;
      }
      if (item.proteinId && item.carbId) ids.push(`${item.proteinId}:${item.carbId}`);
      else if (item.sandwichId) ids.push(`sandwich:${item.sandwichId}`);
      else if (item.selectionType === "premium_large_salad") ids.push("salad:custom_premium_salad");
    });
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
    const recurringAddons = snapshot && Array.isArray(snapshot.recurringAddons) ? snapshot.recurringAddons : (Array.isArray(day.recurringAddons) ? day.recurringAddons : []);
    recurringAddons.forEach((addon) => { if (addon && addon.addonId) ids.push(String(addon.addonId)); });
    const subscriptionAddons = snapshot && Array.isArray(snapshot.subscriptionAddons) ? snapshot.subscriptionAddons : [];
    subscriptionAddons.forEach((addon) => { if (addon && addon.addonId) ids.push(String(addon.addonId)); });
    const oneTimeAddons = snapshot && Array.isArray(snapshot.oneTimeAddonSelections) ? snapshot.oneTimeAddonSelections : (Array.isArray(day.oneTimeAddonSelections) ? day.oneTimeAddonSelections : []);
    oneTimeAddons.forEach((addon) => { if (addon && addon.addonId) ids.push(String(addon.addonId)); });
    const addonIds = snapshot && Array.isArray(snapshot.addonsOneTime) ? snapshot.addonsOneTime : (Array.isArray(day.addonsOneTime) ? day.addonsOneTime : []);
    addonIds.forEach((addonId) => { if (addonId) ids.push(String(addonId)); });
  });
  return ids;
}

module.exports = { fetchSubscriptionDaysByDate, fetchOrdersByDate, fetchMealNameMap, fetchAddonNameMap, collectSubscriptionDayMealIds, collectOrderMealIds, collectSubscriptionDayAddonIds };

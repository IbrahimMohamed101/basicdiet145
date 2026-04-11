"use strict";

const { isValidKSADateString } = require("../../utils/date");
const {
  fetchSubscriptionDaysByDate,
  fetchOrdersByDate,
  fetchMealNameMap,
  fetchAddonNameMap,
  collectSubscriptionDayMealIds,
  collectOrderMealIds,
  collectSubscriptionDayAddonIds,
} = require("./KitchenOperationsDataService");
const { mapSubscriptionDayToRow, mapOrderToRow } = require("./KitchenOperationsMapper");

function countBy(rows, predicate) {
  return rows.reduce((count, row) => count + (predicate(row) ? 1 : 0), 0);
}

function matchesBranch(row, branchId) {
  if (!branchId) return true;
  return row.branchId === branchId;
}

async function getKitchenOperationsSummary(rawQuery = {}, options = {}) {
  const date = String(rawQuery.date || "").trim();
  const branchId = rawQuery.branchId ? String(rawQuery.branchId).trim() : null;

  if (!date || !isValidKSADateString(date)) {
    const err = new Error("Invalid date");
    err.status = 400;
    err.code = "INVALID_DATE";
    throw err;
  }

  const runtime = {
    fetchSubscriptionDaysByDate,
    fetchOrdersByDate,
    fetchMealNameMap,
    fetchAddonNameMap,
    ...(options.runtime || {}),
  };

  const [subscriptionDays, orders] = await Promise.all([
    runtime.fetchSubscriptionDaysByDate(date),
    runtime.fetchOrdersByDate(date),
  ]);

  const mealIds = collectSubscriptionDayMealIds(subscriptionDays).concat(collectOrderMealIds(orders));
  const addonIds = collectSubscriptionDayAddonIds(subscriptionDays);
  const [mealNameById, addonNameById] = await Promise.all([
    runtime.fetchMealNameMap(mealIds),
    runtime.fetchAddonNameMap(addonIds),
  ]);

  const context = { mealNameById, addonNameById };
  const subscriptionRows = subscriptionDays
    .map((day) => mapSubscriptionDayToRow(day, context))
    .filter((row) => matchesBranch(row, branchId));
  const branchPickupRows = subscriptionDays
    .map((day) => mapSubscriptionDayToRow(day, context, { entityType: "pickup_day" }))
    .filter((row) => row.mode === "pickup")
    .filter((row) => matchesBranch(row, branchId));
  const orderRows = orders.map((order) => mapOrderToRow(order, context));

  return {
    date,
    summary: {
      subscriptionsToday: subscriptionRows.length,
      lockedDays: countBy(subscriptionRows, (row) => row.rawStatus === "locked"),
      inPreparation: countBy(subscriptionRows.concat(orderRows), (row) => row.status === "in_preparation"),
      readyForPickup: countBy(subscriptionRows.concat(orderRows), (row) => row.status === "ready_for_pickup"),
      outForDelivery: countBy(subscriptionRows.concat(orderRows), (row) => row.status === "out_for_delivery"),
      individualOrders: orderRows.length,
      receivedToday: countBy(orderRows, (row) => row.status === "received"),
      notPrepared: countBy(subscriptionRows.concat(orderRows), (row) => row.status === "not_prepared"),
    },
    tabs: {
      subscriptionsDaily: subscriptionRows.length,
      individualOrders: orderRows.length,
      branchPickup: branchPickupRows.length,
    },
    subscriptionFilters: {
      all: subscriptionRows.length,
      delivery: countBy(subscriptionRows, (row) => row.mode === "delivery"),
      pickup: countBy(subscriptionRows, (row) => row.mode === "pickup"),
      received: countBy(subscriptionRows, (row) => row.status === "received"),
      open: countBy(subscriptionRows, (row) => row.status === "open"),
      locked: countBy(subscriptionRows, (row) => row.status === "locked"),
      in_preparation: countBy(subscriptionRows, (row) => row.status === "in_preparation"),
      ready_for_pickup: countBy(subscriptionRows, (row) => row.status === "ready_for_pickup"),
      out_for_delivery: countBy(subscriptionRows, (row) => row.status === "out_for_delivery"),
      not_prepared: countBy(subscriptionRows, (row) => row.status === "not_prepared"),
    },
  };
}

module.exports = {
  getKitchenOperationsSummary,
};

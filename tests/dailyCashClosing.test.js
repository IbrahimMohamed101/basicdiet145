"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateClosing, paymentMethod } = require("../src/services/dashboard/dailyCashClosingService");
const { dashboardRoleHasPermission } = require("../src/constants/dashboardRoles");

test("restaurant and cashier may submit but not approve, admin may approve", () => {
  assert.equal(dashboardRoleHasPermission("restaurant", ["cashier", "restaurant", "admin"]), true);
  assert.equal(dashboardRoleHasPermission("cashier", ["cashier", "restaurant", "admin"]), true);
  assert.equal(dashboardRoleHasPermission("restaurant", ["admin"]), false);
  assert.equal(dashboardRoleHasPermission("cashier", ["admin"]), false);
  assert.equal(dashboardRoleHasPermission("admin", ["admin"]), true);
  assert.equal(dashboardRoleHasPermission("kitchen", ["cashier", "restaurant", "admin"]), false);
});

test("source and payment method classification prioritizes actual Moyasar records", () => {
  assert.equal(paymentMethod({ provider: "moyasar", method: "visa" }), "moyasar");
  assert.equal(paymentMethod({ provider: "cash" }), "cash");
  assert.equal(paymentMethod({ provider: "manual", source: "dashboard_subscription_visa", method: "visa" }), "card");
  assert.equal(paymentMethod({ provider: "manual", source: "dashboard_subscription_cash", method: "cash" }), "cash");
  assert.equal(paymentMethod({ provider: "manual" }), "unknown");
});

test("cash/card including offline subscriptions are not added to sales twice", () => {
  const channels = { restaurantHalala: 125000, hungerstationHalala: 83000, keetaHalala: 54000, other: [] };
  const collections = { cashHalala: 120000, cardHalala: 130000 };
  const automatic = { count: 4, amountHalala: 150000, cashHalala: 45000, cardHalala: 80000, moyasarHalala: 25000, unknownHalala: 0 };
  const actual = calculateClosing(channels, collections, automatic, 3);
  assert.equal(actual.totalSalesHalala, 412000);
  assert.equal(actual.appReceivablesHalala, 137000);
  assert.equal(actual.localExpectedHalala, 250000);
  assert.equal(actual.localRecordedHalala, 250000);
  assert.equal(actual.recordedPlusReceivablesHalala, 412000);
  assert.equal(actual.overallDifferenceHalala, 0);
  assert.equal(actual.subscriptionCountDifference, -1);
});

test("additional channels and payment shortfalls surface a signed difference", () => {
  const actual = calculateClosing(
    { restaurantHalala: 10000, hungerstationHalala: 20000, keetaHalala: 10000, other: [{ name: "Other", amountHalala: 7000 }] },
    { cashHalala: 4000, cardHalala: 3000 },
    { count: 0, amountHalala: 0, cashHalala: 0, cardHalala: 0, moyasarHalala: 0, unknownHalala: 0 },
    null
  );
  assert.equal(actual.totalSalesHalala, 47000);
  assert.equal(actual.overallDifferenceHalala, -3000);
  assert.equal(actual.localDifferenceHalala, -3000);
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculateClosing, paymentMethod, buildPaidSubscriptionSummary } = require("../src/services/dashboard/dailyCashClosingService");
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

test("two successful payments do not imply two different subscriptions", () => {
  const p = [
    { _id: "paid-1", subscriptionId: "sub-1", type: "subscription_activation", status: "paid", amount: 311330, provider: "moyasar", paidAt: new Date() },
    { _id: "paid-2", subscriptionId: "sub-1", type: "subscription_activation", status: "paid", amount: 14790, provider: "moyasar", paidAt: new Date() },
  ];
  const summary = buildPaidSubscriptionSummary(p, [{ _id: "sub-1", status: "active" }]);
  assert.equal(summary.paymentCount, 2);
  assert.equal(summary.count, 1);
  assert.equal(summary.amountHalala, 326120);
  assert.equal(summary.moyasarHalala, 326120);
  assert.equal(summary.reviewPaymentsCount, 1);
  assert.match(summary.rows[1].reviewReasons.join(" "), /تفعيلان/);
});

test("renewal is not counted as a newly activated subscription", () => {
  const p = [
    { _id: "paid-3", subscriptionId: "sub-old", type: "subscription_renewal", status: "paid", amount: 20000, provider: "manual", method: "visa", paidAt: new Date() },
    { _id: "paid-4", subscriptionId: "sub-new", type: "subscription_activation", status: "paid", amount: 40000, provider: "cash", paidAt: new Date() },
  ];
  const summary = buildPaidSubscriptionSummary(p, [{ _id: "sub-old", status: "active" }, { _id: "sub-new", status: "active" }]);
  assert.equal(summary.paymentCount, 2);
  assert.equal(summary.count, 1);
  assert.equal(summary.renewalPaymentsCount, 1);
  assert.equal(summary.cardHalala, 20000);
  assert.equal(summary.cashHalala, 40000);
});

test("unlinked payment stays in cash reconciliation, but never creates phantom subscription", () => {
  const summary = buildPaidSubscriptionSummary([
    { _id: "orphan", subscriptionId: "deleted", type: "subscription_activation", status: "paid", amount: 14790, provider: "moyasar", paidAt: new Date() }
  ], []);
  assert.equal(summary.count, 0);
  assert.equal(summary.paymentCount, 1);
  assert.equal(summary.amountHalala, 14790);
  assert.equal(summary.orphanPaymentsCount, 1);
  assert.equal(summary.reviewPaymentsCount, 1);
});

test("cash closing shows accounting net without silently mutating gross bank reconciliation", () => {
  const summary = calculateClosing(
    { restaurantHalala: 10000, hungerstationHalala: 0, keetaHalala: 0, other: [] },
    { cashHalala: 10000, cardHalala: 5000 },
    { count: 1, amountHalala: 5000, cashHalala: 0, cardHalala: 5000, moyasarHalala: 0, unknownHalala: 0, refundsHalala: 2000 }, 1
  );
  assert.equal(summary.totalSalesHalala, 15000);
  assert.equal(summary.accountingRefundsHalala, 2000);
  assert.equal(summary.accountingNetSalesHalala, 13000);
  assert.equal(summary.overallDifferenceHalala, 0);
});

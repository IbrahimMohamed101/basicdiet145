"use strict";

const assert = require("assert");
const {
  MAX_RANGE_DAYS,
  buildComparison,
  metricComparison,
  normalizeFilters,
  rangeDaysInclusive,
  resolvePreviousRange,
  resolveRange,
  shiftDateString,
} = require("../src/services/dashboard/marketingAnalyticsService");

assert.strictEqual(rangeDaysInclusive("2026-10-01", "2026-10-07"), 7);
assert.strictEqual(shiftDateString("2026-10-01", -1), "2026-09-30");

const range = resolveRange("2026-10-01", "2026-10-07");
assert.strictEqual(range.days, 7);
assert.strictEqual(range.from, "2026-10-01");
assert.strictEqual(range.to, "2026-10-07");

const previous = resolvePreviousRange(range);
assert.deepStrictEqual(
  { from: previous.from, to: previous.to, days: previous.days },
  { from: "2026-09-24", to: "2026-09-30", days: 7 }
);

assert.deepStrictEqual(metricComparison(150, 100), {
  current: 150,
  previous: 100,
  delta: 50,
  changePercent: 50,
  trend: "positive",
});

const comparison = buildComparison(
  {
    registrations: 10,
    loggedInUsers: 8,
    checkoutStarted: 7,
    checkoutUsers: 6,
    paidTransactions: 5,
    paidCustomers: 4,
    firstTimeSubscribers: 3,
    repeatSubscribers: 1,
    cancellations: 1,
    appRevenueHalala: 100000,
    totalSubscriptionRevenueHalala: 120000,
    aovHalala: 20000,
  },
  {
    registrations: 5,
    loggedInUsers: 4,
    checkoutStarted: 3,
    checkoutUsers: 3,
    paidTransactions: 2,
    paidCustomers: 2,
    firstTimeSubscribers: 1,
    repeatSubscribers: 1,
    cancellations: 0,
    appRevenueHalala: 40000,
    totalSubscriptionRevenueHalala: 50000,
    aovHalala: 20000,
  },
  previous
);
assert.strictEqual(comparison.metrics.registrations.delta, 5);
assert.strictEqual(comparison.metrics.appRevenueHalala.changePercent, 150);

assert.deepStrictEqual(
  normalizeFilters({
    promoCode: " ksa96 ",
    fulfillmentMethod: "pickup",
    paymentProvider: "moyasar",
    daysCount: "26",
    grams: "150",
    mealsPerDay: "2",
  }),
  {
    promoCode: "KSA96",
    fulfillmentMethod: "pickup",
    paymentProvider: "moyasar",
    daysCount: 26,
    grams: 150,
    mealsPerDay: 2,
  }
);

assert.throws(
  () => resolveRange("2026-10-07", "2026-10-01"),
  /from must be on or before to/
);
assert.throws(
  () => resolveRange("2025-01-01", "2026-10-07"),
  (err) => err && err.code === "DATE_RANGE_TOO_LARGE" && MAX_RANGE_DAYS === 366
);

console.log("marketingAnalyticsService.test.js: PASS");

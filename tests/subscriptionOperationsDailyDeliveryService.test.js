"use strict";

const assert = require("node:assert/strict");
const {
  buildDailyDeliveryRow,
  classifyDailyDeliveryRow,
  summarizeDailyDeliveryRows,
} = require("../src/services/dashboard/subscriptionOperationsDailyDeliveryService");

function baseSubscription(overrides = {}) {
  return {
    subscriptionId: "66aaaaaaaaaaaaaaaaaaaaaa",
    customer: { name: "عميل تجريبي", phone: "966500000000" },
    plan: { name: "خطة", mealsPerDay: 2 },
    source: { code: "app", labelAr: "من التطبيق" },
    fulfillmentMethod: "delivery",
    status: "active",
    startDate: "2026-08-02",
    endDate: "2026-08-30",
    ...overrides,
  };
}

function baseDay(overrides = {}) {
  return {
    date: "2026-08-02",
    expectedMeals: 2,
    selectedMeals: 2,
    nonConsuming: false,
    risk: "ok",
    day: { id: "66bbbbbbbbbbbbbbbbbbbbbb", status: "open" },
    delivery: { status: "scheduled", deliveredAt: null, canceledAt: null },
    allocation: { reserved: 2, consumed: 0, released: 0, forfeited: 0 },
    manualDeduction: { totalMeals: 0, records: [] },
    issues: [],
    ...overrides,
  };
}

function buildRow({ subscription, day, evidence } = {}) {
  return buildDailyDeliveryRow({
    subscription: subscription || baseSubscription(),
    day: day || baseDay(),
    dayEvidence: evidence || {},
    logs: [],
    usersById: new Map(),
  });
}

function run() {
  const firstDayPickup = buildRow({
    evidence: { fulfillmentModeOverride: "pickup" },
  });
  assert.equal(firstDayPickup.effectiveFulfillmentMethod, "pickup");
  assert.equal(firstDayPickup.firstDayPickupOverride, true);
  assert.equal(firstDayPickup.deliveryExpected, false);
  assert.equal(firstDayPickup.result.code, "FIRST_DAY_PICKUP_EXCLUDED");

  const deliveredBalanced = buildRow({
    subscription: baseSubscription({ startDate: "2026-08-01" }),
    day: baseDay({
      delivery: { status: "delivered", deliveredAt: new Date(), canceledAt: null },
      day: { id: "66bbbbbbbbbbbbbbbbbbbbbb", status: "fulfilled" },
      allocation: { reserved: 0, consumed: 2, released: 0, forfeited: 0 },
    }),
  });
  assert.equal(deliveredBalanced.deliveryExpected, true);
  assert.equal(deliveredBalanced.dashboardDelivered, true);
  assert.equal(deliveredBalanced.expectedConsumedMeals, 2);
  assert.equal(deliveredBalanced.observedConsumedMeals, 2);
  assert.equal(deliveredBalanced.consumptionDifference, 0);
  assert.equal(deliveredBalanced.result.code, "DELIVERED_BALANCED");
  assert.equal(deliveredBalanced.risk, "ok");

  const doubleDeduction = classifyDailyDeliveryRow({
    deliveryExpected: true,
    firstDayPickupOverride: false,
    dashboardDelivered: true,
    automaticConsumedMeals: 2,
    manualDeductedMeals: 2,
    reservedMeals: 0,
    observedConsumedMeals: 4,
    expectedConsumedMeals: 2,
    consumptionDifference: 2,
    forfeitedMeals: 0,
    deliveryStatus: "delivered",
  });
  assert.equal(doubleDeduction.code, "DOUBLE_DEDUCTION_SUSPECTED");
  assert.equal(doubleDeduction.severity, "critical");

  const deductedWithoutDelivery = buildRow({
    subscription: baseSubscription({ startDate: "2026-08-01" }),
    day: baseDay({
      delivery: { status: "out_for_delivery", deliveredAt: null, canceledAt: null },
      allocation: { reserved: 0, consumed: 2, released: 0, forfeited: 0 },
    }),
  });
  assert.equal(deductedWithoutDelivery.result.code, "DEDUCTED_WITHOUT_DASHBOARD_DELIVERY");
  assert.equal(deductedWithoutDelivery.risk, "critical");

  const deliveredStillReserved = buildRow({
    subscription: baseSubscription({ startDate: "2026-08-01" }),
    day: baseDay({
      delivery: { status: "delivered", deliveredAt: new Date(), canceledAt: null },
      allocation: { reserved: 2, consumed: 0, released: 0, forfeited: 0 },
    }),
  });
  assert.equal(deliveredStillReserved.result.code, "DELIVERED_STILL_RESERVED");

  const pending = buildRow({
    subscription: baseSubscription({ startDate: "2026-08-01" }),
  });
  const summary = summarizeDailyDeliveryRows([
    firstDayPickup,
    deliveredBalanced,
    pending,
    deductedWithoutDelivery,
  ], "2026-08-02");
  assert.equal(summary.expectedCustomers, 3);
  assert.equal(summary.deliveredCustomers, 1);
  assert.equal(summary.notDeliveredCustomers, 2);
  assert.equal(summary.excludedFirstDayPickupCustomers, 1);
  assert.equal(summary.deliveryStatusCounts.delivered, 1);
  assert.equal(summary.deliveryStatusCounts.scheduled, 1);
  assert.equal(summary.deliveryStatusCounts.out_for_delivery, 1);
  assert.equal(summary.meals.expectedConsumedAfterDelivered, 2);
  assert.equal(summary.meals.automaticConsumed, 4);
  assert.equal(summary.meals.consumptionDifference, 2);
  assert.equal(summary.resultCounts.DEDUCTED_WITHOUT_DASHBOARD_DELIVERY, 1);

  console.log("subscriptionOperationsDailyDeliveryService tests passed");
}

run();

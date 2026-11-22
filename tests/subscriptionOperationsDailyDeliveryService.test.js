"use strict";

const assert = require("node:assert/strict");
const { mock } = require("node:test");
const {
  buildDailyDeliveryRow,
  buildSubscriptionOperationsAuditWithDailyDelivery,
  classifyDailyDeliveryRow,
  summarizeDailyDeliveryRows,
} = require("../src/services/dashboard/subscriptionOperationsDailyDeliveryService");
const ActivityLog = require("../src/models/ActivityLog");
const Delivery = require("../src/models/Delivery");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionAuditLog = require("../src/models/SubscriptionAuditLog");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementAllocation = require("../src/models/SubscriptionEntitlementAllocation");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");

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

async function testReportDeductionEvidence() {
  const firstDate = "2026-11-21";
  const secondDate = "2026-11-22";
  const subscriptions = ["legacy", "stacked", "journaled", "missing", "staff"].map((_kind, index) => ({
    _id: String(index + 1).padStart(24, "0"),
    deliveryMode: index === 1 ? "pickup" : "delivery",
    status: "active",
    startDate: new Date(firstDate),
    endDate: new Date(secondDate),
    selectedMealsPerDay: index === 2 ? 3 : 2,
  }));
  const days = subscriptions.map((subscription, index) => ({
    _id: String(index + 11).padStart(24, "0"),
    subscriptionId: subscription._id,
    date: index === 0 ? firstDate : secondDate,
    status: "fulfilled",
    creditsDeducted: index !== 3,
    fulfilledSnapshot: { deductedCredits: subscription.selectedMealsPerDay },
    ...(index === 1 ? { fulfillmentModeOverride: "delivery" } : {}),
  }));
  const deliveries = days.map((day) => ({
    subscriptionId: day.subscriptionId,
    dayId: day._id,
    date: day.date,
    status: "delivered",
  }));
  const alloc = (allocationKey, state = "consumed") => ({ allocationKey, state, quantity: 1 });
  subscriptions[1].baseMealAllocations = [{ ...alloc("mirrored-key"), date: secondDate }];
  subscriptions[4].baseMealAllocations = [{ ...alloc("staff-key", "reserved"), date: secondDate }];
  const stackedAllocations = [
    { ...alloc("mirrored-key"), date: secondDate, containerSubscriptionId: subscriptions[1]._id },
    { ...alloc("stacked-key"), date: secondDate, containerSubscriptionId: subscriptions[1]._id },
    { ...alloc("staff-key"), date: secondDate, containerSubscriptionId: subscriptions[4]._id },
  ];
  const batches = [
    {
      containerSubscriptionId: subscriptions[2]._id,
      metadata: {
        chefChoiceDeliveryDeductions: [{ idempotencyKey: days[2]._id, quantity: 1 }],
        historicalParentDeliveryReconciliations: [{ deliveries: [{ dayId: days[2]._id, quantity: 1 }] }],
      },
    },
    {
      containerSubscriptionId: subscriptions[2]._id,
      metadata: {
        historicalParentDeliveryReconciliations: [{ deliveries: [{ dayId: days[2]._id, quantity: 2 }] }],
      },
    },
    {
      containerSubscriptionId: subscriptions[4]._id,
      metadata: {
        manualDeductions: [{ allocationKeys: ["staff-key"] }],
      },
    },
  ];
  const staffLogs = [
    {
      _id: "000000000000000000000021",
      entityId: subscriptions[4]._id,
      action: "manual_subscription_meal_deduction",
      meta: { status: "committed", businessDate: secondDate, deductedTotalMeals: 2 },
    },
    {
      _id: "000000000000000000000022",
      entityId: subscriptions[4]._id,
      action: "manual_subscription_meal_deduction",
      meta: { status: "applying", businessDate: secondDate, deductedTotalMeals: 2 },
    },
  ];
  const cursor = (rows) => ({
    populate() { return this; },
    select() { return this; },
    sort() { return this; },
    async lean() { return rows; },
  });
  try {
    mock.method(Subscription, "distinct", async () => []);
    mock.method(Subscription, "find", () => cursor(subscriptions));
    mock.method(SubscriptionDay, "find", () => cursor(days));
    mock.method(Delivery, "find", () => cursor(deliveries));
    mock.method(Payment, "find", () => cursor([]));
    mock.method(SubscriptionPickupRequest, "find", () => cursor([]));
    mock.method(ActivityLog, "find", () => cursor(staffLogs));
    mock.method(SubscriptionAuditLog, "find", () => cursor([]));
    mock.method(SubscriptionEntitlementAllocation, "find", () => cursor(stackedAllocations));
    mock.method(SubscriptionEntitlementBatch, "find", () => cursor(batches));

    const options = { from: firstDate, to: secondDate, now: new Date("2026-11-22T12:00:00Z") };
    const report = await buildSubscriptionOperationsAuditWithDailyDelivery(options);
    const rows = new Map(report.dailyDeliveryOperations
      .flatMap((day) => day.customers)
      .filter((row) => row.dashboardDelivered)
      .map((row) => [row.subscriptionId, row]));
    assert.deepEqual(
      subscriptions.map(({ _id }) => {
        const row = rows.get(_id);
        return [row.automaticConsumedMeals, row.manualDeductedMeals, row.result.code];
      }),
      [
        [2, 0, "DELIVERED_BALANCED"],
        [2, 0, "DELIVERED_BALANCED"],
        [3, 0, "DELIVERED_BALANCED"],
        [0, 0, "DELIVERED_WITHOUT_DEDUCTION"],
        [0, 2, "DELIVERED_WITH_MANUAL_DEDUCTION"],
      ]
    );
    const { deliveryOperations, operations } = report.summary;
    assert.equal(deliveryOperations.consumptionDifference, -2);
    assert.equal(deliveryOperations.automaticConsumedMeals, operations.automaticConsumedMeals);
    assert.equal(deliveryOperations.manuallyDeductedMeals, operations.netManualDeductions);
    assert.equal(deliveryOperations.doubleDeductionSuspicions, 0);

    const summaryOnly = await buildSubscriptionOperationsAuditWithDailyDelivery({ ...options, includeDetails: false });
    assert.deepEqual(summaryOnly.summary, report.summary);
    assert(summaryOnly.dailyDeliveryOperations.every((day) => day.customers.length === 0));
    assert(summaryOnly.subscriptionAudits.every((subscription) => subscription.days.length === 0));
  } finally {
    mock.restoreAll();
  }
}

async function run() {
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

  const splitDeduction = classifyDailyDeliveryRow({
    deliveryExpected: true,
    dashboardDelivered: true,
    automaticConsumedMeals: 1,
    manualDeductedMeals: 1,
    expectedConsumedMeals: 2,
    observedConsumedMeals: 2,
    consumptionDifference: 0,
  });
  assert.equal(splitDeduction.code, "DELIVERED_WITH_MANUAL_DEDUCTION");

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

  await testReportDeductionEvidence();
  console.log("subscriptionOperationsDailyDeliveryService tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

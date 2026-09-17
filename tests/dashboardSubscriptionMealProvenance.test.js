"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  buildProvenanceReport,
  parseEmbeddedActor,
  resolvePlanningRole,
  selectionChannelFor,
} = require("../src/services/subscription/subscriptionMealMovementProvenanceService");

function baseSubscription(overrides = {}) {
  return {
    _id: "64b000000000000000000001",
    totalMeals: 7,
    remainingMeals: 4,
    reservedMeals: 0,
    consumedMeals: 3,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    deliveryMode: "delivery",
    baseMealAllocations: [],
    ...overrides,
  };
}

function trackingDay(overrides = {}) {
  return {
    date: "2026-07-30",
    status: "delivered",
    dayStatus: "fulfilled",
    fulfillmentMode: "delivery",
    receivedMeals: 1,
    consumedMeals: 1,
    mealItems: [{
      id: "slot_1",
      slotKey: "slot_1",
      name: "دجاج مع رز",
      quantity: 1,
      carbs: [],
    }],
    ...overrides,
  };
}

assert.deepEqual(parseEmbeddedActor("courier:64c000000000000000000001"), {
  role: "courier",
  id: "64c000000000000000000001",
});
assert.equal(resolvePlanningRole({ plannerMeta: { confirmedByRole: "client" } }), "client");
assert.equal(selectionChannelFor({ day: { plannerMeta: { confirmedByRole: "client" } } }).code, "mobile_app");

{
  const dayId = "64d000000000000000000001";
  const actorId = "64c000000000000000000001";
  const report = buildProvenanceReport({
    subscription: baseSubscription({
      consumedMeals: 1,
      remainingMeals: 6,
      baseMealAllocations: [{
        allocationKey: "delivery-allocation",
        dayId,
        date: "2026-07-30",
        slotKey: "slot_1",
        quantity: 1,
        state: "consumed",
        consumedAt: new Date("2026-07-30T12:00:00.000Z"),
      }],
    }),
    trackingDays: [trackingDay()],
    summary: { balanceConsumedMeals: 1 },
    manualDeductions: [],
    rawDays: [{
      _id: dayId,
      date: "2026-07-30",
      status: "fulfilled",
      creditsDeducted: true,
      plannerMeta: { confirmedByRole: "client" },
      operationAuditLog: [{ action: "fulfill", by: `courier:${actorId}`, at: new Date("2026-07-30T12:00:00.000Z") }],
    }],
    pickupRequests: [],
    audits: [],
    deliveries: [{ dayId, status: "delivered", deliveredAt: new Date("2026-07-30T12:00:00.000Z") }],
    actors: [{ _id: actorId, email: "courier@basicdiet.com", role: "courier" }],
  });

  assert.equal(report.coverage.status, "complete");
  assert.equal(report.coverage.consumption.delivery, 1);
  assert.equal(report.coverage.selection.mobileApp, 1);
  assert.equal(report.movements[0].sourceCode, "delivery_fulfillment");
  assert.equal(report.movements[0].actor.role, "courier");
  assert.equal(report.movements[0].mealItems[0].name, "دجاج مع رز");
}

{
  const pickupId = "64e000000000000000000001";
  const report = buildProvenanceReport({
    subscription: baseSubscription({
      deliveryMode: "pickup",
      consumedMeals: 1,
      remainingMeals: 6,
      baseMealAllocations: [{
        allocationKey: "pickup-allocation",
        pickupRequestId: pickupId,
        date: "2026-07-30",
        slotKey: "slot_1",
        quantity: 1,
        state: "consumed",
        consumedAt: new Date("2026-07-30T10:00:00.000Z"),
      }],
    }),
    trackingDays: [trackingDay({ fulfillmentMode: "pickup" })],
    summary: { balanceConsumedMeals: 1 },
    manualDeductions: [],
    rawDays: [],
    pickupRequests: [{
      _id: pickupId,
      date: "2026-07-30",
      status: "fulfilled",
      creditsConsumedAt: new Date("2026-07-30T10:00:00.000Z"),
      snapshot: { createdFrom: "client_pickup_request" },
      selectedMealSlotIds: ["slot_1"],
      operationAuditLog: [{ action: "fulfill", by: "cashier:64c000000000000000000002", at: new Date("2026-07-30T10:00:00.000Z") }],
    }],
    audits: [],
    deliveries: [],
    actors: [{ _id: "64c000000000000000000002", email: "pickup@basicdiet.com", role: "cashier" }],
  });

  assert.equal(report.coverage.consumption.branchPickup, 1);
  assert.equal(report.coverage.selection.mobileApp, 1);
  assert.equal(report.movements[0].sourceCode, "branch_pickup_fulfillment");
}

{
  const report = buildProvenanceReport({
    subscription: baseSubscription({ consumedMeals: 1, remainingMeals: 6 }),
    trackingDays: [],
    summary: { balanceConsumedMeals: 1 },
    manualDeductions: [{
      id: "manual-1",
      businessDate: "2026-07-30",
      deducted: { totalMeals: 1, regularMeals: 1, premiumMeals: 0, addons: [] },
      fulfillmentMethod: "pickup",
      actor: { id: "64c000000000000000000003", role: "admin" },
      createdAt: new Date("2026-07-30T08:00:00.000Z"),
    }],
    rawDays: [],
    pickupRequests: [],
    audits: [],
    deliveries: [],
    actors: [{ _id: "64c000000000000000000003", email: "basicdite@outlook.sa", role: "admin" }],
  });

  assert.equal(report.coverage.status, "complete");
  assert.equal(report.coverage.consumption.dashboardManual, 1);
  assert.equal(report.movements[0].sourceCode, "dashboard_manual_deduction");
}

{
  const report = buildProvenanceReport({
    subscription: baseSubscription({ consumedMeals: 1, remainingMeals: 6 }),
    trackingDays: [],
    summary: { balanceConsumedMeals: 1 },
    manualDeductions: [],
    rawDays: [],
    pickupRequests: [],
    audits: [],
    deliveries: [],
    actors: [],
  });

  assert.equal(report.coverage.status, "partial");
  assert.equal(report.coverage.unknownMeals, 1);
  assert.equal(report.movements[0].sourceCode, "legacy_unattributed_consumption");
  assert.equal(report.movements[0].confidence, "unknown");
}

console.log("dashboard subscription meal provenance tests passed");

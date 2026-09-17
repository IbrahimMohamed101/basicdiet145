"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const {
  correctedSource,
  pickupSnapshotItems,
  recalculateCoverage,
} = require("../src/services/subscription/subscriptionMealMovementProvenanceEnrichmentService");

assert.deepEqual(correctedSource({ balanceEffect: "consumed", status: "no_show" }), {
  sourceCode: "pickup_no_show_consumption",
  sourceLabel: "حسم بعد عدم حضور العميل للاستلام",
  completion: { code: "no_show", label: "لم يحضر العميل" },
});

assert.deepEqual(correctedSource({ balanceEffect: "forfeited", status: "no_show" }), {
  sourceCode: "forfeited_entitlement",
  sourceLabel: "مصادرة رصيد وفق الحالة التشغيلية",
  completion: { code: "forfeiture", label: "مصادرة" },
});

{
  const items = pickupSnapshotItems({
    snapshot: {
      mealSlots: [{
        slotKey: "slot_1",
        slotIndex: 1,
        selectionType: "premium_meal",
        isPremium: true,
        displaySnapshot: { name: { ar: "سلمون مع أرز" } },
        carbs: [{ name: "أرز أبيض", grams: 150 }],
      }],
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "سلمون مع أرز");
  assert.equal(items[0].typeLabel, "وجبة مميزة");
  assert.equal(items[0].carbs[0].grams, 150);
}

{
  const coverage = recalculateCoverage([
    {
      balanceEffect: "consumed",
      quantity: 1,
      sourceCode: "delivery_fulfillment",
      confidence: "exact",
      selection: { code: "mobile_app" },
    },
    {
      balanceEffect: "consumed",
      quantity: 1,
      sourceCode: "pickup_no_show_consumption",
      confidence: "exact",
      selection: { code: "mobile_app" },
    },
    {
      balanceEffect: "consumed",
      quantity: 1,
      sourceCode: "dashboard_manual_deduction",
      confidence: "exact",
      selection: { code: "not_applicable" },
    },
    {
      balanceEffect: "reserved",
      quantity: 2,
      sourceCode: "mobile_app_reservation",
      confidence: "exact",
      selection: { code: "mobile_app" },
    },
  ], 3);

  assert.equal(coverage.status, "complete");
  assert.equal(coverage.consumption.delivery, 1);
  assert.equal(coverage.consumption.noShow, 1);
  assert.equal(coverage.consumption.dashboardManual, 1);
  assert.equal(coverage.selection.mobileApp, 2);
  assert.equal(coverage.selection.notApplicable, 1);
  assert.equal(coverage.reservationMeals, 2);
}

console.log("dashboard subscription meal provenance enrichment tests passed");

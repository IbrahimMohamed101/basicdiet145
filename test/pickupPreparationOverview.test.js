"use strict";

const assert = require("node:assert");
const { resolvePickupPreparationState } = require("../src/services/subscription/subscriptionPickupPreparationService");

// Mock dependencies
const mockDeps = (overrides = {}) => ({
  validateDayBeforeLockOrPrepare: () => {},
  resolveMealsPerDay: () => 1,
  getTodayKSADate: () => "2026-04-12",
  toKSADateString: (d) => (d instanceof Date ? d.toISOString().split("T")[0] : d),
  ...overrides,
});

async function runTests() {
  console.log("Running Pickup Preparation Overview Tests...");

  // 1. Hidden: deliveryMode = 'delivery'
  {
    console.log("- Test 1: deliveryMode = 'delivery'");
    const sub = { deliveryMode: "delivery" };
    const res = resolvePickupPreparationState(sub, null, mockDeps());
    assert.strictEqual(res.flowStatus, "hidden");
  }

  // 2. Inactive: status = 'expired'
  {
    console.log("- Test 2: status = 'expired'");
    const sub = { deliveryMode: "pickup", status: "expired" };
    const res = resolvePickupPreparationState(sub, null, mockDeps());
    assert.strictEqual(res.flowStatus, "disabled");
    assert.strictEqual(res.reason, "SUBSCRIPTION_INACTIVE");
  }

  // 2b. Expired by validityEndDate
  {
    console.log("- Test 2b: Expired by validityEndDate");
    const sub = { deliveryMode: "pickup", status: "active", validityEndDate: "2026-04-11" };
    const res = resolvePickupPreparationState(sub, null, mockDeps({ getTodayKSADate: () => "2026-04-12" }));
    assert.strictEqual(res.flowStatus, "disabled");
    assert.strictEqual(res.reason, "SUBSCRIPTION_INACTIVE");
  }

  // 3. Missing Day: todayDay = null -> PLANNING_INCOMPLETE
  {
    console.log("- Test 3: todayDay = null");
    const sub = { deliveryMode: "pickup", status: "active" };
    const res = resolvePickupPreparationState(sub, null, mockDeps());
    assert.strictEqual(res.flowStatus, "disabled");
    assert.strictEqual(res.reason, "PLANNING_INCOMPLETE");
  }

  // 4. Completed: status = 'fulfilled'
  {
    console.log("- Test 4: status = 'fulfilled'");
    const sub = { deliveryMode: "pickup", status: "active" };
    const day = { status: "fulfilled" };
    const res = resolvePickupPreparationState(sub, day, mockDeps());
    assert.strictEqual(res.flowStatus, "completed");
  }

  // 5. In Progress: status = 'locked'
  {
    console.log("- Test 5: status = 'locked'");
    const sub = { deliveryMode: "pickup", status: "active" };
    const day = { status: "locked" };
    const res = resolvePickupPreparationState(sub, day, mockDeps());
    assert.strictEqual(res.flowStatus, "in_progress");
  }

  // 6. In Progress: pickupRequested = true
  {
    console.log("- Test 6: pickupRequested = true");
    const sub = { deliveryMode: "pickup", status: "active" };
    const day = { status: "open", pickupRequested: true };
    const res = resolvePickupPreparationState(sub, day, mockDeps());
    assert.strictEqual(res.flowStatus, "in_progress");
  }

  // 7. Skipped: status = 'skipped'
  {
    console.log("- Test 7: status = 'skipped'");
    const sub = { deliveryMode: "pickup", status: "active" };
    const day = { status: "skipped" };
    const res = resolvePickupPreparationState(sub, day, mockDeps());
    assert.strictEqual(res.flowStatus, "disabled");
    assert.strictEqual(res.reason, "DAY_SKIPPED");
  }

  // 8. Planning Incomplete: validateDay throws PLANNING_INCOMPLETE
  {
    console.log("- Test 8: Planning Incomplete (from validation)");
    const sub = { deliveryMode: "pickup", status: "active" };
    const day = { status: "open" };
    const deps = mockDeps({
      validateDayBeforeLockOrPrepare: () => {
        const err = new Error("Planning incomplete");
        err.code = "PLANNING_INCOMPLETE";
        throw err;
      },
    });
    const res = resolvePickupPreparationState(sub, day, deps);
    assert.strictEqual(res.flowStatus, "disabled");
    assert.strictEqual(res.reason, "PLANNING_INCOMPLETE");
  }

  // 9. Payment Required: validateDay throws PAYMENT_REQUIRED
  {
    console.log("- Test 9: Payment Required");
    const sub = { deliveryMode: "pickup", status: "active" };
    const day = { status: "open" };
    const deps = mockDeps({
      validateDayBeforeLockOrPrepare: () => {
        const err = new Error("Payment required");
        err.code = "PREMIUM_OVERAGE_PAYMENT_REQUIRED";
        throw err;
      },
    });
    const res = resolvePickupPreparationState(sub, day, deps);
    assert.strictEqual(res.flowStatus, "disabled");
    assert.strictEqual(res.reason, "PAYMENT_REQUIRED");
  }

  // 10. Insufficient Credits: remainingMeals < mealsPerDay
  {
    console.log("- Test 10: Insufficient Credits");
    const sub = { deliveryMode: "pickup", status: "active", remainingMeals: 0 };
    const day = { status: "open" };
    const res = resolvePickupPreparationState(sub, day, mockDeps({ resolveMealsPerDay: () => 1 }));
    assert.strictEqual(res.flowStatus, "disabled");
    assert.strictEqual(res.reason, "INSUFFICIENT_CREDITS");
  }

  // 11. Available: All checks pass
  {
    console.log("- Test 11: Available");
    const sub = { deliveryMode: "pickup", status: "active", remainingMeals: 5 };
    const day = { status: "open" };
    const res = resolvePickupPreparationState(sub, day, mockDeps());
    assert.strictEqual(res.flowStatus, "available");
    assert.strictEqual(res.reason, null);
    assert.strictEqual(res.buttonLabel, "تجهيز الطلب");
  }
  // --- Pickup Status Mapping Tests ---
  console.log("\nRunning Pickup Status Mapping Tests...");

  const STEP_MAP = {
    open: 1,
    locked: 2,
    in_preparation: 3,
    ready_for_pickup: 4,
    fulfilled: 4,
  };

  const getMappedStatus = (status) => ({
    currentStep: STEP_MAP[status] ?? 1,
    isReady: ["ready_for_pickup", "fulfilled"].includes(status),
    isCompleted: status === "fulfilled",
  });

  // Test Open
  {
    console.log("- Status: open");
    const res = getMappedStatus("open");
    assert.strictEqual(res.currentStep, 1);
    assert.strictEqual(res.isReady, false);
  }

  // Test Locked
  {
    console.log("- Status: locked");
    const res = getMappedStatus("locked");
    assert.strictEqual(res.currentStep, 2);
    assert.strictEqual(res.isReady, false);
  }

  // Test In Preparation
  {
    console.log("- Status: in_preparation");
    const res = getMappedStatus("in_preparation");
    assert.strictEqual(res.currentStep, 3);
    assert.strictEqual(res.isReady, false);
  }

  // Test Ready
  {
    console.log("- Status: ready_for_pickup");
    const res = getMappedStatus("ready_for_pickup");
    assert.strictEqual(res.currentStep, 4);
    assert.strictEqual(res.isReady, true);
    assert.strictEqual(res.isCompleted, false);
  }

  // Test Fulfilled
  {
    console.log("- Status: fulfilled");
    const res = getMappedStatus("fulfilled");
    assert.strictEqual(res.currentStep, 4);
    assert.strictEqual(res.isReady, true);
    assert.strictEqual(res.isCompleted, true);
  }

  console.log("\nAll Tests Passed!");
}

runTests().catch((err) => {
  console.error("\nTests Failed:", err);
  process.exit(1);
});

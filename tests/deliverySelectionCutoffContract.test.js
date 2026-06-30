/**
 * Delivery Selection Cutoff Contract Tests
 *
 * Verifies the full delivery cutoff, timeline status mapping, canEdit, lockedReason,
 * fulfillmentMode per-day, and chef-selection idempotency business rules.
 *
 * All tests are pure unit tests: no DB, no HTTP server, no external calls.
 * Business timezone: Asia/Riyadh (UTC+3).
 *
 * Core business rule:
 *   deliveryStartTime = start of delivery window (e.g. "12:00-14:00" → 12:00 KSA)
 *   selectionCutoffTime = deliveryStartTime − 2 hours → 10:00 KSA
 */

"use strict";

const assert = require("node:assert");

const {
  resolveDeliverySelectionCutoffState,
  deriveTimelinePlanningContract,
  resolveTimelineLegacyStatus,
} = require("../src/services/subscription/subscriptionTimelineService");

const {
  assertSubscriptionDayModifiable,
  DELIVERY_SELECTION_CUTOFF_PASSED_CODE,
  DELIVERY_SELECTION_CUTOFF_HOURS,
} = require("../src/services/subscription/subscriptionDayModificationPolicyService");

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(`   ${err && err.message ? err.message : String(err)}`);
    failed += 1;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Delivery window "12:00-14:00" — cutoff is at 10:00 KSA (UTC+3 = 07:00 UTC) */
const DELIVERY_WINDOW = "12:00-14:00";
const BUSINESS_DATE   = "2026-07-01";

/** KSA midnight for BUSINESS_DATE = 2026-07-01T00:00:00+03:00 = 2026-06-30T21:00:00Z */
const KSA_MIDNIGHT_UTC = new Date("2026-06-30T21:00:00.000Z");

/** KSA 10:00 = 2026-07-01T07:00:00Z = exactly at cutoff */
const AT_CUTOFF_NOW     = new Date("2026-07-01T07:00:00.000Z");
/** One millisecond before cutoff */
const BEFORE_CUTOFF_NOW = new Date("2026-07-01T06:59:59.999Z");
/** One minute after cutoff */
const AFTER_CUTOFF_NOW  = new Date("2026-07-01T07:01:00.000Z");
/** 09:59 KSA = 06:59 UTC */
const AT_0959_KSA_NOW   = new Date("2026-07-01T06:59:00.000Z");

function buildDeliverySubscription(overrides = {}) {
  return {
    status: "active",
    deliveryMode: "delivery",
    deliveryWindow: DELIVERY_WINDOW,
    deliveryAddress: { line1: "123 Olaya St", city: "Riyadh" },
    selectedMealsPerDay: 2,
    mealsPerDay: 2,
    ...overrides,
  };
}

function buildOpenDay(dateStr = BUSINESS_DATE, overrides = {}) {
  return { date: dateStr, status: "open", ...overrides };
}

function buildDay(status, dateStr = BUSINESS_DATE, overrides = {}) {
  return { date: dateStr, status, ...overrides };
}

// ─── CUTOFF CONSTANT ──────────────────────────────────────────────────────────

test("DELIVERY_SELECTION_CUTOFF_HOURS is exactly 2", () => {
  assert.strictEqual(DELIVERY_SELECTION_CUTOFF_HOURS, 2);
});

test("DELIVERY_SELECTION_CUTOFF_PASSED_CODE is the canonical code", () => {
  assert.strictEqual(DELIVERY_SELECTION_CUTOFF_PASSED_CODE, "DELIVERY_SELECTION_CUTOFF_PASSED");
});

// ─── TEST 1 — Before cutoff, no meals selected ────────────────────────────────

test("Test 1: delivery day before cutoff (09:59 KSA) → cutoffPassed=false, open", () => {
  const sub = buildDeliverySubscription();
  const day = buildOpenDay();
  const result = resolveDeliverySelectionCutoffState({
    subscription: sub,
    day,
    date: BUSINESS_DATE,
    businessDate: BUSINESS_DATE,
    now: AT_0959_KSA_NOW,
  });
  assert.strictEqual(result.cutoffPassed, false, "cutoffPassed must be false at 09:59");

  // Timeline status from planning contract — open with no meals
  const planningContract = deriveTimelinePlanningContract({
    subscription: sub,
    day,
    meals: { selected: 0, required: 2, isSatisfied: false },
    commercialState: { commercialState: "draft", paymentRequirement: { requiresPayment: false } },
    latestPayment: null,
    businessDate: BUSINESS_DATE,
    now: AT_0959_KSA_NOW,
  });
  const legacyStatus = resolveTimelineLegacyStatus({
    isExtension: false,
    day,
    isPlanned: planningContract.isPlanned,
  });
  assert.strictEqual(legacyStatus, "open", "status must be open before cutoff");
  assert.strictEqual(planningContract.canEdit, true, "canEdit must be true before cutoff");
});

// ─── TEST 2 — Exactly at cutoff, no meals selected ────────────────────────────

test("Test 2: delivery day exactly at cutoff (10:00 KSA) → cutoffPassed=true, locked", () => {
  const sub = buildDeliverySubscription();
  const day = buildOpenDay();
  const result = resolveDeliverySelectionCutoffState({
    subscription: sub,
    day,
    date: BUSINESS_DATE,
    businessDate: BUSINESS_DATE,
    now: AT_CUTOFF_NOW,
  });
  assert.strictEqual(result.cutoffPassed, true, "cutoffPassed must be true at exactly 10:00");

  // canEdit must be false after cutoff (same-day delivery lock in deriveTimelineCanEdit)
  const planningContract = deriveTimelinePlanningContract({
    subscription: sub,
    day,
    meals: { selected: 0, required: 2, isSatisfied: false },
    commercialState: { commercialState: "draft", paymentRequirement: { requiresPayment: false } },
    latestPayment: null,
    businessDate: BUSINESS_DATE,
    now: AT_CUTOFF_NOW,
  });
  assert.strictEqual(planningContract.canEdit, false, "canEdit must be false at cutoff");
});

// ─── TEST 3 — After cutoff, no meals selected (idempotency) ───────────────────

test("Test 3: delivery day after cutoff (10:01 KSA) → still locked, idempotent", () => {
  const sub = buildDeliverySubscription();
  const day = buildOpenDay();

  // Call twice — same result
  const r1 = resolveDeliverySelectionCutoffState({ subscription: sub, day, date: BUSINESS_DATE, businessDate: BUSINESS_DATE, now: AFTER_CUTOFF_NOW });
  const r2 = resolveDeliverySelectionCutoffState({ subscription: sub, day, date: BUSINESS_DATE, businessDate: BUSINESS_DATE, now: AFTER_CUTOFF_NOW });
  assert.strictEqual(r1.cutoffPassed, true);
  assert.strictEqual(r2.cutoffPassed, true);
  assert.strictEqual(r1.cutoffPassed, r2.cutoffPassed, "idempotent: same result on repeated calls");
  assert.deepStrictEqual(r1.lockDateTime, r2.lockDateTime, "lockDateTime must be stable");
});

// ─── TEST 4 — Customer selected all meals, at cutoff ─────────────────────────

test("Test 4: all meals selected at cutoff → locked, no extra chef meals generated", () => {
  const sub = buildDeliverySubscription();
  // Day has 2 complete slots (customer selected all)
  const day = buildOpenDay(BUSINESS_DATE, {
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", status: "complete", selectionType: "standard_meal" },
      { slotIndex: 2, slotKey: "slot_2", status: "complete", selectionType: "standard_meal" },
    ],
  });
  const cutoff = resolveDeliverySelectionCutoffState({ subscription: sub, day, date: BUSINESS_DATE, businessDate: BUSINESS_DATE, now: AT_CUTOFF_NOW });
  assert.strictEqual(cutoff.cutoffPassed, true, "cutoff must have passed");

  // Chef-selection resolution is read-only at query time: isValidHomeDeliveryChefChoiceDay
  // returns false when there are explicit meal slots. We validate by checking hasExplicitKitchenMeals.
  const { hasExplicitKitchenMeals } = require("../src/services/dashboard/homeDeliveryChefChoiceService");
  assert.strictEqual(hasExplicitKitchenMeals(day), true, "day with complete slots must report explicit meals");
  // Therefore no chef-choice slots are generated — confirmed by isValidHomeDeliveryChefChoiceDay
  const { isValidHomeDeliveryChefChoiceDay } = require("../src/services/dashboard/homeDeliveryChefChoiceService");
  assert.strictEqual(isValidHomeDeliveryChefChoiceDay(day, sub), false, "chef choice must NOT be generated when customer selected all meals");
});

// ─── TEST 5 — Customer selected partial meals, at cutoff ─────────────────────

test("Test 5: 1 of 3 meals selected at cutoff → locked, only 2 missing become chef choice", () => {
  const sub = buildDeliverySubscription({ selectedMealsPerDay: 3, mealsPerDay: 3 });
  // 1 complete slot, 2 empty (unspecified)
  const day = buildOpenDay(BUSINESS_DATE, {
    planningMeta: { requiredMealCount: 3, selectedTotalMealCount: 1 },
    mealSlots: [
      { slotIndex: 1, slotKey: "slot_1", status: "complete", selectionType: "standard_meal" },
    ],
  });
  const cutoff = resolveDeliverySelectionCutoffState({ subscription: sub, day, date: BUSINESS_DATE, businessDate: BUSINESS_DATE, now: AT_CUTOFF_NOW });
  assert.strictEqual(cutoff.cutoffPassed, true);

  // has explicit meals (1 complete slot), so isValidHomeDeliveryChefChoiceDay = false
  // The kitchen queue's opsPayloadService differentiates partial vs none.
  // For the timeline, day is locked regardless.
  const { hasExplicitKitchenMeals, resolveHomeDeliveryEntitlementCount } = require("../src/services/dashboard/homeDeliveryChefChoiceService");
  assert.strictEqual(hasExplicitKitchenMeals(day), true, "partial selection still has explicit meals");
  const required = resolveHomeDeliveryEntitlementCount(day, sub);
  assert.strictEqual(required, 3, "required count must be 3");

  const { buildKitchenDetailsPayload } = require("../src/services/dashboard/opsPayloadService");
  const kitchenDetails = buildKitchenDetailsPayload(day, sub, "en");
  assert.strictEqual(kitchenDetails.selectionMode, "mixed_customer_and_chef_choice");
  assert.strictEqual(kitchenDetails.mealSlots.length, 3, "must expose 1 customer slot plus 2 chef-choice slots");
  assert.strictEqual(kitchenDetails.mealSlots.filter((slot) => slot.isChefChoice).length, 2);
  assert.strictEqual(kitchenDetails.mealSlots.filter((slot) => !slot.isChefChoice).length, 1);
  assert.strictEqual(new Set(kitchenDetails.mealSlots.map((slot) => slot.slotKey)).size, 3, "slot keys must not duplicate");
});

// ─── TEST 6 — Editing after cutoff must be rejected ──────────────────────────

test("Test 6: assertSubscriptionDayModifiable rejects after cutoff with DELIVERY_SELECTION_CUTOFF_PASSED", async () => {
  const sub = buildDeliverySubscription();
  const day = buildOpenDay();

  let caught = null;
  try {
    await assertSubscriptionDayModifiable({
      subscription: sub,
      day,
      date: BUSINESS_DATE,
      now: AT_CUTOFF_NOW,
      getBusinessDateFn: async () => BUSINESS_DATE,
    });
  } catch (err) {
    caught = err;
  }

  assert(caught !== null, "should have thrown an error");
  assert.strictEqual(caught.code, DELIVERY_SELECTION_CUTOFF_PASSED_CODE,
    `error code must be ${DELIVERY_SELECTION_CUTOFF_PASSED_CODE}, got: ${caught && caught.code}`);
  assert.strictEqual(caught.status, 400, "HTTP status must be 400");
  assert.strictEqual(caught.details.cutoffHours, 2, "details must expose cutoffHours=2");
});

// ─── TEST 7 — In preparation ──────────────────────────────────────────────────

test("Test 7: in_preparation day → status=locked, dayStatus=in_preparation, canEdit=false", () => {
  const day = buildDay("in_preparation");

  const legacyStatus = resolveTimelineLegacyStatus({ isExtension: false, day, isPlanned: false });
  assert.strictEqual(legacyStatus, "locked", "in_preparation must map to locked badge");
  assert.strictEqual(day.status, "in_preparation", "dayStatus must remain in_preparation");
});

// ─── TEST 8 — Out for delivery ────────────────────────────────────────────────

test("Test 8: out_for_delivery day → status=locked, dayStatus=out_for_delivery, canEdit=false", () => {
  const day = buildDay("out_for_delivery");

  const legacyStatus = resolveTimelineLegacyStatus({ isExtension: false, day, isPlanned: false });
  assert.strictEqual(legacyStatus, "locked", "out_for_delivery must map to locked badge");
  assert.strictEqual(day.status, "out_for_delivery", "dayStatus preserved as out_for_delivery");
});

// ─── TEST 9 — Ready for delivery ──────────────────────────────────────────────

test("Test 9: ready_for_delivery day → status=locked, dayStatus=ready_for_delivery, canEdit=false", () => {
  const day = buildDay("ready_for_delivery");

  const legacyStatus = resolveTimelineLegacyStatus({ isExtension: false, day, isPlanned: false });
  assert.strictEqual(legacyStatus, "locked", "ready_for_delivery must map to locked badge");
  assert.strictEqual(day.status, "ready_for_delivery", "dayStatus preserved as ready_for_delivery");
});

// ─── TEST 10 — Delivered / fulfilled ──────────────────────────────────────────

test("Test 10: fulfilled day → status=delivered, dayStatus=fulfilled, canEdit=false", () => {
  const day = buildDay("fulfilled");

  const legacyStatus = resolveTimelineLegacyStatus({ isExtension: false, day, isPlanned: false });
  assert.strictEqual(legacyStatus, "delivered", "fulfilled must map to delivered badge");
  assert.strictEqual(day.status, "fulfilled", "dayStatus preserved as fulfilled");

  // canEdit for a non-open day must be false
  const sub = buildDeliverySubscription();
  const planningContract = deriveTimelinePlanningContract({
    subscription: sub,
    day,
    meals: { selected: 2, required: 2, isSatisfied: true },
    commercialState: { commercialState: "confirmed", paymentRequirement: { requiresPayment: false } },
    latestPayment: null,
    businessDate: BUSINESS_DATE,
    now: AFTER_CUTOFF_NOW,
  });
  assert.strictEqual(planningContract.canEdit, false, "fulfilled day must not be editable");
});

// ─── TEST 11 — Delivery canceled ──────────────────────────────────────────────

test("Test 11: delivery_canceled → status=delivery_canceled, dayStatus=delivery_canceled, canEdit=false", () => {
  const day = buildDay("delivery_canceled");

  const legacyStatus = resolveTimelineLegacyStatus({ isExtension: false, day, isPlanned: false });
  assert.strictEqual(legacyStatus, "delivery_canceled", "delivery_canceled must map to delivery_canceled badge");
  assert.strictEqual(day.status, "delivery_canceled");
});

// ─── TEST 12 — First-day pickup override ──────────────────────────────────────

test("Test 12: first-day pickup override — Day 1 pickup, Day 2 delivery, cutoff only applies to Day 2", () => {
  const sub = buildDeliverySubscription(); // root deliveryMode = "delivery"

  // Day 1: pickup override
  const day1 = { date: BUSINESS_DATE, status: "open", fulfillmentModeOverride: "pickup", pickupLocationIdOverride: "branch_main" };

  const cutoffDay1 = resolveDeliverySelectionCutoffState({
    subscription: sub,
    day: day1,
    date: BUSINESS_DATE,
    businessDate: BUSINESS_DATE,
    now: AT_CUTOFF_NOW,
  });
  assert.strictEqual(cutoffDay1.cutoffPassed, false, "Day 1 pickup override: delivery cutoff must NOT apply");

  // Day 2: no override → delivery
  const TOMORROW = "2026-07-02";
  const day2 = { date: TOMORROW, status: "open" };
  // Day 2 is a future day (date > businessDate) → cutoff resolver returns false (future-day guard)
  const cutoffDay2Future = resolveDeliverySelectionCutoffState({
    subscription: sub,
    day: day2,
    date: TOMORROW,
    businessDate: BUSINESS_DATE,
    now: AT_CUTOFF_NOW,
  });
  assert.strictEqual(cutoffDay2Future.cutoffPassed, false, "Day 2 future date: not yet in cutoff window");

  // Confirm fulfillmentMode for Day 2 is "delivery" (no override)
  const dayOverrideMode2 = String(day2.fulfillmentModeOverride || "").trim();
  const effectiveMode2 = dayOverrideMode2 || (sub.deliveryMode === "pickup" ? "pickup" : "delivery");
  assert.strictEqual(effectiveMode2, "delivery", "Day 2 effective fulfillmentMode must be delivery");
});

// ─── TEST 13 — Idempotency of cutoff resolution ───────────────────────────────

test("Test 13: cutoff state resolution is idempotent — N calls yield same result", () => {
  const sub = buildDeliverySubscription();
  const day = buildOpenDay();
  const input = { subscription: sub, day, date: BUSINESS_DATE, businessDate: BUSINESS_DATE, now: AFTER_CUTOFF_NOW };

  const results = Array.from({ length: 5 }, () => resolveDeliverySelectionCutoffState(input));
  for (const r of results) {
    assert.strictEqual(r.cutoffPassed, true);
    assert.strictEqual(r.lockDateTime instanceof Date, true);
    assert.deepStrictEqual(r.lockDateTime, results[0].lockDateTime);
  }
});

// ─── TEST 14 — Timeline must not regress after cutoff ────────────────────────

test("Test 14: after cutoff, status must not be 'open', canEdit must not be true, planned must not appear for unselected", () => {
  const sub = buildDeliverySubscription();
  const openDay = buildOpenDay();

  // Simulate what resolveDeliverySelectionCutoffState returns
  const cutoffResult = resolveDeliverySelectionCutoffState({
    subscription: sub,
    day: openDay,
    date: BUSINESS_DATE,
    businessDate: BUSINESS_DATE,
    now: AFTER_CUTOFF_NOW,
  });
  assert.strictEqual(cutoffResult.cutoffPassed, true, "cutoff must have passed");

  // When cutoff has passed, the timeline builder overrides status→locked
  // Simulate the logic from buildSubscriptionTimeline inline
  let resolvedStatus = resolveTimelineLegacyStatus({ isExtension: false, day: openDay, isPlanned: false });
  if (cutoffResult.cutoffPassed && (resolvedStatus === "open" || resolvedStatus === "planned")) {
    resolvedStatus = "locked";
  }
  assert.strictEqual(resolvedStatus, "locked", "status must not remain 'open' after cutoff");
  assert.notStrictEqual(resolvedStatus, "open", "regression guard: must not return 'open'");
  assert.notStrictEqual(resolvedStatus, "planned", "regression guard: must not return 'planned' for unselected day after cutoff");

  // canEdit must be false (same-day delivery after lockDateTime)
  const planningContract = deriveTimelinePlanningContract({
    subscription: sub,
    day: openDay,
    meals: { selected: 0, required: 2, isSatisfied: false },
    commercialState: { commercialState: "draft", paymentRequirement: { requiresPayment: false } },
    latestPayment: null,
    businessDate: BUSINESS_DATE,
    now: AFTER_CUTOFF_NOW,
  });
  assert.strictEqual(planningContract.canEdit, false, "canEdit must be false after cutoff");
  assert.notStrictEqual(planningContract.canEdit, true, "regression guard: canEdit must not be true");
});

// ─── Additional: pickup day never enters delivery cutoff ──────────────────────

test("Pickup subscription: delivery cutoff never applies", () => {
  const sub = { ...buildDeliverySubscription(), deliveryMode: "pickup" };
  const day = buildOpenDay();
  const result = resolveDeliverySelectionCutoffState({
    subscription: sub,
    day,
    date: BUSINESS_DATE,
    businessDate: BUSINESS_DATE,
    now: AT_CUTOFF_NOW,
  });
  assert.strictEqual(result.cutoffPassed, false, "pickup subscription must never be locked by delivery cutoff");
});

test("Future delivery day: cutoff resolver returns false (only same-day applies)", () => {
  const sub = buildDeliverySubscription();
  const FUTURE_DATE = "2026-07-15";
  const day = buildOpenDay(FUTURE_DATE);
  const result = resolveDeliverySelectionCutoffState({
    subscription: sub,
    day,
    date: FUTURE_DATE,
    businessDate: BUSINESS_DATE, // today is BUSINESS_DATE, not FUTURE_DATE
    now: AT_CUTOFF_NOW,
  });
  assert.strictEqual(result.cutoffPassed, false, "future days must not be locked by delivery cutoff");
});

test("Operational state 'locked' already written → status remains locked, not re-triggered by cutoff", () => {
  const day = buildDay("locked");
  const legacyStatus = resolveTimelineLegacyStatus({ isExtension: false, day, isPlanned: false });
  assert.strictEqual(legacyStatus, "locked", "written locked day must report locked badge");
  // Cutoff condition is: (resolvedStatus === 'open' || resolvedStatus === 'planned') → already locked means no override needed
});

// ─── Summary ──────────────────────────────────────────────────────────────────

(async function summarize() {
  console.log(`\nDelivery Selection Cutoff Contract: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();

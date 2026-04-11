const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  DAY_PLANNING_VERSION,
  applyCanonicalDraftPlanningToDay,
  applyPremiumOverageState,
  confirmCanonicalDayPlanning,
  assertCanonicalPlanningExactCount,
  assertNoPendingPremiumOverage,
  buildCanonicalPlanningSnapshot,
} = require("../src/services/subscription/subscriptionDayPlanningService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

function createSubscription(overrides = {}) {
  return {
    _id: objectId(),
    selectedMealsPerDay: 3,
    contractVersion: "subscription_contract.v1",
    contractMode: "canonical",
    contractSnapshot: { meta: { version: "subscription_contract.v1" } },
    ...overrides,
  };
}

test("applyCanonicalDraftPlanningToDay stores base meal slots while allowing partial drafts", () => {
  const subscription = createSubscription();
  const day = {
    selections: [],
    premiumSelections: [],
    baseMealSlots: [],
    planningMeta: null,
  };
  const mealId = objectId();

  applyCanonicalDraftPlanningToDay({
    subscription,
    day,
    selections: [mealId],
    premiumSelections: [],
    assignmentSource: "client",
    now: new Date("2026-03-18T08:00:00.000Z"),
  });

  assert.equal(day.planningVersion, DAY_PLANNING_VERSION);
  assert.equal(day.planningState, "draft");
  assert.equal(day.selections.length, 1);
  assert.equal(day.baseMealSlots.length, 1);
  assert.equal(String(day.baseMealSlots[0].mealId), String(mealId));
  assert.equal(day.baseMealSlots[0].slotKey, "base_slot_1");
  assert.equal(day.planningMeta.requiredMealCount, 3);
  assert.equal(day.planningMeta.selectedBaseMealCount, 1);
  assert.equal(day.planningMeta.selectedTotalMealCount, 1);
  assert.equal(day.planningMeta.isExactCountSatisfied, false);
});

test("confirmCanonicalDayPlanning succeeds only when total selected meals exactly match mealsPerDay", () => {
  const subscription = createSubscription();
  const day = {
    selections: [objectId(), objectId()],
    premiumSelections: [objectId()],
    baseMealSlots: [],
    planningMeta: null,
  };

  applyCanonicalDraftPlanningToDay({
    subscription,
    day,
    selections: day.selections,
    premiumSelections: day.premiumSelections,
    assignmentSource: "client",
    now: new Date("2026-03-18T08:00:00.000Z"),
  });
  confirmCanonicalDayPlanning({
    subscription,
    day,
    actorRole: "client",
    now: new Date("2026-03-18T08:05:00.000Z"),
  });

  assert.equal(day.planningState, "confirmed");
  assert.equal(day.planningMeta.isExactCountSatisfied, true);
  assert.equal(day.planningMeta.selectedBaseMealCount, 2);
  assert.equal(day.planningMeta.selectedPremiumMealCount, 1);
  assert.equal(day.planningMeta.selectedTotalMealCount, 3);
  assert.equal(day.planningMeta.confirmedByRole, "client");
  assert.ok(day.planningMeta.confirmedAt);
});

test("assertCanonicalPlanningExactCount rejects incomplete planning", () => {
  const subscription = createSubscription();
  const day = {
    selections: [objectId()],
    premiumSelections: [],
  };

  assert.throws(
    () => assertCanonicalPlanningExactCount({ subscription, day }),
    (err) => err && err.code === "PLANNING_INCOMPLETE"
  );
});

test("buildCanonicalPlanningSnapshot preserves additive planning data for lock and fulfillment", () => {
  const subscription = createSubscription();
  const day = {
    selections: [objectId(), objectId(), objectId()],
    premiumSelections: [],
  };

  applyCanonicalDraftPlanningToDay({
    subscription,
    day,
    selections: day.selections,
    premiumSelections: day.premiumSelections,
    assignmentSource: "kitchen",
    now: new Date("2026-03-18T08:00:00.000Z"),
  });
  confirmCanonicalDayPlanning({
    subscription,
    day,
    actorRole: "client",
    now: new Date("2026-03-18T08:05:00.000Z"),
  });

  const snapshot = buildCanonicalPlanningSnapshot({ subscription, day });
  assert.equal(snapshot.version, DAY_PLANNING_VERSION);
  assert.equal(snapshot.state, "confirmed");
  assert.equal(snapshot.baseMealSlots.length, 3);
  assert.equal(snapshot.meta.requiredMealCount, 3);
  assert.equal(snapshot.meta.isExactCountSatisfied, true);
});

test("applyPremiumOverageState recomputes overage from final requested vs wallet-backed consumed counts", () => {
  const day = {};

  applyPremiumOverageState({
    day,
    requestedPremiumSelectionCount: 3,
    walletBackedConsumedCount: 1,
  });
  assert.equal(day.premiumOverageCount, 2);
  assert.equal(day.premiumOverageStatus, "pending");

  applyPremiumOverageState({
    day,
    requestedPremiumSelectionCount: 1,
    walletBackedConsumedCount: 1,
  });
  assert.equal(day.premiumOverageCount, 0);
  assert.equal(day.premiumOverageStatus, undefined);
});

test("assertNoPendingPremiumOverage blocks confirmation until overage is paid", () => {
  assert.throws(
    () => assertNoPendingPremiumOverage({
      subscription: createSubscription({ premiumWalletMode: "generic_v1" }),
      day: { premiumOverageCount: 1, premiumOverageStatus: "pending" },
      overageEligible: true,
    }),
    (err) => err && err.code === "PREMIUM_OVERAGE_PAYMENT_REQUIRED"
  );
});

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildSubscriptionRenewalSeed,
  resolveRenewalSeedSource,
  validateRenewablePlanOption,
} = require("../src/services/subscriptionRenewalService");

function objectId() {
  return new mongoose.Types.ObjectId();
}

test("resolveRenewalSeedSource prefers canonical snapshot data", () => {
  const subscriptionId = objectId();
  const planId = objectId();

  const result = resolveRenewalSeedSource({
    _id: subscriptionId,
    planId,
    selectedGrams: 200,
    selectedMealsPerDay: 4,
    contractSnapshot: {
      plan: {
        planId: String(planId),
        selectedGrams: 150,
        mealsPerDay: 3,
        daysCount: 10,
      },
      delivery: {
        mode: "delivery",
        address: { city: "Riyadh" },
        slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
      },
    },
  });

  assert.equal(result.seedSource, "snapshot");
  assert.equal(result.planId, String(planId));
  assert.equal(result.grams, 150);
  assert.equal(result.mealsPerDay, 3);
  assert.equal(result.daysCount, 10);
  assert.equal(result.deliveryPreference.seedOnly, true);
});

test("resolveRenewalSeedSource falls back to safe legacy subscription fields", () => {
  const planId = objectId();
  const result = resolveRenewalSeedSource({
    planId,
    selectedGrams: 180,
    selectedMealsPerDay: 2,
    totalMeals: 20,
    deliveryMode: "pickup",
    deliverySlot: { type: "pickup", window: "9 AM - 12 PM", slotId: "pickup-1" },
  });

  assert.equal(result.seedSource, "legacy");
  assert.equal(result.planId, String(planId));
  assert.equal(result.grams, 180);
  assert.equal(result.mealsPerDay, 2);
  assert.equal(result.daysCount, 10);
  assert.equal(result.deliveryPreference.mode, "pickup");
  assert.equal(result.deliveryPreference.seedOnly, true);
});

test("validateRenewablePlanOption rejects plans whose same option is no longer sellable", () => {
  assert.throws(
    () => validateRenewablePlanOption({
      plan: {
        _id: objectId(),
        isActive: true,
        gramsOptions: [
          {
            grams: 150,
            isActive: false,
            mealsOptions: [{ mealsPerDay: 3, isActive: true }],
          },
        ],
      },
      grams: 150,
      mealsPerDay: 3,
    }),
    /Selected grams option is no longer available/
  );
});

test("buildSubscriptionRenewalSeed returns a narrow renewable seed only when the same option is still sellable", () => {
  const previousSubscription = {
    _id: objectId(),
    planId: objectId(),
    contractSnapshot: {
      plan: {
        planId: String(objectId()),
        selectedGrams: 150,
        mealsPerDay: 3,
        daysCount: 10,
      },
      delivery: {
        mode: "delivery",
        address: { city: "Riyadh" },
        slot: { type: "delivery", window: "8 AM - 11 AM", slotId: "slot-1" },
      },
    },
  };
  const livePlan = {
    _id: previousSubscription.contractSnapshot.plan.planId,
    isActive: true,
    daysCount: 10,
    gramsOptions: [
      {
        grams: 150,
        isActive: true,
        mealsOptions: [{ mealsPerDay: 3, isActive: true }],
      },
    ],
  };

  const result = buildSubscriptionRenewalSeed({ previousSubscription, livePlan });

  assert.equal(result.renewable, true);
  assert.equal(result.seed.planId, String(livePlan._id));
  assert.equal(result.seed.grams, 150);
  assert.equal(result.seed.mealsPerDay, 3);
  assert.equal(result.seed.daysCount, 10);
  assert.equal(result.seed.deliveryPreference.seedOnly, true);
});

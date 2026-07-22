"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const {
  buildAvailabilityReadClosure,
  buildConservativeAvailability,
  shouldRecoverAvailabilityError,
} = require("../src/services/subscription/pickupAvailabilityCanonicalReadClosureService");

async function testInternalFailureRebuildsWithResolvedSubscriptionId() {
  const requestedPlanId = "6a49590b991f8d73bc7a268f";
  const subscriptionId = "6a60d2371aac9725009643de";
  const userId = "6a60d2161aac972500964355";
  let canonicalArgs = null;
  const logs = [];

  const wrapped = buildAvailabilityReadClosure(
    async () => {
      const error = new TypeError("legacy availability enrichment failed");
      throw error;
    },
    {
      resolveContext: async (args) => ({
        subscriptionId,
        requestedSubscriptionId: args.subscriptionId,
        requestedPlanId: args.subscriptionId,
        resolution: "authenticated_plan_id_alias",
      }),
      buildCanonicalRead: async (args) => {
        canonicalArgs = args;
        return {
          subscriptionId,
          date: args.date,
          subscriptionDayId: "6a60d23779ee075a57f6ffb5",
          wallet: {
            totalEntitlement: 7,
            remainingMeals: 6,
            availableMeals: 7,
            reservedMeals: 0,
            consumedMeals: 0,
          },
          summary: {
            availableCount: 1,
            availableSelectableCount: 1,
            canCreatePickupRequest: true,
          },
          slots: [{ slotId: "slot_1", available: true, canSelect: true }],
          pickupItems: [{
            itemId: "slot_1",
            selectionMode: "independent",
            availability: { state: "available", available: true, canSelect: true },
          }],
          sections: [],
          availableSlotIds: ["slot_1"],
          unavailableSlotIds: [],
        };
      },
      log: {
        error(message, attributes) {
          logs.push({ message, attributes });
        },
      },
    }
  );

  const result = await wrapped({
    userId,
    subscriptionId: requestedPlanId,
    date: "2026-07-22",
  });

  assert.ok(canonicalArgs);
  assert.strictEqual(canonicalArgs.subscriptionId, subscriptionId);
  assert.strictEqual(canonicalArgs.userId, userId);
  assert.strictEqual(result.subscriptionId, subscriptionId);
  assert.strictEqual(result.summary.canCreatePickupRequest, true);
  assert.strictEqual(result.availabilityRecovery.recovered, true);
  assert.strictEqual(result.identifierResolution.requestedPlanId, requestedPlanId);
  assert.strictEqual(result.identifierResolution.subscriptionId, subscriptionId);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].attributes.requestedSubscriptionId, requestedPlanId);
  assert.strictEqual(logs[0].attributes.subscriptionId, subscriptionId);
}

async function testBusinessErrorsRemainFailClosed() {
  const forbidden = new Error("Forbidden");
  forbidden.code = "FORBIDDEN";
  forbidden.status = 403;
  let resolved = false;
  const wrapped = buildAvailabilityReadClosure(
    async () => {
      throw forbidden;
    },
    {
      resolveContext: async () => {
        resolved = true;
        return {};
      },
      log: { error() {} },
    }
  );

  await assert.rejects(
    () => wrapped({ userId: "user", subscriptionId: "subscription" }),
    (error) => error === forbidden
  );
  assert.strictEqual(resolved, false);
  assert.strictEqual(shouldRecoverAvailabilityError(forbidden), false);
  assert.strictEqual(shouldRecoverAvailabilityError(new TypeError("boom")), true);
}

function testConservativeReadKeepsConfirmedRegularMealSelectable() {
  const result = buildConservativeAvailability({
    subscription: { totalMeals: 7, remainingMeals: 6 },
    day: {
      _id: "6a60d23779ee075a57f6ffb5",
      date: "2026-07-22",
      mealSlots: [{
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: "standard_meal",
        isPremium: false,
        productId: "6a4958e8991f8d73bc7a2605",
        displaySnapshot: {
          title: { ar: "وجبة دجاج", en: "Chicken meal" },
        },
      }],
      addonSelections: [],
    },
    pickupRequests: [],
  });

  assert.strictEqual(result.subscriptionDayId, "6a60d23779ee075a57f6ffb5");
  assert.strictEqual(result.slots.length, 1);
  assert.strictEqual(result.slots[0].available, true);
  assert.strictEqual(result.slots[0].canSelect, true);
  assert.strictEqual(result.pickupItems[0].itemId, "slot_1");
  assert.strictEqual(result.pickupItems[0].availability.state, "available");
  assert.strictEqual(result.pickupItems[0].title.en, "Chicken meal");
  assert.strictEqual(result.summary.canCreatePickupRequest, true);
  assert.deepStrictEqual(result.availableSlotIds, ["slot_1"]);
}

function testConservativeReadBlocksExistingClaimAndPendingPayment() {
  const baseDay = {
    _id: "day_1",
    date: "2026-07-22",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "premium_meal",
      isPremium: true,
      premiumSource: "pending_payment",
    }],
    addonSelections: [],
  };
  const paymentBlocked = buildConservativeAvailability({
    subscription: { totalMeals: 7, remainingMeals: 6 },
    day: baseDay,
    pickupRequests: [],
  });
  assert.strictEqual(paymentBlocked.slots[0].available, false);
  assert.strictEqual(paymentBlocked.slots[0].unavailableReason, "PREMIUM_PAYMENT_REQUIRED");
  assert.strictEqual(paymentBlocked.pickupItems[0].availability.state, "payment_required");

  const claimed = buildConservativeAvailability({
    subscription: { totalMeals: 7, remainingMeals: 6 },
    day: {
      ...baseDay,
      mealSlots: [{
        ...baseDay.mealSlots[0],
        selectionType: "standard_meal",
        isPremium: false,
        premiumSource: "none",
      }],
    },
    pickupRequests: [{
      _id: "request_1",
      status: "in_preparation",
      selectedPickupItemIds: ["slot_1"],
    }],
  });
  assert.strictEqual(claimed.slots[0].available, false);
  assert.strictEqual(claimed.slots[0].unavailableReason, "SLOT_ALREADY_RESERVED");
  assert.strictEqual(claimed.pickupItems[0].availability.state, "reserved");
  assert.strictEqual(claimed.summary.canCreatePickupRequest, false);
}

async function run() {
  await testInternalFailureRebuildsWithResolvedSubscriptionId();
  await testBusinessErrorsRemainFailClosed();
  testConservativeReadKeepsConfirmedRegularMealSelectable();
  testConservativeReadBlocksExistingClaimAndPendingPayment();
  console.log("pickup availability canonical read closure checks passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

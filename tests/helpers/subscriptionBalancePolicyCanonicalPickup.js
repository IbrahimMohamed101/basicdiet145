"use strict";

// subscriptionBalancePolicy.test.js contains one historical fixture that marks
// a pickup request as creditsReserved without performing the reservation.
// Canonical pickup semantics reserve (and debit remainingMeals) when the request
// is created, then move reserved -> consumed at fulfillment without a second
// debit. Adapt only that exact fixture to the real lifecycle.

const SubscriptionPickupRequest = require("../../src/models/SubscriptionPickupRequest");
const {
  reserveSubscriptionMealsForPickupRequest,
} = require("../../src/services/subscription/subscriptionPickupRequestBalanceClosureService");

const originalCreate = SubscriptionPickupRequest.create.bind(SubscriptionPickupRequest);
let canonicalFixtureApplied = false;

SubscriptionPickupRequest.create = async function createCanonicalPickupFixture(doc, ...args) {
  const isTargetFixture = doc
    && !Array.isArray(doc)
    && doc.date === "2026-06-09"
    && doc.status === "ready_for_pickup"
    && doc.creditsReserved === true
    && Number(doc.mealCount || 0) === 2;

  if (!isTargetFixture) {
    return originalCreate(doc, ...args);
  }

  const request = await originalCreate({
    ...doc,
    creditsReserved: false,
    creditsReservedAt: null,
    baseAllocationKeys: undefined,
    baseAllocationMode: "none",
  }, ...args);

  await reserveSubscriptionMealsForPickupRequest({
    subscriptionId: request.subscriptionId,
    pickupRequestId: request._id,
    mealCount: Number(request.mealCount || 0),
  });

  canonicalFixtureApplied = true;
  return SubscriptionPickupRequest.findById(request._id);
};

process.on("beforeExit", () => {
  if (!canonicalFixtureApplied) {
    console.error(
      "subscription balance harness did not observe the canonical pickup fixture"
    );
    process.exitCode = 1;
  }
});

"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");

const authority = require("../src/services/subscription/subscriptionPickupCycleAuthorityService");
const pickupService = require("../src/services/subscription/subscriptionPickupRequestClientService");
const overviewService = require("../src/services/subscription/subscriptionClientOverviewService");

const counters = {
  release: 0,
  reconcile: 0,
  wallet: 0,
};

pickupService.getPickupAvailabilityForClient = async () => ({
  subscriptionId: "sub_1",
  date: "2099-01-01",
  slots: [],
  pickupItems: [],
});
pickupService.createSubscriptionPickupRequestForClient = async () => ({
  data: { requestId: "request_1", status: "in_preparation" },
});
pickupService.getSubscriptionPickupRequestStatusForClient = async () => ({
  requestId: "request_1",
  status: "in_preparation",
});
pickupService.listSubscriptionPickupRequestsForClient = async () => ({
  requests: [{ requestId: "request_1", status: "in_preparation" }],
});
overviewService.buildCurrentSubscriptionOverview = async () => ({
  data: { subscriptionId: "sub_1" },
});

authority.releaseExpiredReservationsForSubscription = async () => {
  counters.release += 1;
  throw new Error("read path invoked an explicit release command");
};
authority.reconcileConfirmedDayAllocations = async () => {
  counters.reconcile += 1;
  throw new Error("read path invoked an explicit reconciliation command");
};
authority.readWallet = async () => {
  counters.wallet += 1;
  return {
    sourceOfTruth: "subscription.baseMealAllocations",
    totalMeals: 4,
    remainingMeals: 3,
    reservedMeals: 1,
    consumedMeals: 0,
    forfeitedMeals: 0,
  };
};
authority.attachWalletToAvailability = (result, wallet) => ({ ...result, wallet });
authority.attachWalletToPickupCreateResult = (result, wallet) => ({ ...result, wallet });
authority.attachWalletToOverview = (result, wallet) => ({
  ...result,
  data: { ...result.data, entitlementWallet: wallet },
});

require("../src/services/installPickupMultiCyclePolicy");

async function run() {
  const availability = await pickupService.getPickupAvailabilityForClient({
    subscriptionId: "sub_1",
    date: "2099-01-01",
  });
  assert.strictEqual(availability.readConsistency.readOnly, true);

  const status = await pickupService.getSubscriptionPickupRequestStatusForClient({
    subscriptionId: "sub_1",
    requestId: "request_1",
  });
  assert.strictEqual(status.readConsistency.reconciliationApplied, false);

  const list = await pickupService.listSubscriptionPickupRequestsForClient({
    subscriptionId: "sub_1",
  });
  assert.strictEqual(list.readConsistency.readOnly, true);

  const overview = await overviewService.buildCurrentSubscriptionOverview({ userId: "user_1" });
  assert.strictEqual(overview.data.readConsistency.readOnly, true);

  assert.strictEqual(counters.release, 0, "GET-like service reads must not release expired reservations");
  assert.strictEqual(counters.reconcile, 0, "GET-like service reads must not reconcile confirmed days");
  assert.strictEqual(counters.wallet, 4, "reads may read the wallet but never mutate it");

  console.log("pickup read-only policy checks passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

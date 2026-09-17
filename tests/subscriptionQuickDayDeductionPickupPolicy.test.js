"use strict";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Subscription = require("../src/models/Subscription");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const {
  assertPickupTarget,
  filterPickupOptions,
  pickupSnapshotFilter,
} = require("../src/services/dashboard/subscriptionQuickDayDeductionPickupPolicy");

function resolvedQuery(value) {
  return {
    select() { return this; },
    lean() { return Promise.resolve(value); },
  };
}

async function withModelStubs({ deliveryMode, findOneBatch, findBatches }, work) {
  const originals = {
    subscriptionFindOne: Subscription.findOne,
    batchFindOne: SubscriptionEntitlementBatch.findOne,
    batchFind: SubscriptionEntitlementBatch.find,
  };
  try {
    Subscription.findOne = () => resolvedQuery({
      _id: new mongoose.Types.ObjectId(),
      deliveryMode,
    });
    if (findOneBatch) SubscriptionEntitlementBatch.findOne = findOneBatch;
    if (findBatches) SubscriptionEntitlementBatch.find = findBatches;
    return await work();
  } finally {
    Subscription.findOne = originals.subscriptionFindOne;
    SubscriptionEntitlementBatch.findOne = originals.batchFindOne;
    SubscriptionEntitlementBatch.find = originals.batchFind;
  }
}

async function testMixedContainerRequiresExplicitPickupSnapshot() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const batchId = new mongoose.Types.ObjectId();
  let capturedFilter = null;

  await withModelStubs({
    deliveryMode: "delivery",
    findOneBatch(filter) {
      capturedFilter = filter;
      return resolvedQuery({ _id: batchId });
    },
  }, () => assertPickupTarget({ subscriptionId, batchId }));

  assert.strictEqual(capturedFilter["deliverySnapshot.mode"], "pickup");
  assert.strictEqual(capturedFilter.$or, undefined);
}

async function testPickupContainerKeepsLegacyBatchCompatibility() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const allowedId = new mongoose.Types.ObjectId();
  let capturedFilter = null;

  const result = await withModelStubs({
    deliveryMode: "pickup",
    findBatches(filter) {
      capturedFilter = filter;
      return resolvedQuery([{ _id: allowedId }]);
    },
  }, () => filterPickupOptions(subscriptionId, [
    { id: String(allowedId) },
    { id: String(new mongoose.Types.ObjectId()) },
  ]));

  assert.strictEqual(result.length, 1);
  assert.strictEqual(String(result[0].id), String(allowedId));
  assert(Array.isArray(capturedFilter.$or));
  assert(capturedFilter.$or.some((entry) => (
    entry["deliverySnapshot.mode"]
    && entry["deliverySnapshot.mode"].$exists === false
  )));
}

function testFilterFailsClosedForUnknownParentMode() {
  assert.deepStrictEqual(pickupSnapshotFilter("delivery"), {
    "deliverySnapshot.mode": "pickup",
  });
  assert.deepStrictEqual(pickupSnapshotFilter(undefined), {
    "deliverySnapshot.mode": "pickup",
  });
}

async function run() {
  testFilterFailsClosedForUnknownParentMode();
  await testMixedContainerRequiresExplicitPickupSnapshot();
  await testPickupContainerKeepsLegacyBatchCompatibility();
  console.log("subscriptionQuickDayDeductionPickupPolicy.test.js: OK");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

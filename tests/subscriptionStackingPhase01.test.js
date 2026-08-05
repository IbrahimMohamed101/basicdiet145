"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const featureFlags = require("../src/utils/featureFlags");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");

const STACKING_ENV_KEYS = [
  "SUBSCRIPTION_STACKING_SHADOW_ENABLED",
  "SUBSCRIPTION_STACKING_WRITE_ENABLED",
  "SUBSCRIPTION_STACKING_READ_ENABLED",
];

function restoreEnvironment(snapshot) {
  for (const key of STACKING_ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function buildValidBatch(overrides = {}) {
  const userId = new mongoose.Types.ObjectId();
  const subscriptionId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();

  return new SubscriptionEntitlementBatch({
    userId,
    containerSubscriptionId: subscriptionId,
    planId,
    paymentId,
    checkoutDraftId: new mongoose.Types.ObjectId(),
    sourceKey: `payment:${paymentId}`,
    sourceType: "checkout",
    requestedStartDate: new Date("2026-08-06T00:00:00+03:00"),
    effectiveStartDate: new Date("2026-08-06T00:00:00+03:00"),
    endDate: new Date("2026-08-31T00:00:00+03:00"),
    validityEndDate: new Date("2026-08-31T00:00:00+03:00"),
    daysCount: 26,
    mealsPerDay: 2,
    proteinGrams: 150,
    totalMeals: 52,
    remainingMeals: 52,
    reservedMeals: 0,
    consumedMeals: 0,
    forfeitedMeals: 0,
    status: "active",
    applicationState: "pending",
    ...overrides,
  });
}

async function testFlagsDefaultClosed() {
  const snapshot = Object.fromEntries(
    STACKING_ENV_KEYS.map((key) => [key, process.env[key]])
  );

  try {
    STACKING_ENV_KEYS.forEach((key) => delete process.env[key]);

    assert.strictEqual(
      featureFlags.isSubscriptionStackingShadowEnabled(),
      false,
      "shadow projection must be disabled by default"
    );
    assert.strictEqual(
      featureFlags.isSubscriptionStackingWriteEnabled(),
      false,
      "stacking writes must be disabled by default"
    );
    assert.strictEqual(
      featureFlags.isSubscriptionStackingReadEnabled(),
      false,
      "stacking reads must be disabled by default"
    );

    process.env.SUBSCRIPTION_STACKING_SHADOW_ENABLED = "true";
    process.env.SUBSCRIPTION_STACKING_WRITE_ENABLED = " TRUE ";
    process.env.SUBSCRIPTION_STACKING_READ_ENABLED = "false";

    assert.strictEqual(featureFlags.isSubscriptionStackingShadowEnabled(), true);
    assert.strictEqual(featureFlags.isSubscriptionStackingWriteEnabled(), true);
    assert.strictEqual(featureFlags.isSubscriptionStackingReadEnabled(), false);
  } finally {
    restoreEnvironment(snapshot);
  }
}

async function testBatchSchemaAcceptsIndependentGrams() {
  const batch = buildValidBatch({ proteinGrams: 150 });
  await batch.validate();

  assert.strictEqual(batch.proteinGrams, 150);
  assert.strictEqual(batch.mealsPerDay, 2);
  assert.strictEqual(batch.totalMeals, 52);
}

async function testBatchDateOrderGuard() {
  const batch = buildValidBatch({
    effectiveStartDate: new Date("2026-08-10T00:00:00+03:00"),
    endDate: new Date("2026-08-09T00:00:00+03:00"),
  });

  await assert.rejects(
    () => batch.validate(),
    (err) => Boolean(err && err.errors && err.errors.endDate),
    "endDate before effectiveStartDate must be rejected"
  );
}

async function testBatchBalanceGuard() {
  const batch = buildValidBatch({
    totalMeals: 52,
    remainingMeals: 50,
    reservedMeals: 3,
  });

  await assert.rejects(
    () => batch.validate(),
    (err) => Boolean(err && err.errors && err.errors.totalMeals),
    "accounted batch balances must never exceed totalMeals"
  );
}

function testIdempotencyIndexesExist() {
  const indexNames = SubscriptionEntitlementBatch.schema.indexes()
    .map(([, options]) => options && options.name)
    .filter(Boolean);

  assert(indexNames.includes("uniq_subscription_entitlement_batch_source"));
  assert(indexNames.includes("uniq_subscription_entitlement_batch_payment"));
  assert(indexNames.includes("uniq_subscription_entitlement_batch_checkout_draft"));
}

function testPhase01IsNotWiredIntoActivation() {
  const activationPath = path.join(
    __dirname,
    "../src/services/subscription/subscriptionActivationService.js"
  );
  const activationSource = fs.readFileSync(activationPath, "utf8");

  assert.strictEqual(
    activationSource.includes("SubscriptionEntitlementBatch"),
    false,
    "phase 0-1 must not change live subscription activation behavior"
  );
}

async function run() {
  await testFlagsDefaultClosed();
  await testBatchSchemaAcceptsIndependentGrams();
  await testBatchDateOrderGuard();
  await testBatchBalanceGuard();
  testIdempotencyIndexesExist();
  testPhase01IsNotWiredIntoActivation();

  console.log("subscription stacking phase 0-1 safety contracts passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

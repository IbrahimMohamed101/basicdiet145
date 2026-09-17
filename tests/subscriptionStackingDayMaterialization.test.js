"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const {
  buildDayFulfillmentFields,
  buildStackingSubscriptionDayEntries,
  materializeStackingSubscriptionDaysTransactional,
} = require("../src/services/subscription/subscriptionStackingDayMaterializationService");

function transactionSession() {
  return {
    supportsTransactions: true,
    inTransaction: () => true,
  };
}

function buildContainer(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    deliveryMode: "delivery",
    pickupLocationId: null,
    ...overrides,
  };
}

function buildBatch(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    effectiveStartDate: new Date("2026-08-06T00:00:00+03:00"),
    endDate: new Date("2026-08-31T00:00:00+03:00"),
    deliverySnapshot: {
      mode: "delivery",
      zoneId: "zone-a",
      slot: { window: "13:00-15:00" },
      address: {
        city: "Riyadh",
        district: "Olaya",
        street: "A",
        building: "1",
      },
    },
    ...overrides,
  };
}

function testBuildsInclusiveKsaDateRange() {
  const container = buildContainer();
  const batch = buildBatch();
  const entries = buildStackingSubscriptionDayEntries({ container, batch });

  assert.strictEqual(entries.length, 26);
  assert.strictEqual(entries[0].date, "2026-08-06");
  assert.strictEqual(entries[25].date, "2026-08-31");
  assert(entries.every((entry) => String(entry.subscriptionId) === String(container._id)));
  assert(entries.every((entry) => entry.status === "open"));
}

function testDeliverySnapshotIsStoredForNewDays() {
  const container = buildContainer({ deliveryMode: "delivery" });
  const batch = buildBatch();
  const fields = buildDayFulfillmentFields({ container, batch });

  assert.strictEqual(fields.fulfillmentModeOverride, null);
  assert.strictEqual(fields.pickupLocationIdOverride, null);
  assert.strictEqual(fields.deliveryWindowOverride, "13:00-15:00");
  assert.strictEqual(fields.deliveryAddressOverride.city, "Riyadh");

  const first = buildStackingSubscriptionDayEntries({ container, batch })[0];
  assert.strictEqual(first.deliveryWindowOverride, "13:00-15:00");
  assert.strictEqual(first.deliveryAddressOverride.district, "Olaya");
}

function testPickupSnapshotOverridesContainerMode() {
  const pickupLocationId = new mongoose.Types.ObjectId();
  const container = buildContainer({ deliveryMode: "delivery" });
  const batch = buildBatch({
    effectiveStartDate: new Date("2026-09-01T00:00:00+03:00"),
    endDate: new Date("2026-09-03T00:00:00+03:00"),
    deliverySnapshot: {
      mode: "pickup",
      pickupLocationId,
    },
  });
  const entries = buildStackingSubscriptionDayEntries({ container, batch });

  assert.strictEqual(entries.length, 3);
  assert.strictEqual(entries[0].fulfillmentModeOverride, "pickup");
  assert.strictEqual(entries[0].pickupLocationIdOverride, String(pickupLocationId));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(entries[0], "deliveryAddressOverride"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(entries[0], "deliveryWindowOverride"), false);
}

function testInvalidRangesAreRejected() {
  const container = buildContainer();
  assert.throws(
    () => buildStackingSubscriptionDayEntries({
      container,
      batch: buildBatch({
        effectiveStartDate: new Date("2026-09-10T00:00:00+03:00"),
        endDate: new Date("2026-09-09T00:00:00+03:00"),
      }),
    }),
    (err) => Boolean(err && err.code === "STACKING_DAY_RANGE_INVALID")
  );
}

async function testUsesSetOnInsertAndIsIdempotent() {
  const container = buildContainer();
  const batch = buildBatch({
    effectiveStartDate: new Date("2026-08-06T00:00:00+03:00"),
    endDate: new Date("2026-08-08T00:00:00+03:00"),
  });
  const calls = [];
  const first = await materializeStackingSubscriptionDaysTransactional({
    container,
    batch,
    session: transactionSession(),
    runtime: {
      upsertDays: async (entries, session) => {
        calls.push({ entries, session });
        return {
          matchedCount: 1,
          modifiedCount: 0,
          upsertedCount: 2,
        };
      },
    },
  });

  assert.strictEqual(first.requestedCount, 3);
  assert.strictEqual(first.upsertedCount, 2);
  assert.strictEqual(first.modifiedCount, 0);
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].entries[0].date, "2026-08-06");

  const second = await materializeStackingSubscriptionDaysTransactional({
    container,
    batch,
    session: transactionSession(),
    runtime: {
      upsertDays: async () => ({
        matchedCount: 3,
        modifiedCount: 0,
        upsertedCount: 0,
      }),
    },
  });
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(second.modifiedCount, 0);
}

async function testTransactionIsMandatory() {
  await assert.rejects(
    () => materializeStackingSubscriptionDaysTransactional({
      container: buildContainer(),
      batch: buildBatch(),
      session: null,
      runtime: { upsertDays: async () => ({}) },
    }),
    (err) => Boolean(err && err.code === "SUBSCRIPTION_STACKING_TRANSACTION_REQUIRED")
  );
}

async function run() {
  testBuildsInclusiveKsaDateRange();
  testDeliverySnapshotIsStoredForNewDays();
  testPickupSnapshotOverridesContainerMode();
  testInvalidRangesAreRejected();
  await testUsesSetOnInsertAndIsIdempotent();
  await testTransactionIsMandatory();
  console.log("subscription stacking day materialization tests passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

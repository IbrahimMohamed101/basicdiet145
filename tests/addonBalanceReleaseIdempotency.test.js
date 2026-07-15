process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const mongoose = require("mongoose");
const path = require("path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Subscription = require("../src/models/Subscription");
const {
  consumeAddonBalanceAtomically,
  releaseAddonBalanceAtomically,
} = require("../src/services/subscription/subscriptionSelectionService");

function oid(seed) {
  return new mongoose.Types.ObjectId(Number(seed).toString(16).padStart(24, "0"));
}

function balance({
  bucketId,
  addonId,
  addonPlanId,
  category,
  remainingQty,
  consumedQty,
  unitPriceHalala = 1000,
  currency = "SAR",
}) {
  return {
    _id: bucketId,
    addonId,
    addonPlanId,
    category,
    remainingQty,
    consumedQty,
    includedTotalQty: Number(remainingQty || 0) + Number(consumedQty || 0),
    purchasedQty: Number(remainingQty || 0) + Number(consumedQty || 0),
    unitPriceHalala,
    currency,
  };
}

async function createSubscription(addonBalance) {
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals: 10,
    remainingMeals: 10,
    deliveryMode: "pickup",
    addonBalance,
  });
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

function getBucket(subscription, bucketId) {
  return (subscription.addonBalance || []).find((row) => String(row._id) === String(bucketId));
}

async function assertBucket(subscriptionId, bucketId, expected, message) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  const bucket = getBucket(subscription, bucketId);
  assert(bucket, `${message}: bucket not found`);
  assert.strictEqual(Number(bucket.remainingQty || 0), expected.remainingQty, `${message}: remainingQty`);
  assert.strictEqual(Number(bucket.consumedQty || 0), expected.consumedQty, `${message}: consumedQty`);
  assert.strictEqual(
    Number(bucket.remainingQty || 0) + Number(bucket.consumedQty || 0),
    expected.remainingQty + expected.consumedQty,
    `${message}: invariant`
  );
}

async function run() {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{
      args: ["--setParameter", "maxTransactionLockRequestTimeoutMillis=20000"],
    }],
  });
  const uri = mongo.getUri(`addon_release_idempotency_${Date.now()}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  await Subscription.createCollection();
  await Subscription.init();

  try {
    const addonId = oid(100);
    const planA = oid(200);
    const planB = oid(201);
    const mealBucket = oid(300);
    const snackBucket = oid(301);
    const juiceBucket = oid(302);

    {
      const subscription = await createSubscription([
        balance({
          bucketId: mealBucket,
          addonId,
          addonPlanId: planA,
          category: "meal",
          remainingQty: 2,
          consumedQty: 0,
        }),
      ]);

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const consumed = await consumeAddonBalanceAtomically({
          subscription: sub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          session,
        });
        assert.strictEqual(consumed.consumed, true);
        await sub.save({ session });
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 1, consumedQty: 1 }, "normal consume");

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, true);
        await sub.save({ session });
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 2, consumedQty: 0 }, "normal release");

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(released.reason, "no_consumed_balance");
        await sub.save({ session });
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 2, consumedQty: 0 }, "double release");
    }

    {
      const subscription = await createSubscription([
        balance({
          bucketId: mealBucket,
          addonId,
          addonPlanId: planA,
          category: "meal",
          remainingQty: 3,
          consumedQty: 0,
        }),
      ]);
      const sub = await Subscription.findById(subscription._id);
      await withTransaction(async (session) => {
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(Number(sub.addonBalance[0].remainingQty || 0), 3);
        assert.strictEqual(Number(sub.addonBalance[0].consumedQty || 0), 0);
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 3, consumedQty: 0 }, "zero consumed release");
    }

    {
      const subscription = await createSubscription([
        balance({ bucketId: mealBucket, addonId: oid(110), addonPlanId: oid(210), category: "meal", remainingQty: 1, consumedQty: 0 }),
        balance({ bucketId: snackBucket, addonId: oid(111), addonPlanId: oid(211), category: "snack", remainingQty: 7, consumedQty: 2 }),
        balance({ bucketId: juiceBucket, addonId: oid(112), addonPlanId: oid(212), category: "juice", remainingQty: 9, consumedQty: 1 }),
      ]);
      const mealAddon = oid(110);
      const mealPlan = oid(210);

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const consumed = await consumeAddonBalanceAtomically({
          subscription: sub,
          addonId: mealAddon,
          addonPlanId: mealPlan,
          category: "meal",
          session,
        });
        assert.strictEqual(consumed.consumed, true);
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          addonId: mealAddon,
          addonPlanId: mealPlan,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, true);
        await sub.save({ session });
      });

      await assertBucket(subscription._id, mealBucket, { remainingQty: 1, consumedQty: 0 }, "meal category");
      await assertBucket(subscription._id, snackBucket, { remainingQty: 7, consumedQty: 2 }, "snack isolation");
      await assertBucket(subscription._id, juiceBucket, { remainingQty: 9, consumedQty: 1 }, "juice isolation");
    }

    {
      const sharedAddon = oid(120);
      const firstBucket = oid(320);
      const secondBucket = oid(321);
      const subscription = await createSubscription([
        balance({ bucketId: firstBucket, addonId: sharedAddon, addonPlanId: planA, category: "juice", remainingQty: 0, consumedQty: 1 }),
        balance({ bucketId: secondBucket, addonId: sharedAddon, addonPlanId: planB, category: "juice", remainingQty: 5, consumedQty: 1 }),
      ]);

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          addonId: sharedAddon,
          addonPlanId: planA,
          category: "juice",
          session,
        });
        assert.strictEqual(released.released, true);
        await sub.save({ session });
      });

      await assertBucket(subscription._id, firstBucket, { remainingQty: 1, consumedQty: 0 }, "plan A release");
      await assertBucket(subscription._id, secondBucket, { remainingQty: 5, consumedQty: 1 }, "plan B isolation");
    }

    {
      const subscription = await createSubscription([
        balance({ bucketId: mealBucket, addonId, addonPlanId: planA, category: "meal", remainingQty: 3, consumedQty: 0 }),
      ]);
      const staleSub = await Subscription.findById(subscription._id);
      staleSub.addonBalance[0].remainingQty = 2;
      staleSub.addonBalance[0].consumedQty = 1;

      await withTransaction(async (session) => {
        const released = await releaseAddonBalanceAtomically({
          subscription: staleSub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(Number(staleSub.addonBalance[0].remainingQty || 0), 2);
        assert.strictEqual(Number(staleSub.addonBalance[0].consumedQty || 0), 1);
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 3, consumedQty: 0 }, "stale local release failure");
    }

    {
      const subscription = await createSubscription([
        balance({ bucketId: mealBucket, addonId, addonPlanId: planA, category: "meal", remainingQty: 0, consumedQty: 1 }),
      ]);

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(released.reason, "bucket_not_found");
        await sub.save({ session });
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 0, consumedQty: 1 }, "category-only release");
    }

    {
      const subscription = await createSubscription([
        balance({ bucketId: mealBucket, addonId, addonPlanId: planA, category: "meal", remainingQty: 0, consumedQty: 1, unitPriceHalala: 1200, currency: "SAR" }),
      ]);

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          unitPriceHalala: 1300,
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(released.reason, "bucket_identity_mismatch");
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 0, consumedQty: 1 }, "price mismatch");

      await withTransaction(async (session) => {
        const sub = await Subscription.findById(subscription._id).session(session);
        const released = await releaseAddonBalanceAtomically({
          subscription: sub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          currency: "USD",
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(released.reason, "bucket_identity_mismatch");
      });
      await assertBucket(subscription._id, mealBucket, { remainingQty: 0, consumedQty: 1 }, "currency mismatch");
    }

    {
      const subscription = await createSubscription([
        balance({ bucketId: mealBucket, addonId, addonPlanId: planA, category: "meal", remainingQty: 0, consumedQty: 1 }),
      ]);
      const staleSub = await Subscription.findById(subscription._id);
      await Subscription.updateOne(
        { _id: subscription._id, "addonBalance._id": mealBucket },
        { $set: { "addonBalance.$.category": "snack" } }
      );

      await withTransaction(async (session) => {
        const released = await releaseAddonBalanceAtomically({
          subscription: staleSub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(released.reason, "bucket_identity_mismatch");
      });
      const updated = await Subscription.findById(subscription._id).lean();
      const bucket = getBucket(updated, mealBucket);
      assert.strictEqual(bucket.category, "snack");
      assert.strictEqual(Number(bucket.remainingQty || 0), 0);
      assert.strictEqual(Number(bucket.consumedQty || 0), 1);
    }

    {
      const subscription = await createSubscription([
        balance({ bucketId: mealBucket, addonId, addonPlanId: planA, category: "meal", remainingQty: 0, consumedQty: 1 }),
      ]);
      const staleSub = await Subscription.findById(subscription._id);
      await Subscription.updateOne({ _id: subscription._id }, { $set: { addonBalance: [] } });

      await withTransaction(async (session) => {
        const released = await releaseAddonBalanceAtomically({
          subscription: staleSub,
          addonId,
          addonPlanId: planA,
          category: "meal",
          session,
        });
        assert.strictEqual(released.released, false);
        assert.strictEqual(released.reason, "bucket_not_found");
      });
    }

    {
      const releaseCallers = [
        "src/services/dashboard/opsTransitionService.js",
        "src/services/subscription/subscriptionCancellationService.js",
        "src/services/subscription/subscriptionSelectionService.js",
      ];
      for (const relativePath of releaseCallers) {
        const source = fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
        const releaseCalls = (source.match(/releaseAddonBalanceAtomically\(/g) || []).length;
        const helperCalls = (source.match(/assertAddonBalanceReleaseSucceeded\(/g) || []).length;
        const exportedDefinitionCount = relativePath.endsWith("subscriptionSelectionService.js") ? 1 : 0;
        assert.strictEqual(
          helperCalls - exportedDefinitionCount,
          releaseCalls - exportedDefinitionCount,
          `${relativePath} must inspect every releaseAddonBalanceAtomically result`
        );
      }
    }

    console.log("Add-on balance release idempotency tests passed");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

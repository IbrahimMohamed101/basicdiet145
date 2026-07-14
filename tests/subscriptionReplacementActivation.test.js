const assert = require("assert");
const mongoose = require("mongoose");

const {
  cancelPreviousActiveSubscriptionsForReplacement,
  isDuplicateActiveSubscriptionError,
} = require("../src/services/subscription/subscriptionActivationService");

function objectId(index) {
  return Number(index).toString(16).padStart(24, "0");
}

async function run() {
  const userId = new mongoose.Types.ObjectId(objectId(101));
  const newSubscriptionId = new mongoose.Types.ObjectId(objectId(102));
  const oldSubscriptionId = new mongoose.Types.ObjectId(objectId(103));
  const session = { id: "test-session" };
  const calls = [];

  const noActiveResult = await cancelPreviousActiveSubscriptionsForReplacement({
    subscriptionPayload: { _id: newSubscriptionId, userId },
    session,
    persistence: {
      async findPreviousActiveSubscriptions(foundUserId, options) {
        calls.push(["find", String(foundUserId), options.session === session]);
        return [];
      },
      async cancelSubscriptionForReplacement() {
        throw new Error("should not cancel when no previous active subscription exists");
      },
    },
  });
  assert.deepStrictEqual(noActiveResult, []);
  assert.deepStrictEqual(calls, [["find", String(userId), true]]);

  calls.length = 0;
  const replaced = await cancelPreviousActiveSubscriptionsForReplacement({
    subscriptionPayload: { _id: newSubscriptionId, userId },
    session,
    persistence: {
      async findPreviousActiveSubscriptions(foundUserId, options) {
        calls.push(["find", String(foundUserId), String(options.excludeSubscriptionId), options.session === session]);
        return [{ _id: oldSubscriptionId }];
      },
      async cancelSubscriptionForReplacement(payload) {
        calls.push([
          "cancel",
          String(payload.subscriptionId),
          payload.reason,
          String(payload.replacedBySubscriptionId),
          payload.session === session,
        ]);
        return { outcome: "canceled", subscriptionId: String(payload.subscriptionId) };
      },
    },
  });
  assert.strictEqual(replaced.length, 1);
  assert.deepStrictEqual(calls, [
    ["find", String(userId), String(newSubscriptionId), true],
    ["cancel", String(oldSubscriptionId), "replaced_by_new_subscription", String(newSubscriptionId), true],
  ]);

  await assert.rejects(
    () => cancelPreviousActiveSubscriptionsForReplacement({
      subscriptionPayload: { _id: newSubscriptionId, userId },
      session,
      persistence: {
        async findPreviousActiveSubscriptions() {
          return [{ _id: oldSubscriptionId }];
        },
        async cancelSubscriptionForReplacement() {
          return { outcome: "invalid_transition" };
        },
      },
    }),
    (err) => err.status === 409 && err.code === "SUBSCRIPTION_REPLACEMENT_CANCEL_FAILED"
  );

  assert.strictEqual(
    isDuplicateActiveSubscriptionError({
      code: 11000,
      keyPattern: { userId: 1 },
    }),
    true
  );

  console.log("subscription replacement activation tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

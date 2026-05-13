"use strict";

require("dotenv").config();

const assert = require("assert");
const mongoose = require("mongoose");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const Setting = require("../src/models/Setting");
const dateUtils = require("../src/utils/date");
const {
  createSubscriptionPickupRequestForClient,
  getSubscriptionPickupRequestStatusForClient,
} = require("../src/services/subscription/subscriptionPickupRequestClientService");
const { resolveRestaurantOpenState } = require("../src/services/restaurantHoursService");
const { buildPickupPreparationPolicy } = require("../src/services/subscription/subscriptionPickupPreparationPolicyService");

const TEST_TAG = `pickup-request-client-${Date.now()}`;
const TEST_USER_ID = new mongoose.Types.ObjectId();
const OTHER_USER_ID = new mongoose.Types.ObjectId();
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const TODAY = dateUtils.getTodayKSADate();
const TOMORROW = dateUtils.addDaysToKSADateString(TODAY, 1);

const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function connect() {
  if (mongoose.connection.readyState !== 0) return;
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/basicdiet_test";
  await mongoose.connect(mongoUri);
}

async function cleanup() {
  const subscriptions = await Subscription.find({
    userId: { $in: [TEST_USER_ID, OTHER_USER_ID] },
    pickupLocationId: TEST_TAG,
  }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);
  await Promise.all([
    SubscriptionPickupRequest.deleteMany({ $or: [{ userId: { $in: [TEST_USER_ID, OTHER_USER_ID] } }, { subscriptionId: { $in: subscriptionIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
  ]);
}

async function upsertSetting(key, value) {
  await Setting.updateOne(
    { key },
    { $set: { value, description: `${TEST_TAG} test setting` } },
    { upsert: true }
  );
}

function buildCompleteDayFields({ status = "open", pickupRequested = false } = {}) {
  return {
    date: TODAY,
    status,
    pickupRequested,
    plannerState: "confirmed",
    planningState: "confirmed",
    selections: [new mongoose.Types.ObjectId()],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      isDraftValid: true,
      isConfirmable: true,
      confirmedAt: new Date(),
      confirmedByRole: "client",
    },
    planningMeta: {
      requiredMealCount: 1,
      selectedTotalMealCount: 1,
      isExactCountSatisfied: true,
      confirmedAt: new Date(),
      confirmedByRole: "client",
    },
  };
}

async function seedSubscription({
  deliveryMode = "pickup",
  remainingMeals = 10,
  userId = TEST_USER_ID,
} = {}) {
  return Subscription.create({
    userId,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date("2026-05-01T00:00:00Z"),
    endDate: new Date("2026-06-01T00:00:00Z"),
    validityEndDate: new Date("2026-06-01T00:00:00Z"),
    totalMeals: remainingMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode,
    pickupLocationId: TEST_TAG,
  });
}

async function seedSubscriptionWithDay({
  deliveryMode = "pickup",
  remainingMeals = 10,
  dayStatus = "open",
  pickupRequested = false,
  userId = TEST_USER_ID,
} = {}) {
  const subscription = await seedSubscription({ deliveryMode, remainingMeals, userId });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    ...buildCompleteDayFields({ status: dayStatus, pickupRequested }),
  });
  return { subscription, day };
}

async function getRemainingMeals(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).select("remainingMeals").lean();
  assert(subscription, "subscription should exist");
  return Number(subscription.remainingMeals || 0);
}

(async function run() {
  try {
    await connect();
    await cleanup();
    await Promise.all([
      upsertSetting("restaurant_is_open", true),
      upsertSetting("restaurant_open_time", "00:00"),
      upsertSetting("restaurant_close_time", "23:59"),
    ]);

    await test("creates pickup request when pickup subscription has enough balance", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10 });

      const result = await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 2,
        idempotencyKey: `${TEST_TAG}-create`,
      });

      assert(result.data.requestId, "requestId should be returned");
      assert.strictEqual(result.data.status, "locked");
      assert.strictEqual(result.data.currentStep, 2);
      assert.strictEqual(result.data.nextAction, "poll_pickup_request_status");
      assert.strictEqual(result.data.pickupCode, null);

      const request = await SubscriptionPickupRequest.findById(result.data.requestId).lean();
      assert(request, "pickup request should be persisted");
      assert.strictEqual(request.mealCount, 2);
      assert.strictEqual(request.creditsReserved, true);
      assert.strictEqual(request.snapshot.createdFrom, "client_pickup_request");
    });

    await test("does not modify SubscriptionDay.status or pickupRequested", async () => {
      const { subscription, day } = await seedSubscriptionWithDay({ remainingMeals: 10 });

      await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 2,
        idempotencyKey: `${TEST_TAG}-day-unchanged`,
      });

      const updatedDay = await SubscriptionDay.findById(day._id).lean();
      assert.strictEqual(updatedDay.status, "open");
      assert.strictEqual(Boolean(updatedDay.pickupRequested), false);
      assert.strictEqual(updatedDay.pickupCode || null, null);
    });

    await test("reserves remainingMeals correctly", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10 });

      await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 3,
      });

      assert.strictEqual(await getRemainingMeals(subscription._id), 7);
    });

    await test("blocks pickup request when restaurant is closed without creating request or reserving meals", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10 });
      await upsertSetting("restaurant_is_open", false);

      try {
        await assert.rejects(
          () => createSubscriptionPickupRequestForClient({
            userId: TEST_USER_ID,
            subscriptionId: subscription._id,
            date: TODAY,
            mealCount: 3,
            idempotencyKey: `${TEST_TAG}-closed`,
          }),
          (err) => err && err.code === "RESTAURANT_CLOSED" && err.status === 409
        );
        assert.strictEqual(await getRemainingMeals(subscription._id), 10);
        const requests = await SubscriptionPickupRequest.find({ subscriptionId: subscription._id }).lean();
        assert.strictEqual(requests.length, 0);
      } finally {
        await upsertSetting("restaurant_is_open", true);
      }
    });

    await test("status polling still works while restaurant is closed", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10 });
      const created = await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 1,
      });
      await upsertSetting("restaurant_is_open", false);
      try {
        const status = await getSubscriptionPickupRequestStatusForClient({
          userId: TEST_USER_ID,
          subscriptionId: subscription._id,
          requestId: created.data.requestId,
        });
        assert.strictEqual(status.requestId, created.data.requestId);
        assert.strictEqual(status.status, "locked");
      } finally {
        await upsertSetting("restaurant_is_open", true);
      }
    });

    await test("restaurant hours are open at openTime and closed at closeTime", async () => {
      try {
        await Promise.all([
          upsertSetting("restaurant_is_open", true),
          upsertSetting("restaurant_open_time", "10:00"),
          upsertSetting("restaurant_close_time", "23:00"),
        ]);

        const atOpen = await resolveRestaurantOpenState({ now: new Date("2026-05-13T07:00:00.000Z") });
        assert.strictEqual(atOpen.isOpenNow, true);
        const atClose = await resolveRestaurantOpenState({ now: new Date("2026-05-13T20:00:00.000Z") });
        assert.strictEqual(atClose.isOpenNow, false);
        const overnight = await resolveRestaurantOpenState({ now: new Date("2026-05-13T21:30:00.000Z") });
        await upsertSetting("restaurant_open_time", "22:00");
        await upsertSetting("restaurant_close_time", "02:00");
        const overnightOpen = await resolveRestaurantOpenState({ now: new Date("2026-05-13T21:30:00.000Z") });
        assert.strictEqual(overnight.isOpenNow, false);
        assert.strictEqual(overnightOpen.isOpenNow, true);
      } finally {
        await Promise.all([
          upsertSetting("restaurant_is_open", true),
          upsertSetting("restaurant_open_time", "00:00"),
          upsertSetting("restaurant_close_time", "23:59"),
        ]);
      }
    });

    await test("legacy pickup prepare policy is blocked when restaurant is closed", async () => {
      const { subscription, day } = await seedSubscriptionWithDay({ remainingMeals: 10 });
      const policy = buildPickupPreparationPolicy({
        subscription,
        day,
        today: TODAY,
        restaurantHours: {
          openTime: "10:00",
          closeTime: "23:00",
          isOpenNow: false,
        },
      });
      assert.strictEqual(policy.canRequestPrepare, false);
      assert.strictEqual(policy.blockReason.code, "RESTAURANT_CLOSED");
      assert.strictEqual(policy.blockReason.status, 409);
      const updatedDay = await SubscriptionDay.findById(day._id).lean();
      assert.strictEqual(updatedDay.status, "open");
      assert.strictEqual(Boolean(updatedDay.pickupRequested), false);
    });

    await test("can create multiple requests same day if balance is enough", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10 });

      const first = await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 2,
      });
      const second = await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 3,
      });

      assert.notStrictEqual(String(first.data.requestId), String(second.data.requestId));
      assert.strictEqual(await getRemainingMeals(subscription._id), 5);
    });

    await test("blocks when remainingMeals is insufficient", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 1 });

      await assert.rejects(
        () => createSubscriptionPickupRequestForClient({
          userId: TEST_USER_ID,
          subscriptionId: subscription._id,
          date: TODAY,
          mealCount: 2,
        }),
        (err) => err && err.code === "INSUFFICIENT_CREDITS"
      );

      assert.strictEqual(await getRemainingMeals(subscription._id), 1);
      const requests = await SubscriptionPickupRequest.find({ subscriptionId: subscription._id }).lean();
      assert.strictEqual(requests.length, 0);
    });

    await test("blocks courier subscription with INVALID_DELIVERY_MODE", async () => {
      const { subscription } = await seedSubscriptionWithDay({ deliveryMode: "delivery", remainingMeals: 10 });

      await assert.rejects(
        () => createSubscriptionPickupRequestForClient({
          userId: TEST_USER_ID,
          subscriptionId: subscription._id,
          date: TODAY,
          mealCount: 1,
        }),
        (err) => err && err.code === "INVALID_DELIVERY_MODE"
      );
    });

    await test("blocks invalid date", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10 });

      await assert.rejects(
        () => createSubscriptionPickupRequestForClient({
          userId: TEST_USER_ID,
          subscriptionId: subscription._id,
          date: TOMORROW,
          mealCount: 1,
        }),
        (err) => err && err.code === "INVALID_DATE"
      );
    });

    await test("idempotencyKey returns same request and does not double reserve", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10 });
      const idempotencyKey = `${TEST_TAG}-idem`;

      const first = await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 4,
        idempotencyKey,
      });
      const second = await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 4,
        idempotencyKey,
      });

      assert.strictEqual(String(first.data.requestId), String(second.data.requestId));
      assert.strictEqual(second.idempotent, true);
      assert.strictEqual(await getRemainingMeals(subscription._id), 6);
    });

    await test("old fulfilled request does not block new request if balance remains", async () => {
      const { subscription } = await seedSubscriptionWithDay({ remainingMeals: 10, dayStatus: "fulfilled" });

      await SubscriptionPickupRequest.create({
        subscriptionId: subscription._id,
        userId: TEST_USER_ID,
        date: TODAY,
        mealCount: 2,
        status: "fulfilled",
        creditsReserved: true,
        creditsReservedAt: new Date(),
        creditsConsumedAt: new Date(),
        fulfilledAt: new Date(),
      });

      const result = await createSubscriptionPickupRequestForClient({
        userId: TEST_USER_ID,
        subscriptionId: subscription._id,
        date: TODAY,
        mealCount: 2,
        idempotencyKey: `${TEST_TAG}-after-fulfilled`,
      });

      assert(result.data.requestId, "new request should be created");
      assert.strictEqual(result.data.status, "locked");
      const requests = await SubscriptionPickupRequest.find({ subscriptionId: subscription._id }).lean();
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(await getRemainingMeals(subscription._id), 8);
    });
  } finally {
    await cleanup().catch(() => {});
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  console.log(`\nResult: ${results.passed} passed, ${results.failed} failed`);
  if (results.failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

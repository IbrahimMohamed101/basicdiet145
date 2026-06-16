"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

require("dotenv").config();

const assert = require("assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

const { createApp } = require("../src/app");
const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const dateUtils = require("../src/utils/date");

const TEST_TAG = `pickup-request-routes-${Date.now()}`;
const TEST_PLAN_ID = new mongoose.Types.ObjectId();
const TODAY = dateUtils.getTodayKSADate();
const SUBSCRIPTION_START_DATE = dateUtils.addDaysToKSADateString(TODAY, -7);
const SUBSCRIPTION_END_DATE = dateUtils.addDaysToKSADateString(TODAY, 30);

const results = { passed: 0, failed: 0 };

function issueAppAccessToken(userId) {
  return jwt.sign(
    { userId: String(userId), role: "client", tokenType: "app_access" },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "31d" }
  );
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

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
  const users = await User.find({ phone: { $regex: `^${TEST_TAG}` } }).select("_id").lean();
  const userIds = users.map((user) => user._id);
  const subscriptions = await Subscription.find({ userId: { $in: userIds } }).select("_id").lean();
  const subscriptionIds = subscriptions.map((subscription) => subscription._id);
  await Promise.all([
    SubscriptionPickupRequest.deleteMany({ $or: [{ userId: { $in: userIds } }, { subscriptionId: { $in: subscriptionIds } }] }),
    SubscriptionDay.deleteMany({ subscriptionId: { $in: subscriptionIds } }),
    Subscription.deleteMany({ _id: { $in: subscriptionIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
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

async function seedUser(label) {
  return User.create({
    phone: `${TEST_TAG}-${label}`,
    name: label,
    role: "client",
    isActive: true,
  });
}

async function seedSubscriptionWithDay({
  user,
  deliveryMode = "pickup",
  remainingMeals = 10,
  dayStatus = "open",
} = {}) {
  const subscription = await Subscription.create({
    userId: user._id,
    planId: TEST_PLAN_ID,
    status: "active",
    startDate: new Date(`${SUBSCRIPTION_START_DATE}T00:00:00Z`),
    endDate: new Date(`${SUBSCRIPTION_END_DATE}T00:00:00Z`),
    validityEndDate: new Date(`${SUBSCRIPTION_END_DATE}T00:00:00Z`),
    totalMeals: remainingMeals,
    remainingMeals,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    deliveryMode,
    pickupLocationId: "main",
  });

  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    ...buildCompleteDayFields({ status: dayStatus }),
  });

  return { subscription, day };
}

function buildMealSlots(count) {
  return Array.from({ length: count }, (_, index) => ({
    slotIndex: index + 1,
    slotKey: `slot_${index + 1}`,
    status: "complete",
    selectionType: "standard_meal",
    productKey: `meal_${index + 1}`,
    confirmationSnapshot: {
      product: {
        key: `meal_${index + 1}`,
        name: {
          ar: `وجبة ${index + 1}`,
          en: `Meal ${index + 1}`,
        },
      },
    },
    isPremium: false,
    premiumSource: "none",
  }));
}

async function seedSubscriptionWithPickupItems({
  user,
  remainingMeals = 10,
} = {}) {
  const { subscription, day } = await seedSubscriptionWithDay({ user, remainingMeals });
  const addonA = new mongoose.Types.ObjectId();
  const addonB = new mongoose.Types.ObjectId();
  const addonSelections = [
    {
      addonId: addonA,
      name: { ar: "إضافة أ", en: "Addon A" },
      category: "addon",
      source: "paid",
      qty: 2,
      priceHalala: 0,
      currency: "SAR",
    },
    {
      addonId: addonB,
      name: { ar: "إضافة ب", en: "Addon B" },
      category: "addon",
      source: "paid",
      qty: 2,
      priceHalala: 0,
      currency: "SAR",
    },
  ];

  await SubscriptionDay.collection.updateOne(
    { _id: day._id },
    {
      $set: {
        plannerMeta: {
          requiredSlotCount: 3,
          completeSlotCount: 3,
          partialSlotCount: 0,
          emptySlotCount: 0,
          isDraftValid: true,
          isConfirmable: true,
          confirmedAt: new Date(),
          confirmedByRole: "client",
        },
        planningMeta: {
          requiredMealCount: 3,
          selectedTotalMealCount: 3,
          isExactCountSatisfied: true,
          confirmedAt: new Date(),
          confirmedByRole: "client",
        },
        mealSlots: buildMealSlots(3),
        addonSelections,
      },
    }
  );

  return {
    subscription,
    day,
    addonA,
    addonB,
    addonA1: `addon_${addonA}_1`,
    addonA2: `addon_${addonA}_2`,
    addonB1: `addon_${addonB}_1`,
    addonB2: `addon_${addonB}_2`,
  };
}

async function getRemainingMeals(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).select("remainingMeals").lean();
  assert(subscription, "subscription should exist");
  return Number(subscription.remainingMeals || 0);
}

function pickupItemIds(payload) {
  return (payload.pickupItems || []).map((item) => item.itemId).sort();
}

function sectionItemIds(payload, sectionKey) {
  const section = (payload.sections || []).find((row) => row.sectionKey === sectionKey);
  return ((section && section.items) || []).map((item) => item.itemId).sort();
}

(async function run() {
  try {
    await connect();
    await cleanup();

    const api = request(createApp());

    await test("POST creates request and returns requestId", async () => {
      const user = await seedUser("post-create");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 10 });

      const res = await api
        .post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({ date: TODAY, mealCount: 2, idempotencyKey: `${TEST_TAG}-post-create` });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.status, true);
      assert(res.body.data.requestId, "requestId should be returned");
      assert.strictEqual(res.body.data.status, "locked");
      assert.strictEqual(res.body.data.nextAction, "poll_pickup_request_status");
    });

    await test("POST reserves remainingMeals", async () => {
      const user = await seedUser("post-reserve");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 10 });

      const res = await api
        .post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({ date: TODAY, mealCount: 3 });

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(await getRemainingMeals(subscription._id), 7);
    });

    await test("POST supports multiple requests same day", async () => {
      const user = await seedUser("post-multiple");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 10 });

      const first = await api
        .post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({ date: TODAY, mealCount: 2 });
      const second = await api
        .post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({ date: TODAY, mealCount: 3 });

      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(second.status, 200, JSON.stringify(second.body));
      assert.notStrictEqual(first.body.data.requestId, second.body.data.requestId);
      assert.strictEqual(await getRemainingMeals(subscription._id), 5);
    });

    await test("POST blocks insufficient credits", async () => {
      const user = await seedUser("post-insufficient");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 1 });

      const res = await api
        .post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({ date: TODAY, mealCount: 2 });

      assert.strictEqual(res.status, 422, JSON.stringify(res.body));
      assert.strictEqual(res.body.error.code, "INSUFFICIENT_CREDITS");
      assert.strictEqual(await getRemainingMeals(subscription._id), 1);
    });

    await test("POST blocks courier subscription", async () => {
      const user = await seedUser("post-courier");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, deliveryMode: "delivery", remainingMeals: 10 });

      const res = await api
        .post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({ date: TODAY, mealCount: 1 });

      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(res.body.error.code, "INVALID_DELIVERY_MODE");
    });

    await test("GET list returns active requests", async () => {
      const user = await seedUser("list-active");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 10 });

      await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(auth(token)).send({ date: TODAY, mealCount: 1 });
      await api.post(`/api/subscriptions/${subscription._id}/pickup-requests`).set(auth(token)).send({ date: TODAY, mealCount: 1 });
      await SubscriptionPickupRequest.create({
        subscriptionId: subscription._id,
        userId: user._id,
        date: TODAY,
        mealCount: 1,
        status: "fulfilled",
        creditsReserved: true,
        creditsConsumedAt: new Date(),
      });

      const res = await api
        .get(`/api/subscriptions/${subscription._id}/pickup-requests?date=${TODAY}&status=active`)
        .set(auth(token));

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.requests.length, 2);
      assert(res.body.data.requests.every((row) => ["locked", "in_preparation", "ready_for_pickup"].includes(row.status)));
    });

    await test("GET status returns status for specific request", async () => {
      const user = await seedUser("status-specific");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 10 });
      const createRes = await api
        .post(`/api/subscriptions/${subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({ date: TODAY, mealCount: 2 });

      const res = await api
        .get(`/api/subscriptions/${subscription._id}/pickup-requests/${createRes.body.data.requestId}/status`)
        .set(auth(token));

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.requestId, createRes.body.data.requestId);
      assert.strictEqual(res.body.data.currentStep, 2);
      assert.strictEqual(res.body.data.status, "locked");
    });

    await test("GET status does not expose pickupCode before ready_for_pickup", async () => {
      const user = await seedUser("status-code-hidden");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 10 });
      const pickupRequest = await SubscriptionPickupRequest.create({
        subscriptionId: subscription._id,
        userId: user._id,
        date: TODAY,
        mealCount: 1,
        status: "locked",
        pickupCode: "123456",
        pickupCodeIssuedAt: new Date(),
        creditsReserved: true,
      });

      const res = await api
        .get(`/api/subscriptions/${subscription._id}/pickup-requests/${pickupRequest._id}/status`)
        .set(auth(token));

      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.data.pickupCode, null);
      assert.strictEqual(res.body.data.pickupCodeIssuedAt, null);
    });

    await test("GET status returns 404 when request does not belong to subscription", async () => {
      const user = await seedUser("status-404");
      const token = issueAppAccessToken(user._id);
      const first = await seedSubscriptionWithDay({ user, remainingMeals: 10 });
      const second = await seedSubscriptionWithDay({ user, remainingMeals: 10 });
      const pickupRequest = await SubscriptionPickupRequest.create({
        subscriptionId: first.subscription._id,
        userId: user._id,
        date: TODAY,
        mealCount: 1,
        status: "locked",
      });

      const res = await api
        .get(`/api/subscriptions/${second.subscription._id}/pickup-requests/${pickupRequest._id}/status`)
        .set(auth(token));

      assert.strictEqual(res.status, 404, JSON.stringify(res.body));
    });

    await test("GET status returns 403 when request user does not match subscription owner", async () => {
      const user = await seedUser("status-403-owner");
      const otherUser = await seedUser("status-403-other");
      const token = issueAppAccessToken(user._id);
      const { subscription } = await seedSubscriptionWithDay({ user, remainingMeals: 10 });
      const pickupRequest = await SubscriptionPickupRequest.create({
        subscriptionId: subscription._id,
        userId: otherUser._id,
        date: TODAY,
        mealCount: 1,
        status: "locked",
      });

      const res = await api
        .get(`/api/subscriptions/${subscription._id}/pickup-requests/${pickupRequest._id}/status`)
        .set(auth(token));

      assert.strictEqual(res.status, 403, JSON.stringify(res.body));
    });

    await test("pickup item selection reserves selected add-ons and default availability returns only remaining items", async () => {
      const user = await seedUser("pickup-items-addons");
      const token = issueAppAccessToken(user._id);
      const seeded = await seedSubscriptionWithPickupItems({ user, remainingMeals: 10 });
      const selectedFirst = ["slot_1", seeded.addonA1, seeded.addonB1];

      const before = await api
        .get(`/api/subscriptions/${seeded.subscription._id}/pickup-availability?date=${TODAY}`)
        .set(auth(token));
      assert.strictEqual(before.status, 200, JSON.stringify(before.body));
      assert.deepStrictEqual(
        pickupItemIds(before.body.data),
        ["slot_1", "slot_2", "slot_3", seeded.addonA1, seeded.addonA2, seeded.addonB1, seeded.addonB2].sort()
      );
      assert.strictEqual(sectionItemIds(before.body.data, "addons").length, 4);
      assert.strictEqual((before.body.data.dayAddons || []).length, 4);

      const createFirst = await api
        .post(`/api/subscriptions/${seeded.subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({
          date: TODAY,
          selectedPickupItemIds: selectedFirst,
          idempotencyKey: `${TEST_TAG}-pickup-items-addons-1`,
        });
      assert.strictEqual(createFirst.status, 200, JSON.stringify(createFirst.body));
      assert.deepStrictEqual(createFirst.body.data.selectedPickupItemIds.slice().sort(), selectedFirst.slice().sort());
      assert.strictEqual(createFirst.body.data.selectedPickupItems.length, 3);
      assert.deepStrictEqual(createFirst.body.data.selectedMealSlotIds, ["slot_1"]);
      assert.strictEqual(createFirst.body.data.mealCount, 1);
      assert.strictEqual(createFirst.body.data.addonCount, 2);
      assert.strictEqual(createFirst.body.data.itemCount, 3);
      assert.strictEqual(await getRemainingMeals(seeded.subscription._id), 9);

      const afterFirst = await api
        .get(`/api/subscriptions/${seeded.subscription._id}/pickup-availability?date=${TODAY}`)
        .set(auth(token));
      assert.strictEqual(afterFirst.status, 200, JSON.stringify(afterFirst.body));
      assert.deepStrictEqual(
        pickupItemIds(afterFirst.body.data),
        ["slot_2", "slot_3", seeded.addonA2, seeded.addonB2].sort()
      );
      assert.deepStrictEqual(sectionItemIds(afterFirst.body.data, "addons"), [seeded.addonA2, seeded.addonB2].sort());
      assert.deepStrictEqual((afterFirst.body.data.dayAddons || []).map((item) => item.itemId).sort(), [seeded.addonA2, seeded.addonB2].sort());

      const includeUnavailable = await api
        .get(`/api/subscriptions/${seeded.subscription._id}/pickup-availability?date=${TODAY}&includeUnavailable=true`)
        .set(auth(token));
      assert.strictEqual(includeUnavailable.status, 200, JSON.stringify(includeUnavailable.body));
      assert.strictEqual(includeUnavailable.body.data.pickupItems.length, 7);
      const unavailableById = new Map(includeUnavailable.body.data.pickupItems.map((item) => [item.itemId, item]));
      for (const id of selectedFirst) {
        const item = unavailableById.get(id);
        assert(item, `${id} should be present with includeUnavailable`);
        assert.strictEqual(item.availability.state, "reserved");
        assert.strictEqual(item.availability.available, false);
        assert.strictEqual(item.availability.canSelect, false);
        assert(item.availability.reservedByPickupRequestId, `${id} should carry reservedByPickupRequestId`);
      }
      assert.strictEqual(unavailableById.get(seeded.addonA1).display.statusTextAr, "تم طلب استلام هذه الإضافة بالفعل");
      assert.strictEqual(unavailableById.get(seeded.addonA1).display.statusTextEn, "This add-on has already been requested for pickup");
      assert.strictEqual(includeUnavailable.body.data.pickupItems.filter((item) => item.availability.state === "reserved").length, 3);
      assert.strictEqual(includeUnavailable.body.data.pickupItems.filter((item) => item.availability.state === "available").length, 4);

      const createSecond = await api
        .post(`/api/subscriptions/${seeded.subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({
          date: TODAY,
          selectedPickupItemIds: ["slot_2", seeded.addonA2],
          idempotencyKey: `${TEST_TAG}-pickup-items-addons-2`,
        });
      assert.strictEqual(createSecond.status, 200, JSON.stringify(createSecond.body));
      assert.strictEqual(createSecond.body.data.mealCount, 1);
      assert.strictEqual(createSecond.body.data.addonCount, 1);
      assert.strictEqual(createSecond.body.data.itemCount, 2);
      assert.strictEqual(await getRemainingMeals(seeded.subscription._id), 8);

      const afterSecond = await api
        .get(`/api/subscriptions/${seeded.subscription._id}/pickup-availability?date=${TODAY}`)
        .set(auth(token));
      assert.strictEqual(afterSecond.status, 200, JSON.stringify(afterSecond.body));
      assert.deepStrictEqual(pickupItemIds(afterSecond.body.data), ["slot_3", seeded.addonB2].sort());

      const reusedAddon = await api
        .post(`/api/subscriptions/${seeded.subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({
          date: TODAY,
          selectedPickupItemIds: [seeded.addonA1],
          idempotencyKey: `${TEST_TAG}-pickup-items-addons-reuse`,
        });
      assert.strictEqual(reusedAddon.status, 422, JSON.stringify(reusedAddon.body));
      assert.strictEqual(reusedAddon.body.error.code, "PICKUP_ITEM_UNAVAILABLE");
      assert.strictEqual(await getRemainingMeals(seeded.subscription._id), 8);
    });

    await test("selectedMealSlotIds legacy flow reserves only meal slots and leaves add-ons selectable", async () => {
      const user = await seedUser("pickup-items-legacy-slots");
      const token = issueAppAccessToken(user._id);
      const seeded = await seedSubscriptionWithPickupItems({ user, remainingMeals: 10 });

      const create = await api
        .post(`/api/subscriptions/${seeded.subscription._id}/pickup-requests`)
        .set(auth(token))
        .send({
          date: TODAY,
          selectedMealSlotIds: ["slot_1"],
          idempotencyKey: `${TEST_TAG}-pickup-items-legacy-slots`,
        });
      assert.strictEqual(create.status, 200, JSON.stringify(create.body));
      assert.deepStrictEqual(create.body.data.selectedPickupItemIds, ["slot_1"]);
      assert.strictEqual(create.body.data.mealCount, 1);
      assert.strictEqual(create.body.data.addonCount, 0);
      assert.strictEqual(create.body.data.itemCount, 1);
      assert.strictEqual(await getRemainingMeals(seeded.subscription._id), 9);

      const availability = await api
        .get(`/api/subscriptions/${seeded.subscription._id}/pickup-availability?date=${TODAY}`)
        .set(auth(token));
      assert.strictEqual(availability.status, 200, JSON.stringify(availability.body));
      assert.deepStrictEqual(
        pickupItemIds(availability.body.data),
        ["slot_2", "slot_3", seeded.addonA1, seeded.addonA2, seeded.addonB1, seeded.addonB2].sort()
      );
      assert.deepStrictEqual(
        sectionItemIds(availability.body.data, "addons"),
        [seeded.addonA1, seeded.addonA2, seeded.addonB1, seeded.addonB2].sort()
      );
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

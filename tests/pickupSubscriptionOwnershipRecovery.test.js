"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
const SubscriptionPickupRequest = require("../src/models/SubscriptionPickupRequest");
const SubscriptionDayAppendOperation = require("../src/models/SubscriptionDayAppendOperation");
const Payment = require("../src/models/Payment");
const {
  normalizedIdentityPhone,
  resolvePickupSubscriptionContext,
} = require("../src/services/subscription/subscriptionPickupOwnershipResolverService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function createUser(phone, overrides = {}) {
  return User.create({
    phone,
    phoneE164: phone,
    phoneVerified: true,
    role: "client",
    isActive: true,
    ...overrides,
  });
}

async function createSubscription(userId, overrides = {}) {
  return Subscription.create({
    userId,
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
    validityEndDate: new Date("2026-08-31T00:00:00.000Z"),
    totalMeals: 20,
    remainingMeals: 18,
    reservedMeals: 2,
    consumedMeals: 0,
    forfeitedMeals: 0,
    deliveryMode: "pickup",
    ...overrides,
  });
}

async function testExactOwnership() {
  const user = await createUser("+966511111101");
  const subscription = await createSubscription(user._id);
  const result = await resolvePickupSubscriptionContext({
    requestedSubscriptionId: subscription._id,
    userId: user._id,
    date: "2026-07-22",
  });
  assert.strictEqual(result.resolution, "exact_owner");
  assert.strictEqual(result.subscriptionId, String(subscription._id));
  assert.strictEqual(result.ownershipRecovered, false);
}

async function testStaleIdResolvesOnlyAuthenticatedUsersOwnSubscription() {
  const previousAccount = await createUser("+966511111102");
  const currentAccount = await createUser("+966511111103");
  const staleSubscription = await createSubscription(previousAccount._id);
  const currentSubscription = await createSubscription(currentAccount._id);

  const result = await resolvePickupSubscriptionContext({
    requestedSubscriptionId: staleSubscription._id,
    userId: currentAccount._id,
    date: "2026-07-22",
  });
  assert.strictEqual(result.resolution, "authenticated_current_subscription");
  assert.strictEqual(result.subscriptionId, String(currentSubscription._id));

  const unchangedStale = await Subscription.findById(staleSubscription._id).lean();
  assert.strictEqual(String(unchangedStale.userId), String(previousAccount._id));
}

async function testSamePhoneLegacyAccountTransfersAtomically() {
  const previousAccount = await createUser("0511111104", { phoneVerified: false });
  const currentAccount = await createUser("+966511111104");
  assert.strictEqual(normalizedIdentityPhone(previousAccount), "+966511111104");
  assert.strictEqual(normalizedIdentityPhone(currentAccount), "+966511111104");

  const subscription = await createSubscription(previousAccount._id);
  const dayId = oid();
  const pickupRequest = await SubscriptionPickupRequest.create({
    subscriptionId: subscription._id,
    subscriptionDayId: dayId,
    userId: previousAccount._id,
    date: "2026-07-22",
    mealCount: 1,
    selectedMealSlotIds: ["slot_1"],
    selectedPickupItemIds: ["slot_1"],
    selectionMode: "pickup_item_ids",
    status: "in_preparation",
    idempotencyKey: "legacy-owner-pickup-key",
    creditsReserved: true,
    reservationState: "reserved",
  });
  const appendOperation = await SubscriptionDayAppendOperation.create({
    subscriptionId: subscription._id,
    subscriptionDayId: dayId,
    userId: previousAccount._id,
    date: "2026-07-22",
    idempotencyKey: "legacy-owner-append-key",
    requestHash: "legacy-owner-append-hash",
    status: "completed",
    active: false,
  });
  const payment = await Payment.create({
    provider: "cash",
    type: "premium_extra_day",
    status: "paid",
    amount: 500,
    currency: "SAR",
    userId: previousAccount._id,
    subscriptionId: subscription._id,
  });

  const result = await resolvePickupSubscriptionContext({
    requestedSubscriptionId: subscription._id,
    userId: currentAccount._id,
    date: "2026-07-22",
  });
  assert.strictEqual(result.resolution, "same_phone_ownership_recovered");
  assert.strictEqual(result.ownershipRecovered, true);
  assert.strictEqual(result.subscriptionId, String(subscription._id));

  const [savedSubscription, savedRequest, savedAppend, savedPayment] = await Promise.all([
    Subscription.findById(subscription._id).lean(),
    SubscriptionPickupRequest.findById(pickupRequest._id).lean(),
    SubscriptionDayAppendOperation.findById(appendOperation._id).lean(),
    Payment.findById(payment._id).lean(),
  ]);
  assert.strictEqual(String(savedSubscription.userId), String(currentAccount._id));
  assert.strictEqual(String(savedRequest.userId), String(currentAccount._id));
  assert.strictEqual(String(savedAppend.userId), String(currentAccount._id));
  assert.strictEqual(String(savedPayment.userId), String(currentAccount._id));

  const replay = await resolvePickupSubscriptionContext({
    requestedSubscriptionId: subscription._id,
    userId: currentAccount._id,
    date: "2026-07-22",
  });
  assert.strictEqual(replay.resolution, "exact_owner");
}

async function testDifferentPhoneRemainsForbidden() {
  const previousAccount = await createUser("+966511111105");
  const currentAccount = await createUser("+966511111106");
  const subscription = await createSubscription(previousAccount._id);

  await assert.rejects(
    () => resolvePickupSubscriptionContext({
      requestedSubscriptionId: subscription._id,
      userId: currentAccount._id,
      date: "2026-07-22",
    }),
    (error) => error && error.code === "FORBIDDEN" && error.status === 403
  );

  const unchanged = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(String(unchanged.userId), String(previousAccount._id));
}

async function testSamePhoneDoesNotOverrideAnotherActiveSubscription() {
  const previousAccount = await createUser("0511111107", { phoneVerified: false });
  const currentAccount = await createUser("+966511111107");
  const legacySubscription = await createSubscription(previousAccount._id);
  const currentDeliverySubscription = await createSubscription(currentAccount._id, {
    deliveryMode: "delivery",
  });

  await assert.rejects(
    () => resolvePickupSubscriptionContext({
      requestedSubscriptionId: legacySubscription._id,
      userId: currentAccount._id,
      date: "2026-07-22",
    }),
    (error) => error
      && error.code === "SUBSCRIPTION_OWNERSHIP_RECOVERY_CONFLICT"
      && error.status === 409
  );

  const [legacySaved, currentSaved] = await Promise.all([
    Subscription.findById(legacySubscription._id).lean(),
    Subscription.findById(currentDeliverySubscription._id).lean(),
  ]);
  assert.strictEqual(String(legacySaved.userId), String(previousAccount._id));
  assert.strictEqual(String(currentSaved.userId), String(currentAccount._id));
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), {
      dbName: `pickup-ownership-${Date.now()}`,
    });

    await testExactOwnership();
    await mongoose.connection.dropDatabase();
    await testStaleIdResolvesOnlyAuthenticatedUsersOwnSubscription();
    await mongoose.connection.dropDatabase();
    await testSamePhoneLegacyAccountTransfersAtomically();
    await mongoose.connection.dropDatabase();
    await testDifferentPhoneRemainsForbidden();
    await mongoose.connection.dropDatabase();
    await testSamePhoneDoesNotOverrideAnotherActiveSubscription();

    console.log("pickup subscription ownership recovery checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

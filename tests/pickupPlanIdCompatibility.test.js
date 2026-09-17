"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../src/models/User");
const Subscription = require("../src/models/Subscription");
require("../src/services/installSubscriptionBackendRepairComposition");
const pickupService = require("../src/services/subscription/subscriptionPickupRequestClientService");
const {
  findAuthenticatedPickupSubscriptionByPlanAlias,
  resolvePickupContextForRoute,
} = require("../src/services/installPickupSubscriptionOwnershipRecovery");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function createUser(phone) {
  return User.create({
    phone,
    phoneE164: phone,
    phoneVerified: true,
    role: "client",
    isActive: true,
  });
}

async function createPickupSubscription({ userId, planId }) {
  return Subscription.create({
    userId,
    planId,
    status: "active",
    startDate: new Date("2026-07-21T21:00:00.000Z"),
    endDate: new Date("2026-07-27T21:00:00.000Z"),
    validityEndDate: new Date("2026-07-27T21:00:00.000Z"),
    totalMeals: 7,
    remainingMeals: 6,
    reservedMeals: 1,
    consumedMeals: 0,
    forfeitedMeals: 0,
    entitlementVersion: 2,
    baseMealAllocations: [{
      allocationKey: "2026-07-22:slot_1",
      dayId: oid(),
      date: "2026-07-22",
      slotKey: "slot_1",
      plannerRevisionHash: "plan-alias-test",
      quantity: 1,
      state: "reserved",
      reservedAt: new Date(),
      pickupRequestId: null,
      premiumFunding: { source: "none", state: "none", premiumKey: "" },
    }],
    premiumBalance: [],
    addonBalance: [],
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
  });
}

async function testPlanAliasResolvesAuthenticatedSubscription() {
  const user = await createUser("+966555555551");
  const planId = oid();
  const subscription = await createPickupSubscription({ userId: user._id, planId });

  const direct = await findAuthenticatedPickupSubscriptionByPlanAlias({
    planId,
    userId: user._id,
    date: "2026-07-22",
  });
  assert.ok(direct);
  assert.strictEqual(String(direct._id), String(subscription._id));
  assert.strictEqual(Number(direct.remainingMeals), 6);
  assert.strictEqual(Number(direct.reservedMeals), 1);

  const context = await resolvePickupContextForRoute({
    subscriptionId: planId,
    userId: user._id,
    date: "2026-07-22",
  });
  assert.strictEqual(context.resolution, "authenticated_plan_id_alias");
  assert.strictEqual(context.subscriptionId, String(subscription._id));
  assert.strictEqual(context.requestedPlanId, String(planId));

  const saved = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(saved.remainingMeals, 6, "identifier resolution must never debit credits");
  assert.strictEqual(saved.reservedMeals, 1);
  assert.strictEqual(saved.baseMealAllocations.length, 1);
}

async function testPlanAliasCannotCrossAccounts() {
  const owner = await createUser("+966555555552");
  const attacker = await createUser("+966555555553");
  const planId = oid();
  await createPickupSubscription({ userId: owner._id, planId });

  const direct = await findAuthenticatedPickupSubscriptionByPlanAlias({
    planId,
    userId: attacker._id,
    date: "2026-07-22",
  });
  assert.strictEqual(direct, null);

  await assert.rejects(
    () => resolvePickupContextForRoute({
      subscriptionId: planId,
      userId: attacker._id,
      date: "2026-07-22",
    }),
    (error) => error && error.code === "NOT_FOUND" && error.status === 404
  );
}

async function testProductionFunctionsExposePlanCompatibility() {
  for (const name of [
    "getPickupAvailabilityForClient",
    "createSubscriptionPickupRequestForClient",
    "listSubscriptionPickupRequestsForClient",
    "getSubscriptionPickupRequestStatusForClient",
  ]) {
    assert.strictEqual(
      pickupService[name].__pickupPlanIdCompatibility,
      true,
      `${name} must resolve Flutter plan ids before executing pickup logic`
    );
  }
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), {
      dbName: `pickup-plan-id-compat-${Date.now()}`,
    });

    await testProductionFunctionsExposePlanCompatibility();
    await testPlanAliasResolvesAuthenticatedSubscription();
    await mongoose.connection.dropDatabase();
    await testPlanAliasCannotCrossAccounts();

    console.log("pickup plan id compatibility checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

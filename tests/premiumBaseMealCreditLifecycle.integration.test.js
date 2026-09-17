"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "dashboardsecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// Load the real startup composition before reading patched service exports.
require("../src/app");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const User = require("../src/models/User");
const entitlementService = require("../src/services/subscription/subscriptionMealEntitlementService");
const premiumPaymentService = require("../src/services/subscription/premiumExtraDayPaymentService");
const {
  ensurePaidPremiumBaseMealEntitlement,
} = require("../src/services/installPaidPremiumBaseMealEntitlement");

const TEST_DB_NAME = `premium_base_credit_${Date.now()}`;
let replSet;

async function connect() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: TEST_DB_NAME },
  });
  const uri = replSet.getUri(TEST_DB_NAME);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    await mongoose.connection.db.dropDatabase();
  }
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function createCompleteDay(subscriptionId, date, {
  selectionType = "standard_meal",
  premiumSource = "none",
  premiumKey = null,
} = {}) {
  return SubscriptionDay.create({
    subscriptionId,
    date,
    status: "open",
    plannerRevisionHash: `revision:${date}`,
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType,
      isPremium: premiumSource !== "none",
      premiumSource,
      premiumKey,
      premiumExtraFeeHalala: premiumSource === "none" ? 0 : 2900,
    }],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      emptySlotCount: 0,
      partialSlotCount: 0,
      premiumSlotCount: premiumSource === "none" ? 0 : 1,
      premiumPendingPaymentCount: premiumSource === "pending_payment" ? 1 : 0,
      premiumPaidExtraCount: ["paid", "paid_extra"].includes(premiumSource) ? 1 : 0,
      isDraftValid: true,
      isConfirmable: premiumSource !== "pending_payment",
    },
    premiumUpgradeSelections: premiumSource === "none" ? [] : [{
      baseSlotKey: "slot_1",
      selectionType,
      premiumKey,
      premiumSource,
      source: ["paid", "paid_extra"].includes(premiumSource) ? "paid" : "pending_payment",
      quantity: 1,
      paidQty: premiumSource === "pending_payment" ? 1 : 1,
      coveredQty: 0,
      unitExtraFeeHalala: 2900,
      payableTotalHalala: 2900,
      currency: "SAR",
    }],
  });
}

function activeAllocations(subscription) {
  return (subscription.baseMealAllocations || []).filter((row) => (
    ["reserved", "consumed", "forfeited"].includes(String(row.state || ""))
  ));
}

async function run() {
  await connect();
  try {
    assert.strictEqual(
      premiumPaymentService.settlePaidPremiumExtraDayPayment.__paidPremiumBaseMealEntitlement,
      true,
      "paid Premium settlement export enforces the base meal entitlement invariant"
    );

    const user = await User.create({
      phone: "+966500009907",
      password: "password",
    });
    const subscription = await Subscription.create({
      userId: user._id,
      status: "active",
      planId: new mongoose.Types.ObjectId(),
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      validityEndDate: "2026-10-31",
      totalMeals: 7,
      remainingMeals: 7,
      reservedMeals: 0,
      consumedMeals: 0,
      forfeitedMeals: 0,
      entitlementVersion: 2,
      baseMealAllocations: [],
      selectedMealsPerDay: 1,
      deliveryMode: "pickup",
      premiumBalance: [],
    });

    const regularDayOne = await createCompleteDay(subscription._id, "2026-10-10");
    const regularDayTwo = await createCompleteDay(subscription._id, "2026-10-11");
    const premiumDay = await createCompleteDay(subscription._id, "2026-10-12", {
      selectionType: "premium_large_salad",
      premiumSource: "paid_extra",
      premiumKey: "premium_large_salad",
    });

    await entitlementService.reserveDayEntitlements({
      subscriptionId: subscription._id,
      day: regularDayOne,
    });
    await entitlementService.reserveDayEntitlements({
      subscriptionId: subscription._id,
      day: regularDayTwo,
    });

    let current = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(current.remainingMeals, 5, "two normal meals reduce seven credits to five");
    assert.strictEqual(current.reservedMeals, 2, "two normal meals create two reservations");
    assert.strictEqual(activeAllocations(current).length, 2, "two normal days have two active allocations");

    const paymentId = new mongoose.Types.ObjectId();
    const firstPremiumReservation = await ensurePaidPremiumBaseMealEntitlement({
      subscription: current,
      day: premiumDay,
      payment: { _id: paymentId },
    });
    assert.strictEqual(firstPremiumReservation.expectedMealCredits, 1);
    assert.strictEqual(firstPremiumReservation.allocationKeys.length, 1);

    current = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(current.remainingMeals, 4, "paid Premium upgrade also consumes one base meal credit");
    assert.strictEqual(current.reservedMeals, 3, "Premium day creates the third base reservation");
    assert.strictEqual(activeAllocations(current).length, 3, "three selected days have exactly three active allocations");

    const repeatedPremiumReservation = await ensurePaidPremiumBaseMealEntitlement({
      subscription: current,
      day: await SubscriptionDay.findById(premiumDay._id),
      payment: { _id: paymentId },
    });
    assert.deepStrictEqual(
      repeatedPremiumReservation.allocationKeys,
      firstPremiumReservation.allocationKeys,
      "repeated Premium settlement resolves the same stable day-slot allocation"
    );

    current = await Subscription.findById(subscription._id).lean();
    assert.strictEqual(current.remainingMeals, 4, "repeated payment verification never double-deducts the meal credit");
    assert.strictEqual(current.reservedMeals, 3, "repeated verification never creates an extra reservation");
    assert.strictEqual(activeAllocations(current).length, 3, "active allocations remain one per selected day");

    const persistedPremiumDay = await SubscriptionDay.findById(premiumDay._id).lean();
    assert.strictEqual(persistedPremiumDay.baseAllocationKeys.length, 1, "Premium day stores its base allocation key");
    assert.strictEqual(
      String(persistedPremiumDay.baseAllocationKeys[0]),
      firstPremiumReservation.allocationKeys[0],
      "Premium day points to the stable allocation"
    );

    console.log("premiumBaseMealCreditLifecycle.integration.test.js passed");
  } finally {
    await disconnect();
  }
}

run().catch(async (error) => {
  console.error(error && error.stack ? error.stack : error);
  try { await disconnect(); } catch (_error) {}
  process.exit(1);
});

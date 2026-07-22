"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installPaidPremiumStateConsistency");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const {
  recoverPaidPremiumDayBeforePlannerWrite,
} = require("../src/services/subscription/subscriptionPaidPremiumRecoveryService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function allocation({ dayId, slotKey, key, revision, premium = false }) {
  return {
    allocationKey: key,
    dayId,
    date: "2026-07-22",
    slotKey,
    plannerRevisionHash: revision,
    quantity: 1,
    state: "reserved",
    reservedAt: new Date(),
    premiumFunding: premium
      ? {
        source: revision === "paid-revision" ? "paid_difference" : "pending_payment",
        state: revision === "paid-revision" ? "paid" : "reserved",
        premiumKey: "shrimp",
      }
      : { source: "none", state: "none", premiumKey: "" },
  };
}

async function testExactUserShapeRepairsFromEightToEleven() {
  const userId = oid();
  const subscriptionId = oid();
  const dayId = oid();
  const currentKeys = ["paid-slot-1", "paid-slot-2", "paid-slot-3"];
  const staleKeys = ["pending-slot-1", "pending-slot-2", "pending-slot-3"];
  const rows = [];
  for (let index = 0; index < 3; index += 1) {
    const slotKey = `slot_${index + 1}`;
    rows.push(allocation({
      dayId,
      slotKey,
      key: staleKeys[index],
      revision: "pending-revision",
      premium: index === 2,
    }));
    rows.push(allocation({
      dayId,
      slotKey,
      key: currentKeys[index],
      revision: "paid-revision",
      premium: index === 2,
    }));
  }

  const subscription = await Subscription.create({
    _id: subscriptionId,
    userId,
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-21T21:00:00.000Z"),
    endDate: new Date("2026-07-27T21:00:00.000Z"),
    validityEndDate: new Date("2026-07-27T21:00:00.000Z"),
    totalMeals: 14,
    remainingMeals: 8,
    entitlementVersion: 2,
    reservedMeals: 6,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: rows,
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
    premiumSelections: [],
  });

  const payment = await Payment.create({
    provider: "moyasar",
    type: "day_planning_payment",
    status: "paid",
    applied: true,
    amount: 2000,
    currency: "SAR",
    userId,
    subscriptionId,
    providerInvoiceId: `duplicate-recovery-${Date.now()}`,
    paidAt: new Date(),
    metadata: {
      subscriptionId: String(subscriptionId),
      dayId: String(dayId),
      date: "2026-07-22",
      revisionHash: "paid-revision",
    },
  });

  await SubscriptionDay.create({
    _id: dayId,
    subscriptionId,
    date: "2026-07-22",
    status: "open",
    plannerState: "confirmed",
    planningState: "confirmed",
    plannerRevisionHash: "paid-revision",
    baseAllocationKeys: currentKeys,
    entitlementTransitionState: "reserved",
    mealSlots: [1, 2, 3].map((index) => ({
      slotIndex: index,
      slotKey: `slot_${index}`,
      status: "complete",
      selectionType: index === 3 ? "premium_meal" : "standard_meal",
      proteinId: oid(),
      carbs: [{ carbId: oid(), grams: 100 }],
      isPremium: index === 3,
      premiumKey: index === 3 ? "shrimp" : null,
      premiumSource: index === 3 ? "paid_extra" : "none",
      premiumExtraFeeHalala: index === 3 ? 2000 : 0,
    })),
    premiumExtraPayment: {
      status: "paid",
      paymentId: payment._id,
      providerInvoiceId: payment.providerInvoiceId,
      amountHalala: 2000,
      currency: "SAR",
      revisionHash: "paid-revision",
      paidAt: payment.paidAt,
    },
  });

  const result = await recoverPaidPremiumDayBeforePlannerWrite({
    subscriptionId,
    date: "2026-07-22",
  });
  assert.strictEqual(result.recovered, true);
  assert.strictEqual(result.reason, "duplicate_reservations_repaired");
  assert.strictEqual(result.duplicateRepair.applied, true);
  assert.strictEqual(result.duplicateRepair.plan.duplicateReservationCount, 3);

  const repaired = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(repaired.totalMeals, 14);
  assert.strictEqual(repaired.remainingMeals, 11);
  assert.strictEqual(repaired.reservedMeals, 3);
  assert.strictEqual(repaired.consumedMeals, 0);
  assert.strictEqual(repaired.baseMealAllocations.filter((row) => row.state === "reserved").length, 3);
  assert.strictEqual(repaired.baseMealAllocations.filter((row) => row.state === "released").length, 3);

  const replay = await recoverPaidPremiumDayBeforePlannerWrite({
    subscriptionId,
    date: "2026-07-22",
  });
  assert.strictEqual(replay.recovered, false);
  assert.strictEqual(replay.reason, "already_paid");
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `paid-premium-duplicate-recovery-${Date.now()}` });
    await testExactUserShapeRepairsFromEightToEleven();
    console.log("paid Premium duplicate reservation recovery checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

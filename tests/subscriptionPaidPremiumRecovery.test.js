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
  buildPlannerRevisionHash,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");
const {
  recoverPaidPremiumDayBeforePlannerWrite,
} = require("../src/services/subscription/subscriptionPaidPremiumRecoveryService");

function oid() {
  return new mongoose.Types.ObjectId();
}

async function createPendingDayWithPaidPayment() {
  const userId = oid();
  const proteinId = oid();
  const subscription = await Subscription.create({
    userId,
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-21T21:00:00.000Z"),
    endDate: new Date("2026-07-27T21:00:00.000Z"),
    validityEndDate: new Date("2026-07-27T21:00:00.000Z"),
    totalMeals: 14,
    remainingMeals: 11,
    entitlementVersion: 2,
    reservedMeals: 3,
    consumedMeals: 0,
    forfeitedMeals: 0,
    baseMealAllocations: [],
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
    premiumSelections: [],
  });
  const slot = {
    slotIndex: 1,
    slotKey: "slot_1",
    status: "complete",
    selectionType: "premium_meal",
    proteinId,
    carbs: [{ carbId: oid(), grams: 100 }],
    isPremium: true,
    premiumKey: "shrimp",
    premiumSource: "pending_payment",
    premiumExtraFeeHalala: 2000,
  };
  const revisionHash = buildPlannerRevisionHash({ day: { addonSelections: [] }, mealSlots: [slot] });
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: "2026-07-22",
    status: "open",
    plannerState: "draft",
    planningState: "draft",
    plannerRevisionHash: revisionHash,
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      emptySlotCount: 0,
      premiumSlotCount: 1,
      premiumPendingPaymentCount: 1,
      premiumPaidExtraCount: 0,
      premiumTotalHalala: 2000,
      isDraftValid: true,
      isConfirmable: false,
    },
    mealSlots: [slot],
    premiumUpgradeSelections: [{
      baseSlotKey: "slot_1",
      proteinId,
      premiumKey: "shrimp",
      selectionType: "premium_meal",
      premiumSource: "pending_payment",
      source: "pending_payment",
      quantity: 1,
      paidQty: 1,
      unitExtraFeeHalala: 2000,
      payableTotalHalala: 2000,
      currency: "SAR",
    }],
    premiumExtraPayment: {
      status: "pending",
      amountHalala: 2000,
      currency: "SAR",
      revisionHash,
      extraPremiumCount: 1,
      createdAt: new Date(),
    },
  });
  const payment = await Payment.create({
    provider: "moyasar",
    type: "day_planning_payment",
    status: "paid",
    applied: false,
    amount: 2000,
    currency: "SAR",
    userId,
    subscriptionId: subscription._id,
    providerInvoiceId: `recover-invoice-${Date.now()}`,
    paidAt: new Date(),
    metadata: {
      subscriptionId: String(subscription._id),
      dayId: String(day._id),
      date: day.date,
      revisionHash,
      premiumAmountHalala: 2000,
      totalHalala: 2000,
    },
  });
  day.premiumExtraPayment.paymentId = payment._id;
  day.premiumExtraPayment.providerInvoiceId = payment.providerInvoiceId;
  await day.save();
  subscription.premiumSelections = [{
    dayId: day._id,
    date: day.date,
    baseSlotKey: "slot_1",
    premiumKey: "shrimp",
    proteinId,
    selectionType: "premium_meal",
    quantity: 1,
    paidQty: 1,
    unitExtraFeeHalala: 2000,
    payableTotalHalala: 2000,
    source: "pending_payment",
  }];
  await subscription.save();
  return { subscription, day, payment };
}

async function testRecovery() {
  const { subscription, day, payment } = await createPendingDayWithPaidPayment();
  const result = await recoverPaidPremiumDayBeforePlannerWrite({
    subscriptionId: subscription._id,
    date: day.date,
  });
  assert.strictEqual(result.recovered, true);
  assert.strictEqual(result.settlement.applied, true);

  const storedDay = await SubscriptionDay.findById(day._id).lean();
  assert.strictEqual(storedDay.mealSlots[0].premiumSource, "paid_extra");
  assert.strictEqual(storedDay.premiumExtraPayment.status, "paid");
  assert.strictEqual(storedDay.premiumUpgradeSelections[0].source, "paid");

  const storedSubscription = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(storedSubscription.premiumSelections[0].source, "paid");
  assert.strictEqual(String(storedSubscription.premiumSelections[0].paymentId), String(payment._id));

  const storedPayment = await Payment.findById(payment._id).lean();
  assert.strictEqual(storedPayment.status, "paid");
  assert.strictEqual(storedPayment.applied, true);
  assert.ok(storedPayment.metadata.recoveredBeforePlannerWriteAt);

  const replay = await recoverPaidPremiumDayBeforePlannerWrite({
    subscriptionId: subscription._id,
    date: day.date,
  });
  assert.strictEqual(replay.recovered, false);
  assert.strictEqual(replay.reason, "already_paid");
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `paid-premium-recovery-${Date.now()}` });
    await testRecovery();
    console.log("paid Premium planner retry recovery checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

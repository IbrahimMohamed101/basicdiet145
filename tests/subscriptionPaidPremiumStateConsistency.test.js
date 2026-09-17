"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installPaidPremiumStateConsistency");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const premiumPaymentService = require("../src/services/subscription/premiumExtraDayPaymentService");
const {
  buildPlannerRevisionHash,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");
const {
  preservePaidPremiumSlots,
} = require("../src/services/subscription/subscriptionPaidPremiumStateService");
const {
  buildAvailabilityFromDay,
} = require("../src/services/subscription/subscriptionPickupSlotService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function pendingPremiumSlot(proteinId) {
  return {
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
}

async function createCase() {
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

  const slot = pendingPremiumSlot(proteinId);
  const revisionHash = buildPlannerRevisionHash({
    day: { addonSelections: [] },
    mealSlots: [slot],
  });
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
      quantity: 1,
      coveredQty: 0,
      paidQty: 1,
      unitExtraFeeHalala: 2000,
      payableTotalHalala: 2000,
      currency: "SAR",
      premiumSource: "pending_payment",
      source: "pending_payment",
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

  subscription.premiumSelections = [{
    dayId: day._id,
    date: day.date,
    baseSlotKey: "slot_1",
    premiumKey: "shrimp",
    proteinId,
    selectionType: "premium_meal",
    quantity: 1,
    coveredQty: 0,
    paidQty: 1,
    unitExtraFeeHalala: 2000,
    payableTotalHalala: 2000,
    currency: "SAR",
    source: "pending_payment",
    paymentId: null,
    paidAt: null,
  }];
  await subscription.save();

  const payment = await Payment.create({
    provider: "moyasar",
    type: "day_planning_payment",
    status: "paid",
    applied: true,
    amount: 2000,
    currency: "SAR",
    userId,
    subscriptionId: subscription._id,
    providerInvoiceId: `invoice-${Date.now()}`,
    paidAt: new Date("2026-07-22T15:07:20.000Z"),
    metadata: {
      subscriptionId: String(subscription._id),
      dayId: String(day._id),
      date: day.date,
      revisionHash,
      premiumAmountHalala: 2000,
      addonsAmountHalala: 0,
      totalHalala: 2000,
    },
  });

  day.premiumExtraPayment.paymentId = payment._id;
  day.premiumExtraPayment.providerInvoiceId = payment.providerInvoiceId;
  await day.save();

  return { subscription, day, payment, proteinId };
}

async function testPaidSettlementSynchronizesBothMirrors() {
  const { subscription, day, payment } = await createCase();
  const result = await premiumPaymentService.settlePaidPremiumExtraDayPayment({
    subscription,
    day,
    payment,
    session: null,
  });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.premiumStateSynchronization.synchronized, true);

  const storedDay = await SubscriptionDay.findById(day._id).lean();
  assert.strictEqual(storedDay.mealSlots[0].premiumSource, "paid_extra");
  assert.strictEqual(storedDay.premiumExtraPayment.status, "paid");
  assert.strictEqual(String(storedDay.premiumExtraPayment.paymentId), String(payment._id));
  assert.strictEqual(storedDay.plannerMeta.premiumPendingPaymentCount, 0);
  assert.strictEqual(storedDay.plannerMeta.premiumPaidExtraCount, 1);
  assert.strictEqual(storedDay.premiumUpgradeSelections.length, 1);
  assert.strictEqual(storedDay.premiumUpgradeSelections[0].source, "paid");
  assert.strictEqual(storedDay.premiumUpgradeSelections[0].premiumSource, "paid_extra");
  assert.strictEqual(String(storedDay.premiumUpgradeSelections[0].paymentId), String(payment._id));
  assert.ok(storedDay.premiumUpgradeSelections[0].paidAt);

  const storedSubscription = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(storedSubscription.premiumSelections.length, 1);
  assert.strictEqual(storedSubscription.premiumSelections[0].source, "paid");
  assert.strictEqual(String(storedSubscription.premiumSelections[0].paymentId), String(payment._id));
  assert.ok(storedSubscription.premiumSelections[0].paidAt);

  const availability = buildAvailabilityFromDay({
    day: storedDay,
    subscription: storedSubscription,
    pickupRequests: [],
    catalogMaps: {},
  });
  assert.strictEqual(availability.slots[0].available, true);
  assert.strictEqual(availability.slots[0].payment.required, false);
}

async function testIdempotentReconciliationRepairsStaleParentMirror() {
  const { subscription, day, payment } = await createCase();
  await premiumPaymentService.settlePaidPremiumExtraDayPayment({ subscription, day, payment, session: null });

  await Subscription.updateOne(
    { _id: subscription._id, "premiumSelections.dayId": day._id },
    {
      $set: {
        "premiumSelections.$.source": "pending_payment",
        "premiumSelections.$.paymentId": null,
        "premiumSelections.$.paidAt": null,
      },
    }
  );

  const paidDay = await SubscriptionDay.findById(day._id);
  const second = await premiumPaymentService.settlePaidPremiumExtraDayPayment({
    subscription: await Subscription.findById(subscription._id),
    day: paidDay,
    payment,
    session: null,
  });
  assert.strictEqual(second.applied, true);
  assert.strictEqual(second.alreadySettled, true);

  const repaired = await Subscription.findById(subscription._id).lean();
  assert.strictEqual(repaired.premiumSelections.length, 1);
  assert.strictEqual(repaired.premiumSelections[0].source, "paid");
  assert.strictEqual(String(repaired.premiumSelections[0].paymentId), String(payment._id));
}

function testFlutterOmissionCannotDowngradePaidPremium() {
  const proteinId = oid();
  const existingDay = {
    mealSlots: [{
      ...pendingPremiumSlot(proteinId),
      premiumSource: "paid_extra",
    }],
  };
  const incomingWithoutPaymentState = [{
    slotIndex: 1,
    slotKey: "slot_1",
    status: "complete",
    selectionType: "premium_meal",
    proteinId,
    carbs: [{ carbId: oid(), grams: 100 }],
    isPremium: true,
    premiumKey: "shrimp",
  }];
  const preserved = preservePaidPremiumSlots(existingDay, incomingWithoutPaymentState);
  assert.strictEqual(preserved[0].premiumSource, "paid_extra");
  assert.strictEqual(preserved[0].premiumExtraFeeHalala, 2000);

  const changedProtein = preservePaidPremiumSlots(existingDay, [{
    ...incomingWithoutPaymentState[0],
    proteinId: oid(),
  }]);
  assert.strictEqual(changedProtein[0].premiumSource, undefined);
}

function testPendingPremiumNeverBecomesPickupSelectable() {
  const proteinId = oid();
  const day = {
    _id: oid(),
    date: "2026-07-22",
    status: "open",
    plannerState: "draft",
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      premiumSlotCount: 1,
      premiumPendingPaymentCount: 1,
      premiumTotalHalala: 2000,
      isDraftValid: true,
    },
    mealSlots: [pendingPremiumSlot(proteinId)],
    addonSelections: [],
    premiumExtraPayment: {
      status: "pending",
      amountHalala: 2000,
      currency: "SAR",
    },
  };
  const availability = buildAvailabilityFromDay({ day, pickupRequests: [], subscription: {}, catalogMaps: {} });
  assert.strictEqual(availability.slots[0].available, false);
  assert.strictEqual(availability.slots[0].unavailableReason, "PREMIUM_PAYMENT_REQUIRED");
  assert.strictEqual(availability.slots[0].payment.required, true);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `paid-premium-consistency-${Date.now()}` });
    await testPaidSettlementSynchronizesBothMirrors();
    await mongoose.connection.dropDatabase();
    await testIdempotentReconciliationRepairsStaleParentMirror();
    testFlutterOmissionCannotDowngradePaidPremium();
    testPendingPremiumNeverBecomesPickupSelectable();
    console.log("paid Premium state consistency checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

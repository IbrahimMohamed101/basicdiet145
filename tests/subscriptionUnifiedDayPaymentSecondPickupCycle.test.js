"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

require("../src/services/installSubscriptionBackendRepairComposition");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const { startSafeSession } = require("../src/utils/mongoTransactionSupport");
const {
  applyCommercialStateToDay,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");
const {
  applyPaymentSideEffects,
} = require("../src/services/paymentApplicationService");
const unifiedPaymentService = require("../src/services/subscription/unifiedDayPaymentService");

function oid() {
  return new mongoose.Types.ObjectId();
}

function standardSlot(index) {
  return {
    slotIndex: index,
    slotKey: `slot_${index}`,
    status: "complete",
    selectionType: "standard_meal",
    proteinId: oid(),
    carbs: [{ carbId: oid(), grams: 100 }],
    isPremium: false,
    premiumSource: "none",
    premiumExtraFeeHalala: 0,
  };
}

function premiumSlot(index, source) {
  return {
    slotIndex: index,
    slotKey: `slot_${index}`,
    status: "complete",
    selectionType: "premium_meal",
    proteinId: oid(),
    carbs: [{ carbId: oid(), grams: 100 }],
    isPremium: true,
    premiumKey: index === 3 ? "steak" : "shrimp",
    premiumSource: source,
    premiumExtraFeeHalala: 2000,
  };
}

function allocation({ key, dayId, slotKey, revision, state, paymentId, premiumFunding }) {
  const now = new Date();
  return {
    allocationKey: key,
    dayId,
    date: "2026-07-22",
    slotKey,
    plannerRevisionHash: revision,
    quantity: 1,
    state,
    reservedAt: now,
    consumedAt: state === "consumed" ? now : null,
    paymentId: paymentId || null,
    premiumFunding: premiumFunding || {
      source: "none",
      state: "none",
      premiumKey: "",
      paymentId: null,
    },
  };
}

async function createSecondCycleCase() {
  const userId = oid();
  const subscriptionId = oid();
  const dayId = oid();
  const firstPaymentId = oid();
  const secondPaymentId = oid();
  const oldRevision = "first-pickup-paid-revision";

  const slots = [
    standardSlot(1),
    standardSlot(2),
    premiumSlot(3, "paid_extra"),
    premiumSlot(4, "pending_payment"),
  ];
  const dayShape = {
    _id: dayId,
    subscriptionId,
    date: "2026-07-22",
    status: "open",
    plannerState: "draft",
    planningState: "draft",
    mealSlots: slots,
    addonSelections: [],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 4,
      partialSlotCount: 0,
      emptySlotCount: 0,
      premiumSlotCount: 2,
      premiumPendingPaymentCount: 1,
      premiumPaidExtraCount: 1,
      premiumTotalHalala: 2000,
      isDraftValid: true,
      isConfirmable: false,
    },
    premiumExtraPayment: {
      status: "pending",
      amountHalala: 2000,
      currency: "SAR",
      extraPremiumCount: 1,
    },
  };
  const derived = applyCommercialStateToDay(dayShape);
  const currentRevision = derived.plannerRevisionHash;
  assert.ok(currentRevision, "the appended day must have a canonical revision");

  await Payment.create({
    _id: firstPaymentId,
    provider: "moyasar",
    type: "day_planning_payment",
    status: "paid",
    applied: true,
    amount: 2000,
    currency: "SAR",
    userId,
    subscriptionId,
    providerInvoiceId: `first-cycle-${Date.now()}`,
    paidAt: new Date("2026-07-22T08:00:00.000Z"),
    metadata: {
      subscriptionId: String(subscriptionId),
      dayId: String(dayId),
      date: "2026-07-22",
      revisionHash: oldRevision,
      premiumAmountHalala: 2000,
      addonsAmountHalala: 0,
      totalHalala: 2000,
      premiumSelections: [{
        slotIndex: 3,
        slotKey: "slot_3",
        selectionType: "premium_meal",
        proteinId: String(slots[2].proteinId),
        premiumKey: "steak",
        unitExtraFeeHalala: 2000,
        currency: "SAR",
      }],
    },
  });

  const oldKeys = ["first-slot-1", "first-slot-2", "first-slot-3"];
  const currentKey = "second-slot-4";
  await Subscription.create({
    _id: subscriptionId,
    userId,
    planId: oid(),
    status: "active",
    startDate: new Date("2026-07-21T21:00:00.000Z"),
    endDate: new Date("2026-07-27T21:00:00.000Z"),
    validityEndDate: new Date("2026-07-27T21:00:00.000Z"),
    totalMeals: 14,
    remainingMeals: 10,
    entitlementVersion: 2,
    reservedMeals: 1,
    consumedMeals: 3,
    forfeitedMeals: 0,
    deliveryMode: "pickup",
    pickupLocationId: "branch_1",
    baseMealAllocations: [
      allocation({ key: oldKeys[0], dayId, slotKey: "slot_1", revision: oldRevision, state: "consumed" }),
      allocation({ key: oldKeys[1], dayId, slotKey: "slot_2", revision: oldRevision, state: "consumed" }),
      allocation({
        key: oldKeys[2],
        dayId,
        slotKey: "slot_3",
        revision: oldRevision,
        state: "consumed",
        paymentId: firstPaymentId,
        premiumFunding: {
          source: "paid_difference",
          state: "consumed",
          premiumKey: "steak",
          paymentId: firstPaymentId,
        },
      }),
      allocation({
        key: currentKey,
        dayId,
        slotKey: "slot_4",
        revision: currentRevision,
        state: "reserved",
        paymentId: secondPaymentId,
        premiumFunding: {
          source: "pending_payment",
          state: "reserved",
          premiumKey: "shrimp",
          paymentId: secondPaymentId,
        },
      }),
    ],
    premiumSelections: [{
      dayId,
      date: "2026-07-22",
      baseSlotKey: "slot_3",
      premiumKey: "steak",
      proteinId: slots[2].proteinId,
      selectionType: "premium_meal",
      quantity: 1,
      paidQty: 1,
      unitExtraFeeHalala: 2000,
      payableTotalHalala: 2000,
      currency: "SAR",
      source: "paid",
      paymentId: firstPaymentId,
      paidAt: new Date("2026-07-22T08:00:00.000Z"),
    }, {
      dayId,
      date: "2026-07-22",
      baseSlotKey: "slot_4",
      premiumKey: "shrimp",
      proteinId: slots[3].proteinId,
      selectionType: "premium_meal",
      quantity: 1,
      paidQty: 1,
      unitExtraFeeHalala: 2000,
      payableTotalHalala: 2000,
      currency: "SAR",
      source: "pending_payment",
      paymentId: secondPaymentId,
    }],
  });

  const payment = await Payment.create({
    _id: secondPaymentId,
    provider: "moyasar",
    type: "day_planning_payment",
    status: "initiated",
    applied: false,
    amount: 2000,
    currency: "SAR",
    userId,
    subscriptionId,
    providerInvoiceId: `second-cycle-${Date.now()}`,
    metadata: {
      subscriptionId: String(subscriptionId),
      dayId: String(dayId),
      date: "2026-07-22",
      revisionHash: currentRevision,
      premiumAmountHalala: 2000,
      addonsAmountHalala: 0,
      totalHalala: 2000,
      premiumSelections: [{
        slotIndex: 4,
        slotKey: "slot_4",
        selectionType: "premium_meal",
        proteinId: String(slots[3].proteinId),
        premiumKey: "shrimp",
        unitExtraFeeHalala: 2000,
        currency: "SAR",
      }],
      // This is the historical broken shape: all day allocations were stored,
      // including consumed allocations from the first pickup cycle.
      baseAllocationKeys: [...oldKeys, currentKey],
    },
  });

  await SubscriptionDay.create({
    ...dayShape,
    plannerRevisionHash: currentRevision,
    baseAllocationKeys: [...oldKeys, currentKey],
    entitlementTransitionState: "reserved",
    premiumUpgradeSelections: [{
      baseSlotKey: "slot_3",
      proteinId: slots[2].proteinId,
      premiumKey: "steak",
      selectionType: "premium_meal",
      premiumSource: "paid_extra",
      source: "paid",
      quantity: 1,
      paidQty: 1,
      unitExtraFeeHalala: 2000,
      payableTotalHalala: 2000,
      currency: "SAR",
      paymentId: firstPaymentId,
      paidAt: new Date("2026-07-22T08:00:00.000Z"),
    }, {
      baseSlotKey: "slot_4",
      proteinId: slots[3].proteinId,
      premiumKey: "shrimp",
      selectionType: "premium_meal",
      premiumSource: "pending_payment",
      source: "pending_payment",
      quantity: 1,
      paidQty: 1,
      unitExtraFeeHalala: 2000,
      payableTotalHalala: 2000,
      currency: "SAR",
      paymentId: secondPaymentId,
    }],
    premiumExtraPayment: {
      status: "pending",
      amountHalala: 2000,
      currency: "SAR",
      revisionHash: currentRevision,
      extraPremiumCount: 1,
      paymentId: secondPaymentId,
      providerInvoiceId: payment.providerInvoiceId,
      createdAt: new Date(),
    },
  });

  return {
    userId,
    subscriptionId,
    dayId,
    firstPaymentId,
    secondPaymentId,
    payment,
    oldKeys,
    currentKey,
    oldRevision,
    currentRevision,
  };
}

async function verifyPaidSecondCycle(testCase) {
  return unifiedPaymentService.verifyUnifiedDayPaymentFlow({
    subscriptionId: testCase.subscriptionId,
    date: "2026-07-22",
    paymentId: testCase.secondPaymentId,
    userId: testCase.userId,
    getInvoiceFn: async () => ({
      id: testCase.payment.providerInvoiceId,
      status: "paid",
      amount: 2000,
      currency: "SAR",
      payments: [{
        id: `provider-payment-${testCase.secondPaymentId}`,
        status: "paid",
        amount: 2000,
        currency: "SAR",
      }],
    }),
    startSessionFn: startSafeSession,
    applyPaymentSideEffectsFn: applyPaymentSideEffects,
  });
}

async function testSecondPickupCycleVerification() {
  const testCase = await createSecondCycleCase();
  const result = await verifyPaidSecondCycle(testCase);
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.data.paymentStatus, "paid");
  assert.strictEqual(result.data.applied, true);
  assert.strictEqual(result.data.isFinal, true);
  assert.strictEqual(result.data.paymentRequirement.requiresPayment, false);

  const payment = await Payment.findById(testCase.secondPaymentId).lean();
  assert.strictEqual(payment.status, "paid");
  assert.strictEqual(payment.applied, true);

  const day = await SubscriptionDay.findById(testCase.dayId).lean();
  const slot3 = day.mealSlots.find((slot) => slot.slotKey === "slot_3");
  const slot4 = day.mealSlots.find((slot) => slot.slotKey === "slot_4");
  assert.strictEqual(slot3.premiumSource, "paid_extra");
  assert.strictEqual(slot4.premiumSource, "paid_extra");
  assert.strictEqual(day.premiumExtraPayment.status, "paid");
  assert.strictEqual(day.plannerMeta.premiumPendingPaymentCount, 0);

  const subscription = await Subscription.findById(testCase.subscriptionId).lean();
  const oldPremiumAllocation = subscription.baseMealAllocations.find((row) => row.allocationKey === testCase.oldKeys[2]);
  const currentPremiumAllocation = subscription.baseMealAllocations.find((row) => row.allocationKey === testCase.currentKey);
  assert.strictEqual(oldPremiumAllocation.state, "consumed");
  assert.strictEqual(oldPremiumAllocation.plannerRevisionHash, testCase.oldRevision);
  assert.strictEqual(String(oldPremiumAllocation.paymentId), String(testCase.firstPaymentId));
  assert.strictEqual(String(oldPremiumAllocation.premiumFunding.paymentId), String(testCase.firstPaymentId));
  assert.strictEqual(currentPremiumAllocation.state, "reserved");
  assert.strictEqual(currentPremiumAllocation.plannerRevisionHash, testCase.currentRevision);
  assert.strictEqual(String(currentPremiumAllocation.paymentId), String(testCase.secondPaymentId));
  assert.strictEqual(currentPremiumAllocation.premiumFunding.source, "paid_difference");
  assert.strictEqual(currentPremiumAllocation.premiumFunding.state, "paid");

  const replay = await verifyPaidSecondCycle(testCase);
  assert.strictEqual(replay.ok, true, JSON.stringify(replay));
  assert.strictEqual(replay.data.paymentStatus, "paid");
  assert.strictEqual(replay.data.applied, true);
  assert.strictEqual(replay.data.isFinal, true);
}

async function run() {
  const mongod = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongod.getUri(), { dbName: `second-pickup-cycle-${Date.now()}` });
    await testSecondPickupCycleVerification();
    console.log("second same-day pickup Premium payment cycle checks passed");
  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

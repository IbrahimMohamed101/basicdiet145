"use strict";

// Isolated MongoDB *standalone* regression: non-transactional partial writes
// survive failure, and paid-payment recovery must finalize existing records
// without granting meals or materializing days twice. No production connection.
process.env.NODE_ENV = "test";
process.env.SUBSCRIPTION_STACKING_READ_ENABLED = "true";
process.env.SUBSCRIPTION_STACKING_WRITE_ENABLED = "true";
process.env.APP_TIMEZONE = "Asia/Riyadh";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const sinon = require("sinon");
const { MongoMemoryServer } = require("mongodb-memory-server");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const SubscriptionEntitlementBatch = require("../src/models/SubscriptionEntitlementBatch");
const { startSafeSession } = require("../src/utils/mongoTransactionSupport");
const { applyPaidDraftToSubscriptionStackTransactional } = require("../src/services/subscription/subscriptionStackingPaidDraftOrchestratorService");
const { recoverPaidSubscriptionPayment } = require("../src/services/subscription/subscriptionPaymentRecoveryService");
require("../src/services/installSubscriptionStackingWriteRouter");

function ksaDate(value) {
  return new Date(`${value}T00:00:00+03:00`);
}

async function createContainer() {
  const addonId = new mongoose.Types.ObjectId();
  return Subscription.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: ksaDate("2026-08-01"),
    endDate: ksaDate("2026-08-26"),
    validityEndDate: ksaDate("2026-08-26"),
    totalMeals: 78,
    remainingMeals: 0,
    consumedMeals: 78,
    selectedMealsPerDay: 3,
    selectedGrams: 200,
    deliveryMode: "delivery",
    deliveryWindow: "13:00-15:00",
    deliverySlot: {
      type: "delivery",
      window: "13:00-15:00",
      slotId: "stacking-concurrency-slot",
      label: "13:00-15:00",
    },
    deliveryAddress: {
      city: "Riyadh",
      district: "Olaya",
      street: "Concurrency Test",
    },
    pickupLocationId: "legacy-pickup-location",
    skippedCount: 2,
    skipDaysUsed: 1,
    premiumBalance: [{
      premiumKey: "legacy-premium",
      purchasedQty: 4,
      consumedQty: 1,
      remainingQty: 3,
    }],
    addonSubscriptions: [{
      addonId,
      addonPlanId: addonId,
      category: "legacy-snack",
      includedTotalQty: 10,
      purchasedDailyQty: 1,
    }],
    addonBalance: [{
      addonId,
      addonPlanId: addonId,
      category: "legacy-snack",
      purchasedQty: 10,
      consumedQty: 2,
      remainingQty: 8,
    }],
  });
}

async function createPaidPurchase(container, suffix) {
  const planId = new mongoose.Types.ObjectId();
  const draft = await CheckoutDraft.create({
    userId: container.userId,
    planId,
    idempotencyKey: `stacking-concurrent-${suffix}`,
    requestHash: `stacking-concurrent-hash-${suffix}`,
    status: "pending_payment",
    daysCount: 30,
    grams: 150,
    mealsPerDay: 2,
    startDate: ksaDate("2026-08-06"),
    delivery: {
      type: "delivery",
      address: container.deliveryAddress,
      pickupLocationId: container.pickupLocationId,
      slot: { type: "delivery", window: "13:00-15:00", slotId: "", label: "" },
    },
    breakdown: {
      basePlanPriceHalala: 10000,
      basePlanGrossHalala: 10000,
      basePlanNetHalala: 8621,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      grossTotalHalala: 10000,
      discountHalala: 0,
      subtotalHalala: 8621,
      subtotalBeforeVatHalala: 8621,
      vatPercentage: 16,
      vatHalala: 1379,
      totalHalala: 10000,
      currency: "SAR",
    },
    contractSnapshot: {
      plan: {
        planId,
        daysCount: 30,
        mealsPerDay: 2,
        selectedGrams: 150,
        timelineExtraDays: 0,
      },
      start: { resolvedStartDate: ksaDate("2026-08-06") },
      pricing: {
        basePlanPriceHalala: 10000,
        basePlanGrossHalala: 10000,
        basePlanNetHalala: 8621,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 0,
        discountHalala: 0,
        subtotalHalala: 8621,
        subtotalBeforeVatHalala: 8621,
        vatPercentage: 16,
        vatHalala: 1379,
        totalPriceHalala: 10000,
        totalHalala: 10000,
        currency: "SAR",
      },
      delivery: {
        mode: "delivery",
        address: container.deliveryAddress,
        pickupLocationId: container.pickupLocationId,
        slot: {
          type: "delivery",
          window: "13:00-15:00",
          slotId: "stacking-concurrency-slot",
          label: "13:00-15:00",
        },
      },
    },
    contractHash: `stacking-concurrent-contract-${suffix}`,
    stackingFinalization: {
      version: "subscription_stacking.finalization.v1",
      mode: "additive_existing_parent",
      expectedParentSubscriptionId: container._id,
      decidedAt: new Date(),
    },
  });
  const payment = await Payment.create({
    provider: "moyasar",
    type: "subscription_activation",
    status: "paid",
    amount: 10000,
    currency: "SAR",
    userId: container.userId,
    providerInvoiceId: `inv_stacking_concurrent_${suffix}`,
    metadata: {
      draftId: String(draft._id),
      userId: String(container.userId),
      paymentType: "subscription_activation",
    },
  });
  return {
    draft,
    payment,
    subscriptionPayload: {
      userId: container.userId,
      planId,
      status: "active",
      startDate: ksaDate("2026-08-06"),
      endDate: ksaDate("2026-09-04"),
      validityEndDate: ksaDate("2026-09-04"),
      totalMeals: 60,
      remainingMeals: 60,
      selectedMealsPerDay: 2,
      selectedGrams: 150,
      premiumBalance: [],
      addonSubscriptions: [],
      addonBalance: [],
      deliveryMode: "delivery",
      pickupLocationId: container.pickupLocationId,
      deliveryAddress: container.deliveryAddress,
      deliveryWindow: "13:00-15:00",
      deliverySlot: {
        type: "delivery",
        window: "13:00-15:00",
        slotId: "stacking-concurrency-slot",
        label: "13:00-15:00",
      },
      basePlanPriceHalala: 10000,
      discountHalala: 0,
      subtotalHalala: 8621,
      vatHalala: 1379,
      totalPriceHalala: 10000,
      checkoutCurrency: "SAR",
    },
  };
}

async function main() {
  // Only Date is mocked; MongoDB network and lease timers remain real.
  const clock = sinon.useFakeTimers({
    now: new Date("2026-08-06T12:00:00+03:00"),
    toFake: ["Date"],
  });
  let mongod;
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), {
      dbName: "stacking_paid_draft_standalone_recovery",
      autoIndex: false,
    });
    for (const model of [Subscription, CheckoutDraft, Payment, SubscriptionDay, SubscriptionEntitlementBatch]) {
      await model.createCollection();
      await model.syncIndexes();
    }
    const container = await createContainer();
    process.env.SUBSCRIPTION_STACKING_USER_IDS = String(container.userId);
    const purchase = await createPaidPurchase(container, "paid-after-failed-invoice");
    const draftId = purchase.draft._id;
    const paymentId = purchase.payment._id;
    await CheckoutDraft.updateOne(
      { _id: draftId },
      { $set: { status: "failed", failureReason: "payment_failed", failedAt: new Date() } }
    );
    const session = await startSafeSession();
    assert.equal(session.supportsTransactions, false, "test must run against MongoDB standalone");
    try {
      const draft = await CheckoutDraft.findById(draftId).session(session);
      const payment = await Payment.findById(paymentId).session(session);
      await assert.rejects(
        () => applyPaidDraftToSubscriptionStackTransactional({
          draft,
          payment,
          businessDate: "2026-08-06",
          session,
          expectedParentSubscriptionId: container._id,
          runtime: {
            async completeStandalone() {
              const error = new Error("Injected failure after batch and days, before draft completion");
              error.code = "TEST_POST_MATERIALIZATION_FAILURE";
              throw error;
            },
          },
        }),
        (error) => error.code === "TEST_POST_MATERIALIZATION_FAILURE"
      );
    } finally {
      await session.endSession();
    }
    const sourceKey = `payment:${String(paymentId)}`;
    const readBatch = () => SubscriptionEntitlementBatch.findOne({ sourceKey }).lean();
    let batch = await readBatch();
    assert.ok(batch, "partial standalone write must have persisted the purchase batch");
    assert.equal(batch.totalMeals, 60);
    assert.equal(batch.remainingMeals, 60);
    assert.equal(await SubscriptionEntitlementBatch.countDocuments({ sourceKey }), 1);
    const firstDays = await SubscriptionDay.find({ subscriptionId: container._id })
      .select("_id date").sort({ date: 1 }).lean();
    assert.equal(firstDays.length, 30, "first attempt must persist exactly 30 purchased days");
    const firstDayIds = firstDays.map((entry) => String(entry._id));
    assert.equal((await CheckoutDraft.findById(draftId).lean()).status, "failed");

    // Simulate operational consumption that occurred before recovery.
    await SubscriptionEntitlementBatch.updateOne(
      { _id: batch._id },
      { $set: { consumedMeals: 7, remainingMeals: 53 } }
    );
    await Subscription.updateOne(
      { _id: container._id },
      { $set: { remainingMeals: 53 } }
    );
    const beforeRecovery = await readBatch();
    assert.equal(beforeRecovery.consumedMeals, 7);
    assert.equal(beforeRecovery.remainingMeals, 53);

    const recovered = await recoverPaidSubscriptionPayment(paymentId);
    assert.equal(recovered.recovered, true);
    const afterFirst = await readBatch();
    assert.equal(await SubscriptionEntitlementBatch.countDocuments({ sourceKey }), 1);
    assert.equal(afterFirst.totalMeals, 60);
    assert.equal(afterFirst.consumedMeals, 7);
    assert.equal(afterFirst.remainingMeals, 53);
    const daysAfterFirst = await SubscriptionDay.find({ subscriptionId: container._id })
      .select("_id date").sort({ date: 1 }).lean();
    assert.deepEqual(daysAfterFirst.map((entry) => String(entry._id)), firstDayIds);
    let draftAfter = await CheckoutDraft.findById(draftId).lean();
    let paymentAfter = await Payment.findById(paymentId).lean();
    assert.equal(draftAfter.status, "completed");
    assert.equal(String(draftAfter.subscriptionId), String(container._id));
    assert.equal(String(draftAfter.paymentId), String(paymentId));
    assert.equal(paymentAfter.status, "paid");
    assert.equal(paymentAfter.applied, true);
    assert.equal(String(paymentAfter.subscriptionId), String(container._id));

    const repeated = await recoverPaidSubscriptionPayment(paymentId);
    assert.equal(repeated.recovered, true);
    assert.equal(repeated.idempotent, true);
    batch = await readBatch();
    assert.equal(batch.remainingMeals, 53);
    assert.equal(batch.consumedMeals, 7);
    assert.equal(await SubscriptionEntitlementBatch.countDocuments({ sourceKey }), 1);
    assert.equal(await SubscriptionDay.countDocuments({ subscriptionId: container._id }), 30);
    draftAfter = await CheckoutDraft.findById(draftId).lean();
    paymentAfter = await Payment.findById(paymentId).lean();
    assert.equal(draftAfter.status, "completed");
    assert.equal(paymentAfter.applied, true);
    console.log("Standalone failed→paid→partial-write→recovery→replay passed: 60/7/53, 30 days, one batch");
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
    clock.restore();
    delete process.env.SUBSCRIPTION_STACKING_USER_IDS;
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

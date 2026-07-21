const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const {
  finalizeSubscriptionDraftPaymentFlow,
} = require("../src/services/subscription/subscriptionActivationService");

let replSet;

function objectId(index) {
  return Number(index).toString(16).padStart(24, "0");
}

async function createPaidDraftPayment({ userId, planId, suffix }) {
  const draft = await CheckoutDraft.create({
    userId,
    planId,
    idempotencyKey: `activation-concurrency-${suffix}`,
    requestHash: `activation-concurrency-hash-${suffix}`,
    status: "pending_payment",
    daysCount: 3,
    grams: 150,
    mealsPerDay: 1,
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    delivery: {
      type: "pickup",
      pickupLocationId: "main",
      slot: { type: "pickup", window: "", slotId: "", label: "" },
    },
    breakdown: {
      basePlanPriceHalala: 1000,
      basePlanGrossHalala: 1000,
      basePlanNetHalala: 862,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      grossTotalHalala: 1000,
      discountHalala: 0,
      subtotalHalala: 862,
      subtotalBeforeVatHalala: 862,
      vatPercentage: 16,
      vatHalala: 138,
      totalHalala: 1000,
      currency: "SAR",
    },
    contractHash: `activation-concurrency-contract-${suffix}`,
  });

  const payment = await Payment.create({
    provider: "moyasar",
    type: "subscription_activation",
    status: "paid",
    amount: 1000,
    currency: "SAR",
    userId,
    providerInvoiceId: `inv_activation_concurrency_${suffix}`,
    metadata: {
      draftId: String(draft._id),
      userId: String(userId),
      paymentType: "subscription_activation",
    },
  });

  return { draft, payment };
}

async function verifySequentialDeliveryReplacement({ userId, planId }) {
  const pickup = await createPaidDraftPayment({ userId, planId, suffix: "sequential-pickup" });
  const pickupResult = await finalizeSubscriptionDraftPaymentFlow({
    draft: pickup.draft,
    payment: pickup.payment,
  });
  assert.strictEqual(pickupResult.applied, true, "first activation succeeds without a supplied session");

  const deliveryZoneId = new mongoose.Types.ObjectId(objectId(703));
  const delivery = await createPaidDraftPayment({ userId, planId, suffix: "sequential-delivery" });
  delivery.draft.delivery = {
    type: "delivery",
    address: {
      street: "Replacement Street",
      building: "12",
      apartment: "5",
      district: "Replacement District",
      city: "Riyadh",
    },
    zoneId: deliveryZoneId,
    zoneName: "Replacement Zone",
    slot: {
      type: "delivery",
      window: "12:00-14:00",
      slotId: "delivery_slot_1",
      label: "12 PM - 2 PM",
    },
  };
  delivery.draft.contractSnapshot = {
    delivery: {
      mode: "delivery",
      address: delivery.draft.delivery.address,
      zoneId: String(deliveryZoneId),
      zoneName: "Replacement Zone",
      slot: delivery.draft.delivery.slot,
    },
  };
  await delivery.draft.save();

  const deliveryResult = await finalizeSubscriptionDraftPaymentFlow({
    draft: delivery.draft,
    payment: delivery.payment,
  });
  assert.strictEqual(deliveryResult.applied, true, "replacement delivery activation succeeds without a supplied session");

  const [oldSubscription, newSubscription] = await Promise.all([
    Subscription.findById(pickupResult.subscriptionId).lean(),
    Subscription.findById(deliveryResult.subscriptionId).lean(),
  ]);
  assert.strictEqual(oldSubscription.status, "canceled", "old subscription is hidden from active reads");
  assert.strictEqual(String(oldSubscription.replacedBySubscriptionId), deliveryResult.subscriptionId, "old subscription records its replacement");
  assert.strictEqual(newSubscription.status, "active", "replacement is the only active subscription");
  assert.strictEqual(newSubscription.deliveryMode, "delivery", "replacement keeps delivery mode");
  assert.strictEqual(newSubscription.deliveryAddress.street, "Replacement Street", "replacement keeps delivery address");
  assert.strictEqual(String(newSubscription.deliveryZoneId), String(deliveryZoneId), "replacement keeps delivery zone");
  assert.strictEqual(newSubscription.deliveryWindow, "12:00-14:00", "replacement keeps delivery window");
  assert.strictEqual(newSubscription.deliverySlot.slotId, "delivery_slot_1", "replacement keeps delivery slot");

  const activeCount = await Subscription.countDocuments({ userId, status: "active" });
  assert.strictEqual(activeCount, 1, "sequential replacement leaves exactly one active subscription");
}

async function activateInTransaction({ draftId, paymentId }) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const draft = await CheckoutDraft.findById(draftId).session(session);
      const payment = await Payment.findById(paymentId).session(session);
      const result = await finalizeSubscriptionDraftPaymentFlow({ draft, payment, session });
      await session.commitTransaction();
      return { ok: true, result, attempt };
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      const transient = err && (
        err.hasErrorLabel && err.hasErrorLabel("TransientTransactionError")
        || [24, 112, 251].includes(Number(err.code))
      );
      if (transient && attempt < 5) {
        session.endSession();
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
        continue;
      }
      session.endSession();
      return { ok: false, err, attempt };
    } finally {
      if (session && session.hasEnded !== true) {
        try {
          session.endSession();
        } catch (_) {}
      }
    }
  }
  throw new Error("unreachable");
}

async function run() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(replSet.getUri(), { dbName: "subscription_activation_concurrency" });
  await Subscription.createCollection();
  await SubscriptionDay.createCollection();
  await CheckoutDraft.createCollection();
  await Payment.createCollection();
  await Subscription.syncIndexes();
  await SubscriptionDay.syncIndexes();

  const sequentialUserId = new mongoose.Types.ObjectId(objectId(700));
  const sequentialPlanId = new mongoose.Types.ObjectId(objectId(704));
  await verifySequentialDeliveryReplacement({ userId: sequentialUserId, planId: sequentialPlanId });

  const userId = new mongoose.Types.ObjectId(objectId(701));
  const planId = new mongoose.Types.ObjectId(objectId(702));
  const first = await createPaidDraftPayment({ userId, planId, suffix: "a" });
  const second = await createPaidDraftPayment({ userId, planId, suffix: "b" });

  const results = await Promise.all([
    activateInTransaction({ draftId: first.draft._id, paymentId: first.payment._id }),
    activateInTransaction({ draftId: second.draft._id, paymentId: second.payment._id }),
  ]);

  const activeCount = await Subscription.countDocuments({ userId, status: "active" });
  const canceledCount = await Subscription.countDocuments({ userId, status: "canceled" });
  const totalSubs = await Subscription.countDocuments({ userId });
  const dayCount = await SubscriptionDay.countDocuments({});

  if (activeCount !== 1) {
    console.error(JSON.stringify({
      results: results.map((entry) => entry.ok
        ? { ok: true, result: entry.result }
        : { ok: false, code: entry.err && entry.err.code, message: entry.err && entry.err.message }),
      activeCount,
      canceledCount,
      totalSubs,
      dayCount,
    }, null, 2));
  }

  assert.strictEqual(activeCount, 1, "concurrent paid activations leave exactly one active subscription");
  assert.strictEqual(totalSubs, 2, "both paid activations remain as accounting history");
  assert.strictEqual(canceledCount, 1, "the superseded activation is canceled");
  assert.strictEqual(dayCount, 3, "cancellation policy removes superseded future open days");
  assert(results.every((entry) => entry.ok), "both retried paid activations complete");

  await mongoose.disconnect();
  await replSet.stop();
  console.log("subscription activation concurrency tests passed");
}

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  if (replSet) {
    try {
      await replSet.stop();
    } catch (_) {}
  }
  process.exit(1);
});

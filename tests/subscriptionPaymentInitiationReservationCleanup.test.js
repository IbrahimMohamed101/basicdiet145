"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "payment-init-cleanup-test-secret";

const assert = require("node:assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const {
  buildDayCommercialState,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");
const {
  checkEntitlementInvariants,
} = require("../src/services/subscription/subscriptionMealEntitlementService");
const {
  createUnifiedDayPaymentFlow,
} = require("../src/services/subscription/unifiedDayPaymentService");
const dateUtils = require("../src/utils/date");

const DB_PREFIX = "codex_subscription_entitlement_audit_";
const DB_NAME = `${DB_PREFIX}${Date.now()}`;
const BUSINESS_DATE = dateUtils.getTodayKSADate();
const START_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, -1);
const SELECTION_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, 3);
const END_DATE = dateUtils.addDaysToKSADateString(BUSINESS_DATE, 30);

let mongoServer;

function asDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function premiumCommercialDay() {
  const raw = {
    status: "open",
    plannerState: "draft",
    mealSlots: [{
      slotIndex: 1,
      slotKey: "slot_1",
      status: "complete",
      selectionType: "premium_meal",
      proteinId: new mongoose.Types.ObjectId(),
      carbs: [{ carbId: new mongoose.Types.ObjectId(), grams: 150 }],
      isPremium: true,
      premiumKey: "salmon",
      premiumSource: "pending_payment",
      premiumExtraFeeHalala: 1800,
    }],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      premiumSlotCount: 1,
      premiumPendingPaymentCount: 1,
      premiumCoveredByBalanceCount: 0,
      premiumPaidExtraCount: 0,
      premiumTotalHalala: 1800,
      isDraftValid: true,
    },
    addonSelections: [],
    premiumExtraPayment: { status: "none" },
  };
  return { ...raw, ...buildDayCommercialState(raw) };
}

async function seedPayableDay() {
  const userId = new mongoose.Types.ObjectId();
  const subscription = await Subscription.create({
    userId,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    startDate: asDate(START_DATE),
    endDate: asDate(END_DATE),
    validityEndDate: asDate(END_DATE),
    totalMeals: 1,
    remainingMeals: 1,
    selectedGrams: 200,
    selectedMealsPerDay: 1,
    contractMode: "canonical",
    deliveryMode: "delivery",
    deliveryAddress: { line1: "test" },
    deliveryWindow: "13:00-16:00",
  });
  const commercial = premiumCommercialDay();
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date: SELECTION_DATE,
    status: "open",
    plannerState: "draft",
    mealSlots: commercial.mealSlots,
    plannerMeta: commercial.plannerMeta,
    plannerRevisionHash: commercial.plannerRevisionHash,
    premiumExtraPayment: commercial.premiumExtraPayment,
    addonSelections: [],
  });
  return { subscription, day };
}

function runtime(overrides = {}) {
  return {
    createInvoice: async ({ amount, metadata }) => ({
      id: `inv_${new mongoose.Types.ObjectId()}`,
      status: "initiated",
      amount,
      currency: "SAR",
      url: "https://payment.invalid/test",
      metadata,
    }),
    parseOperationIdempotencyKey: () => "",
    buildOperationRequestHash: () => "",
    compareIdempotentRequest: () => "reuse",
    findPaymentByOperationKey: async () => null,
    findReusableInitiatedPaymentByHash: async () => null,
    createPayment: async (payload) => Payment.create(payload),
    ...overrides,
  };
}

async function createPayment(subscription, day, runtimeOverrides) {
  return createUnifiedDayPaymentFlow({
    subscriptionId: subscription._id,
    date: day.date,
    userId: subscription.userId,
    lang: "en",
    headers: {},
    body: { plannerRevisionHash: day.plannerRevisionHash },
    runtime: runtime(runtimeOverrides),
    ensureActiveFn: () => {},
  });
}

async function assertReservationReleased(subscriptionId) {
  const subscription = await Subscription.findById(subscriptionId).lean();
  assert.strictEqual(subscription.entitlementVersion, 2);
  assert.strictEqual(subscription.remainingMeals, 1);
  assert.strictEqual(subscription.reservedMeals, 0);
  assert.strictEqual(subscription.consumedMeals, 0);
  assert.strictEqual(subscription.forfeitedMeals, 0);
  assert.strictEqual(subscription.baseMealAllocations.length, 1);
  assert.strictEqual(subscription.baseMealAllocations[0].state, "released");
  assert(subscription.baseMealAllocations[0].releasedAt);
  assert.strictEqual(checkEntitlementInvariants(subscription).valid, true);
}

async function resetDatabase() {
  assert(mongoose.connection.name.startsWith(DB_PREFIX));
  await mongoose.connection.db.dropDatabase();
}

async function run() {
  mongoServer = await MongoMemoryServer.create({ instance: { dbName: DB_NAME } });
  await mongoose.connect(mongoServer.getUri(DB_NAME), { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  assert.strictEqual(Boolean(hello.setName || hello.msg === "isdbgrid"), false);

  {
    const { subscription, day } = await seedPayableDay();
    const result = await createPayment(subscription, day, {
      createInvoice: async ({ amount, metadata }) => ({
        id: `inv_${new mongoose.Types.ObjectId()}`,
        status: "initiated",
        amount,
        currency: "USD",
        url: "https://payment.invalid/test",
        metadata,
      }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "CONFIG");
    await assertReservationReleased(subscription._id);
    assert.strictEqual(await Payment.countDocuments({ subscriptionId: subscription._id }), 0);
  }

  await resetDatabase();

  {
    const { subscription, day } = await seedPayableDay();
    const result = await createPayment(subscription, day, {
      createPayment: async () => {
        throw new Error("simulated payment persistence failure");
      },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "PAYMENT_PERSISTENCE_ERROR");
    await assertReservationReleased(subscription._id);
    assert.strictEqual(await Payment.countDocuments({ subscriptionId: subscription._id }), 0);
  }

  await resetDatabase();

  {
    const { subscription, day } = await seedPayableDay();
    const originalUpdateOne = SubscriptionDay.updateOne;
    let updateCalls = 0;
    SubscriptionDay.updateOne = function patchedUpdateOne(...args) {
      updateCalls += 1;
      if (updateCalls === 2) {
        return Promise.reject(new Error("simulated day payment-link failure"));
      }
      return originalUpdateOne.apply(this, args);
    };

    try {
      const result = await createPayment(subscription, day, {});
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, "PAYMENT_PERSISTENCE_ERROR");
    } finally {
      SubscriptionDay.updateOne = originalUpdateOne;
    }

    await assertReservationReleased(subscription._id);
    const storedPayment = await Payment.findOne({ subscriptionId: subscription._id }).lean();
    assert(storedPayment);
    assert.strictEqual(storedPayment.status, "failed");
    assert.strictEqual(storedPayment.applied, false);
  }

  console.log("subscriptionPaymentInitiationReservationCleanup.test.js passed");
}

run()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      assert(mongoose.connection.name.startsWith(DB_PREFIX));
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    if (mongoServer) await mongoServer.stop();
  });

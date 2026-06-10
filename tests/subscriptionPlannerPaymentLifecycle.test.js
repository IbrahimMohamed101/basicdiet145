process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Payment = require("../src/models/Payment");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const {
  buildDayCommercialState,
} = require("../src/services/subscription/subscriptionDayCommercialStateService");
const {
  isPaymentSuperseded,
  supersedeInitiatedDayPlanningPaymentsForRevisionChange,
} = require("../src/services/subscription/subscriptionDayPaymentLifecycleService");
const {
  verifyUnifiedDayPaymentFlow,
} = require("../src/services/subscription/unifiedDayPaymentService");
const {
  assertSubscriptionDayModifiable,
} = require("../src/services/subscription/subscriptionDayModificationPolicyService");

let mongoServer;

async function connect() {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri(`subscription_phase3_payment_lifecycle_${Date.now()}`);
  process.env.MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

function premiumDay(amountHalala) {
  const hasPremium = Number(amountHalala || 0) > 0;
  return {
    status: "open",
    plannerState: "draft",
    mealSlots: [
      {
        slotIndex: 1,
        slotKey: "slot_1",
        status: "complete",
        selectionType: hasPremium ? "premium_meal" : "standard_meal",
        proteinId: new mongoose.Types.ObjectId(),
        carbs: [{ carbId: new mongoose.Types.ObjectId(), grams: 150 }],
        isPremium: hasPremium,
        premiumKey: hasPremium ? "premium_meal" : null,
        premiumSource: hasPremium ? "pending_payment" : "none",
        premiumExtraFeeHalala: Number(amountHalala || 0),
      },
    ],
    plannerMeta: {
      requiredSlotCount: 1,
      completeSlotCount: 1,
      partialSlotCount: 0,
      premiumSlotCount: hasPremium ? 1 : 0,
      premiumPendingPaymentCount: hasPremium ? 1 : 0,
      premiumCoveredByBalanceCount: 0,
      premiumPaidExtraCount: 0,
      premiumTotalHalala: Number(amountHalala || 0),
      isDraftValid: true,
    },
    addonSelections: [],
    premiumExtraPayment: { status: "none" },
  };
}

function addonDay(amountHalala) {
  return {
    ...premiumDay(0),
    addonSelections: Number(amountHalala || 0) > 0
      ? [{
        addonId: new mongoose.Types.ObjectId(),
        name: "Juice",
        category: "juice",
        source: "pending_payment",
        priceHalala: Number(amountHalala || 0),
        currency: "SAR",
      }]
      : [],
  };
}

function amountDue(day) {
  return Number(buildDayCommercialState(day).paymentRequirement.amountHalala || 0);
}

async function createSubscriptionFixture() {
  const userId = new mongoose.Types.ObjectId();
  const subscription = await Subscription.create({
    userId,
    planId: new mongoose.Types.ObjectId(),
    status: "active",
    totalMeals: 10,
    remainingMeals: 10,
    selectedMealsPerDay: 1,
    deliveryMode: "pickup",
    startDate: new Date("2099-01-01T00:00:00.000Z"),
    endDate: new Date("2099-01-10T00:00:00.000Z"),
    validityEndDate: new Date("2099-01-10T00:00:00.000Z"),
  });
  const date = "2099-01-02";
  const pendingDay = premiumDay(3000);
  const shapedDay = buildDayCommercialState(pendingDay);
  const day = await SubscriptionDay.create({
    subscriptionId: subscription._id,
    date,
    status: "open",
    plannerState: "draft",
    mealSlots: pendingDay.mealSlots,
    plannerMeta: pendingDay.plannerMeta,
    plannerRevisionHash: shapedDay.plannerRevisionHash,
    premiumExtraPayment: shapedDay.premiumExtraPayment,
    addonSelections: [],
  });
  return { userId, subscription, day, date };
}

async function createPayment({ subscription, day, userId, amount, revisionHash, status = "initiated", applied = false }) {
  return Payment.create({
    provider: "moyasar",
    type: "day_planning_payment",
    status,
    applied,
    amount,
    currency: "SAR",
    userId,
    subscriptionId: subscription._id,
    providerInvoiceId: `inv_${new mongoose.Types.ObjectId().toString()}`,
    metadata: {
      type: "day_planning_payment",
      subscriptionId: String(subscription._id),
      userId: String(userId),
      dayId: String(day._id),
      date: day.date,
      revisionHash,
      premiumAmountHalala: amount,
      addonsAmountHalala: 0,
      totalHalala: amount,
      premiumSelections: [],
      oneTimeAddonSelections: [],
      currency: "SAR",
    },
  });
}

async function verifyOldPayment({ subscription, day, userId, payment }) {
  return verifyUnifiedDayPaymentFlow({
    subscriptionId: subscription._id,
    date: day.date,
    paymentId: payment._id,
    userId,
    getInvoiceFn: async () => {
      throw new Error("superseded payment must be rejected before provider fetch");
    },
    startSessionFn: async () => {
      throw new Error("superseded payment must be rejected before session");
    },
    applyPaymentSideEffectsFn: async () => {
      throw new Error("superseded payment must not apply side effects");
    },
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}`);
    throw err;
  }
}

async function main() {
  await connect();
  try {
    await test("edit to free removes active payment requirement and supersedes old initiated payment", async () => {
      const fixture = await createSubscriptionFixture();
      const oldPayment = await createPayment({
        ...fixture,
        amount: 3000,
        revisionHash: fixture.day.plannerRevisionHash,
      });
      const freeState = buildDayCommercialState(premiumDay(0));
      assert.strictEqual(freeState.paymentRequirement.requiresPayment, false);
      assert.strictEqual(freeState.paymentRequirement.amountHalala, 0);

      await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
        subscriptionId: fixture.subscription._id,
        dayId: fixture.day._id,
        date: fixture.date,
        nextRevisionHash: freeState.plannerRevisionHash,
        reason: "planner_selection_changed",
      });

      const refreshed = await Payment.findById(oldPayment._id).lean();
      assert.strictEqual(refreshed.metadata.isSuperseded, true);
      assert.strictEqual(refreshed.metadata.supersededByRevisionHash, freeState.plannerRevisionHash);

      const verifyResult = await verifyOldPayment({ ...fixture, payment: oldPayment });
      assert.strictEqual(verifyResult.ok, false);
      assert.strictEqual(verifyResult.status, 409);
      assert.strictEqual(verifyResult.code, "DAY_PAYMENT_REVISION_MISMATCH");
    });

    await test("30 to 50 supersedes old initiated payment and recalculates amount due", async () => {
      const fixture = await createSubscriptionFixture();
      const oldPayment = await createPayment({ ...fixture, amount: 3000, revisionHash: fixture.day.plannerRevisionHash });
      const nextState = buildDayCommercialState(premiumDay(5000));
      assert.strictEqual(nextState.paymentRequirement.requiresPayment, true);
      assert.strictEqual(nextState.paymentRequirement.amountHalala, 5000);
      await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
        subscriptionId: fixture.subscription._id,
        dayId: fixture.day._id,
        date: fixture.date,
        nextRevisionHash: nextState.plannerRevisionHash,
      });
      assert.strictEqual(isPaymentSuperseded(await Payment.findById(oldPayment._id).lean()), true);
    });

    await test("30 to 15 supersedes old initiated payment and recalculates amount due", async () => {
      const fixture = await createSubscriptionFixture();
      const oldPayment = await createPayment({ ...fixture, amount: 3000, revisionHash: fixture.day.plannerRevisionHash });
      const nextState = buildDayCommercialState(premiumDay(1500));
      assert.strictEqual(nextState.paymentRequirement.amountHalala, 1500);
      await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
        subscriptionId: fixture.subscription._id,
        dayId: fixture.day._id,
        date: fixture.date,
        nextRevisionHash: nextState.plannerRevisionHash,
      });
      assert.strictEqual(isPaymentSuperseded(await Payment.findById(oldPayment._id).lean()), true);
    });

    await test("unchanged selection does not supersede matching initiated payment", async () => {
      const fixture = await createSubscriptionFixture();
      const payment = await createPayment({ ...fixture, amount: 3000, revisionHash: fixture.day.plannerRevisionHash });
      const result = await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
        subscriptionId: fixture.subscription._id,
        dayId: fixture.day._id,
        date: fixture.date,
        nextRevisionHash: fixture.day.plannerRevisionHash,
      });
      const refreshed = await Payment.findById(payment._id).lean();
      assert.strictEqual(result.supersededCount, 0);
      assert.strictEqual(Boolean(refreshed.metadata.isSuperseded), false);
    });

    await test("pending unpaid payment does not block day modification policy", async () => {
      const fixture = await createSubscriptionFixture();
      const result = await assertSubscriptionDayModifiable({
        subscription: { deliveryMode: "pickup" },
        day: {
          status: "open",
          premiumExtraPayment: { status: "pending" },
        },
        date: fixture.date,
        getBusinessDateFn: async () => "2099-01-01",
      });
      assert.strictEqual(result.allowed, true);
    });

    await test("paid payment is not superseded", async () => {
      const fixture = await createSubscriptionFixture();
      const paid = await createPayment({
        ...fixture,
        amount: 3000,
        revisionHash: fixture.day.plannerRevisionHash,
        status: "paid",
        applied: true,
      });
      const nextState = buildDayCommercialState(premiumDay(0));
      await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
        subscriptionId: fixture.subscription._id,
        dayId: fixture.day._id,
        date: fixture.date,
        nextRevisionHash: nextState.plannerRevisionHash,
      });
      assert.strictEqual(isPaymentSuperseded(await Payment.findById(paid._id).lean()), false);
    });

    await test("add-on-only unified payment is superseded on stale revision", async () => {
      const fixture = await createSubscriptionFixture();
      const addonState = buildDayCommercialState(addonDay(3000));
      const addonPayment = await createPayment({
        ...fixture,
        amount: 3000,
        revisionHash: addonState.plannerRevisionHash,
      });
      addonPayment.metadata.premiumAmountHalala = 0;
      addonPayment.metadata.addonsAmountHalala = 3000;
      addonPayment.metadata.oneTimeAddonSelections = [{ addonId: String(new mongoose.Types.ObjectId()), priceHalala: 3000, currency: "SAR" }];
      await addonPayment.save();

      const cheaperAddonState = buildDayCommercialState(addonDay(1500));
      assert.strictEqual(amountDue(addonDay(1500)), 1500);
      await supersedeInitiatedDayPlanningPaymentsForRevisionChange({
        subscriptionId: fixture.subscription._id,
        dayId: fixture.day._id,
        date: fixture.date,
        nextRevisionHash: cheaperAddonState.plannerRevisionHash,
      });
      assert.strictEqual(isPaymentSuperseded(await Payment.findById(addonPayment._id).lean()), true);
    });

    console.log("subscription planner payment lifecycle tests passed");
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await disconnect(); } catch (_err) {}
  process.exit(1);
});

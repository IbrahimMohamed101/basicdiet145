const assert = require("node:assert");
const mongoose = require("mongoose");
const sinon = require("sinon");

const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const { verifyUnifiedDayPaymentFlow } = require("../src/services/subscription/unifiedDayPaymentService");

function buildSession() {
  return {
    startTransaction: sinon.stub(),
    commitTransaction: sinon.stub().resolves(),
    abortTransaction: sinon.stub().resolves(),
    endSession: sinon.stub(),
    inTransaction: () => true,
  };
}

function query({ leanValue, sessionValue = leanValue }) {
  return {
    lean: () => Promise.resolve(leanValue),
    session: () => Promise.resolve(sessionValue),
  };
}

function buildFixture(overrides = {}) {
  const subscriptionId = overrides.subscriptionId || new mongoose.Types.ObjectId();
  const userId = overrides.userId || new mongoose.Types.ObjectId();
  const dayId = overrides.dayId || new mongoose.Types.ObjectId();
  const paymentId = overrides.paymentId || new mongoose.Types.ObjectId();
  const date = overrides.date || "2026-05-05";
  const providerInvoiceId = overrides.providerInvoiceId || "inv_unified_day";

  const subscription = {
    _id: subscriptionId,
    userId,
    status: "active",
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    totalMeals: 30,
    remainingMeals: 17,
    selectedMealsPerDay: 2,
  };
  const day = {
    _id: dayId,
    subscriptionId,
    date,
    status: "open",
    mealSlots: [],
    addonSelections: [],
    premiumExtraPayment: { status: "none" },
  };
  const payment = {
    _id: paymentId,
    provider: "moyasar",
    type: "day_planning_payment",
    status: "initiated",
    applied: false,
    amount: 2000,
    currency: "SAR",
    userId,
    subscriptionId,
    providerInvoiceId,
    metadata: {
      subscriptionId: String(subscriptionId),
      userId: String(userId),
      dayId: String(dayId),
      date,
      totalHalala: 2000,
      premiumAmountHalala: 0,
      addonsAmountHalala: 2000,
      oneTimeAddonSelections: [],
    },
    ...overrides.payment,
  };
  return { subscriptionId, userId, dayId, paymentId, date, providerInvoiceId, subscription, day, payment };
}

function stubCommonReads(sandbox, fixture, { payment = fixture.payment, day = fixture.day, sessionPayment = null, latestPayment = null } = {}) {
  sandbox.stub(Subscription, "findById").returns(query({ leanValue: fixture.subscription }));
  sandbox.stub(SubscriptionDay, "findById").returns(query({
    leanValue: day,
    sessionValue: { ...day, save: sinon.stub().resolves(), markModified: sinon.stub() },
  }));
  sandbox.stub(SubscriptionDay, "findOne").returns(query({
    leanValue: day,
    sessionValue: { ...day, save: sinon.stub().resolves(), markModified: sinon.stub() },
  }));

  const paymentDoc = sessionPayment || {
    ...payment,
    save: sinon.stub().resolves(),
    markModified: sinon.stub(),
  };
  const paymentFindOne = sandbox.stub(Payment, "findOne");
  paymentFindOne.onFirstCall().returns(query({ leanValue: payment }));
  paymentFindOne.callsFake(() => query({ leanValue: payment, sessionValue: paymentDoc }));
  sandbox.stub(Payment, "findById").returns(query({ leanValue: latestPayment || paymentDoc }));
  sandbox.stub(Payment, "findOneAndUpdate").resolves({ ...paymentDoc, status: "paid", applied: true });
  sandbox.stub(Payment, "updateOne").resolves({ matchedCount: 1, modifiedCount: 1 });
  return { paymentDoc };
}

async function runVerify(fixture, overrides = {}) {
  return verifyUnifiedDayPaymentFlow({
    subscriptionId: fixture.subscriptionId,
    date: fixture.date,
    paymentId: fixture.paymentId,
    userId: overrides.userId || fixture.userId,
    getInvoiceFn: overrides.getInvoiceFn || (async () => ({
      id: fixture.providerInvoiceId,
      status: "paid",
      amount: fixture.payment.amount,
      currency: "SAR",
      payments: [{ id: "pay_unified_day", status: "paid", amount: fixture.payment.amount, currency: "SAR" }],
    })),
    startSessionFn: overrides.startSessionFn || (async () => buildSession()),
    applyPaymentSideEffectsFn: overrides.applyPaymentSideEffectsFn || sinon.stub().resolves({ applied: true }),
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

(async function main() {
  await test("valid paid invoice verifies successfully", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture();
      stubCommonReads(sandbox, fixture, { latestPayment: { ...fixture.payment, status: "paid", applied: true } });
      const applyPaymentSideEffectsFn = sinon.stub().resolves({ applied: true });
      const result = await runVerify(fixture, { applyPaymentSideEffectsFn });
      assert.strictEqual(result.ok, true, JSON.stringify(result));
      assert.strictEqual(result.data.paymentStatus, "paid");
      assert.strictEqual(result.data.applied, true);
      assert.strictEqual(result.data.isFinal, true);
      assert.strictEqual(applyPaymentSideEffectsFn.callCount, 1);
    } finally {
      sandbox.restore();
    }
  });

  await test("pending invoice returns non-final pending response", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture();
      stubCommonReads(sandbox, fixture);
      const applyPaymentSideEffectsFn = sinon.stub().resolves({ applied: true });
      const result = await runVerify(fixture, {
        applyPaymentSideEffectsFn,
        getInvoiceFn: async () => ({
          id: fixture.providerInvoiceId,
          status: "pending",
          amount: fixture.payment.amount,
          currency: "SAR",
          payments: [],
        }),
      });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data.paymentStatus, "initiated");
      assert.strictEqual(result.data.isFinal, false);
      assert.strictEqual(applyPaymentSideEffectsFn.callCount, 0);
    } finally {
      sandbox.restore();
    }
  });

  await test("missing payment returns 404 PAYMENT_NOT_FOUND", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture();
      sandbox.stub(Subscription, "findById").returns(query({ leanValue: fixture.subscription }));
      sandbox.stub(Payment, "findOne").returns(query({ leanValue: null }));
      const result = await runVerify(fixture, {
        getInvoiceFn: async () => { throw new Error("provider should not be called"); },
      });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 404);
      assert.strictEqual(result.code, "PAYMENT_NOT_FOUND");
    } finally {
      sandbox.restore();
    }
  });

  await test("payment not owned by user returns 404 PAYMENT_NOT_FOUND", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture();
      sandbox.stub(Subscription, "findById").returns(query({ leanValue: fixture.subscription }));
      sandbox.stub(Payment, "findOne").returns(query({ leanValue: null }));
      const result = await runVerify(fixture, {
        getInvoiceFn: async () => { throw new Error("provider should not be called"); },
      });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 404);
      assert.strictEqual(result.code, "PAYMENT_NOT_FOUND");
    } finally {
      sandbox.restore();
    }
  });

  await test("payment not matching subscription day returns 409 MISMATCH", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture();
      const mismatchedDay = {
        ...fixture.day,
        _id: fixture.dayId,
        subscriptionId: fixture.subscriptionId,
        date: "2026-05-06",
      };
      stubCommonReads(sandbox, fixture, { day: mismatchedDay });
      const result = await runVerify(fixture, {
        getInvoiceFn: async () => { throw new Error("provider should not be called"); },
      });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.code, "MISMATCH");
    } finally {
      sandbox.restore();
    }
  });

  await test("provider error returns PAYMENT_PROVIDER_ERROR", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture();
      stubCommonReads(sandbox, fixture);
      const result = await runVerify(fixture, {
        getInvoiceFn: async () => { throw new Error("provider unavailable"); },
      });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 502);
      assert.strictEqual(result.code, "PAYMENT_PROVIDER_ERROR");
    } finally {
      sandbox.restore();
    }
  });

  await test("repeated verify is idempotent", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture({ payment: { status: "paid", applied: true } });
      stubCommonReads(sandbox, fixture);
      const getInvoiceFn = sinon.stub().rejects(new Error("provider should not be called"));
      const result = await runVerify(fixture, { getInvoiceFn });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data.paymentStatus, "paid");
      assert.strictEqual(result.data.checkedProvider, false);
      assert.strictEqual(getInvoiceFn.callCount, 0);
    } finally {
      sandbox.restore();
    }
  });

  await test("verify does not mutate remainingMeals", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture();
      const before = fixture.subscription.remainingMeals;
      stubCommonReads(sandbox, fixture);
      const result = await runVerify(fixture);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(fixture.subscription.remainingMeals, before);
    } finally {
      sandbox.restore();
    }
  });

  await test("expired payment returns clear 409 instead of INTERNAL", async () => {
    const sandbox = sinon.createSandbox();
    try {
      const fixture = buildFixture({ payment: { status: "expired", applied: false } });
      stubCommonReads(sandbox, fixture);
      const result = await runVerify(fixture, {
        getInvoiceFn: async () => { throw new Error("provider should not be called"); },
      });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 409);
      assert.strictEqual(result.code, "PAYMENT_EXPIRED");
    } finally {
      sandbox.restore();
    }
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

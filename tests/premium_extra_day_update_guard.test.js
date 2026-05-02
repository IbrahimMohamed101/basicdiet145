const assert = require("node:assert");
const mongoose = require("mongoose");
const sinon = require("sinon");

const commercialService = require("../src/services/subscription/subscriptionDayCommercialStateService");

sinon.stub(commercialService, "applyCommercialStateToDay").callsFake((day) => {
  const d = day && typeof day.toObject === "function" ? day.toObject() : (day || {});
  const premiumExtraPayment = {
    status: "required",
    extraPremiumCount: 1,
    amountHalala: 2000,
    createdAt: new Date("2026-05-10T00:00:00.000Z"),
    ...(d.premiumExtraPayment || {}),
  };
  return {
    ...d,
    paymentRequirement: { requiresPayment: true, canCreatePayment: true },
    plannerRevisionHash: "premium-extra-rev",
    commercialState: { test: true },
    premiumSummary: { pendingPaymentCount: 1 },
    premiumExtraPayment,
  };
});

const modificationPolicy = require("../src/services/subscription/subscriptionDayModificationPolicyService");
sinon.stub(modificationPolicy, "assertSubscriptionDayModifiable").resolves();

const {
  createPremiumExtraDayPaymentFlow,
  verifyPremiumExtraDayPaymentFlow,
} = require("../src/services/subscription/premiumExtraDayPaymentService");
const Subscription = require("../src/models/Subscription");
const SubscriptionDay = require("../src/models/SubscriptionDay");
const Payment = require("../src/models/Payment");
const loggerUtils = require("../src/utils/logger");

sinon.stub(loggerUtils.logger, "error").callsFake(() => {});

function buildFixture() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();

  return {
    subscriptionId,
    userId,
    dayId,
    paymentId,
    subscription: {
      _id: subscriptionId,
      userId,
      status: "active",
      planId: { mealsPerDay: 3 },
    },
    day: {
      _id: dayId,
      subscriptionId,
      date: "2026-05-10",
      status: "open",
      plannerRevisionHash: "premium-extra-rev",
      premiumExtraPayment: {
        status: "required",
        revisionHash: "premium-extra-rev",
        paymentId: null,
        amountHalala: 2000,
        extraPremiumCount: 1,
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
      },
      toObject() {
        return { ...this };
      },
    },
    payment: {
      _id: paymentId,
      id: String(paymentId),
      status: "initiated",
      applied: false,
      providerInvoiceId: "inv_premium_extra",
      amount: 2000,
      currency: "SAR",
      metadata: { paymentUrl: "https://pay.test/premium-extra", totalHalala: 2000 },
    },
  };
}

async function runFlow({ updateResult, latestDay, updateRejects = null } = {}) {
  const fixture = buildFixture();
  const sandbox = sinon.createSandbox();
  const resolvedLatestDay = typeof latestDay === "function" ? latestDay(fixture) : latestDay;

  sandbox.stub(Subscription, "findById").resolves(fixture.subscription);
  sandbox.stub(SubscriptionDay, "findOne").resolves(fixture.day);
  const dayFindByIdStub = sandbox.stub(SubscriptionDay, "findById").returns({
    lean: () => Promise.resolve(resolvedLatestDay || null),
  });
  const updateOneStub = sandbox.stub(SubscriptionDay, "updateOne");
  if (updateRejects) updateOneStub.rejects(updateRejects);
  else updateOneStub.resolves(updateResult);

  sandbox.stub(Payment, "findById").returns({
    lean: () => Promise.resolve(null),
  });
  const paymentUpdateStub = sandbox.stub(Payment, "updateOne").resolves({ modifiedCount: 1 });

  const runtime = {
    createInvoice: sinon.stub().resolves({
      id: "inv_premium_extra",
      url: "https://pay.test/premium-extra",
      currency: "SAR",
      metadata: {},
    }),
    createPayment: sinon.stub().resolves(fixture.payment),
    parseOperationIdempotencyKey: () => "",
    buildOperationRequestHash: () => "premium-extra-request-hash",
    findPaymentByOperationKey: sinon.stub().resolves(null),
    findReusableInitiatedPaymentByHash: sinon.stub().resolves(null),
    compareIdempotentRequest: () => "reuse",
  };

  const result = await createPremiumExtraDayPaymentFlow({
    subscriptionId: fixture.subscriptionId,
    date: "2026-05-10",
    userId: fixture.userId,
    lang: "en",
    headers: {},
    body: {},
    runtime,
    ensureActiveFn: () => {},
  });

  return {
    result,
    fixture,
    runtime,
    updateOneStub,
    paymentUpdateStub,
    dayFindByIdStub,
    cleanup: () => sandbox.restore(),
  };
}

function assertMarkedFailed(paymentUpdateStub, reason) {
  assert.strictEqual(paymentUpdateStub.callCount, 1, "Payment should be marked unusable");
  const update = paymentUpdateStub.firstCall.args[1].$set;
  assert.strictEqual(update.status, "failed");
  assert.strictEqual(update.applied, false);
  assert.strictEqual(update.metadata.initiationFailureReason, reason);
}

async function runPaidButUnappliedVerifyTest() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const providerInvoiceId = "inv_premium_extra_paid";
  const sandbox = sinon.createSandbox();
  const fakeSession = {
    startTransaction: sandbox.stub(),
    commitTransaction: sandbox.stub().resolves(),
    abortTransaction: sandbox.stub().resolves(),
    endSession: sandbox.stub(),
    inTransaction: () => true,
  };
  const subscription = { _id: subscriptionId, userId, planId: { mealsPerDay: 3 } };
  const payment = {
    _id: paymentId,
    subscriptionId,
    userId,
    type: "premium_extra_day",
    status: "initiated",
    applied: false,
    amount: 2000,
    currency: "SAR",
    providerInvoiceId,
    metadata: {
      subscriptionId: String(subscriptionId),
      dayId: String(dayId),
      date: "2026-05-10",
      revisionHash: "old-rev",
    },
  };
  const paymentDoc = {
    ...payment,
    paidAt: null,
    save: sandbox.stub().resolves(),
    markModified: sandbox.stub(),
  };
  const day = {
    _id: dayId,
    subscriptionId,
    date: "2026-05-10",
    status: "open",
    mealSlots: [],
    premiumExtraPayment: {
      status: "pending",
      paymentId,
      providerInvoiceId,
      revisionHash: "new-rev",
      amountHalala: 2000,
    },
    save: sandbox.stub().resolves(),
  };

  try {
    sandbox.stub(mongoose, "startSession").resolves(fakeSession);
    sandbox.stub(Subscription, "findById").returns({ lean: () => Promise.resolve(subscription) });
    sandbox.stub(Payment, "findOne").returns({ lean: () => Promise.resolve(payment), session: () => Promise.resolve(paymentDoc) });
    sandbox.stub(SubscriptionDay, "findById").returns({
      lean: () => Promise.resolve(day),
      session: () => Promise.resolve(day),
    });

    const result = await verifyPremiumExtraDayPaymentFlow({
      subscriptionId,
      date: "2026-05-10",
      paymentId,
      userId,
      getInvoiceFn: sandbox.stub().resolves({
        id: providerInvoiceId,
        status: "paid",
        amount: 2000,
        currency: "SAR",
        payments: [{ id: "provider_pay_1", status: "paid", amount: 2000, currency: "SAR" }],
      }),
      writeLogFn: sandbox.stub().resolves(),
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, "PREMIUM_EXTRA_REVISION_MISMATCH");
    assert.strictEqual(paymentDoc.status, "paid");
    assert.strictEqual(paymentDoc.applied, false);
    assert.strictEqual(paymentDoc.metadata.unappliedReason, "revision_mismatch");
    assert.strictEqual(paymentDoc.markModified.calledWith("metadata"), true);
    assert.strictEqual(paymentDoc.save.callCount, 2);
    console.log("✅ premium_extra_verify_paid_but_unapplied_should_remain_applied_false passed");
  } finally {
    sandbox.restore();
  }
}

async function run() {
  let flow = await runFlow({
    updateResult: { matchedCount: 1, modifiedCount: 0 },
    latestDay: {
      premiumExtraPayment: {
        status: "pending",
        paymentId: new mongoose.Types.ObjectId(),
        providerInvoiceId: "inv_other",
        revisionHash: "premium-extra-rev",
      },
    },
  });
  assert.strictEqual(flow.result.ok, false);
  assert.strictEqual(flow.result.code, "PAYMENT_PERSISTENCE_ERROR");
  assert.strictEqual(flow.runtime.createInvoice.callCount, 1);
  assert.strictEqual(flow.runtime.createPayment.callCount, 1);
  assertMarkedFailed(flow.paymentUpdateStub, "premium_extra_day_update_failed");
  assert.ok(!flow.result.data || !flow.result.data.payment_url);
  console.log("✅ premium_extra_day_update_failure_marks_payment_failed_without_payment_url passed");
  flow.cleanup();

  flow = await runFlow({
    updateResult: { matchedCount: 0, modifiedCount: 0 },
  });
  assert.strictEqual(flow.result.ok, false);
  assert.strictEqual(flow.result.code, "PAYMENT_PERSISTENCE_ERROR");
  assert.strictEqual(flow.runtime.createInvoice.callCount, 1);
  assert.strictEqual(flow.runtime.createPayment.callCount, 1);
  assertMarkedFailed(flow.paymentUpdateStub, "premium_extra_day_not_open");
  assert.ok(!flow.result.data || !flow.result.data.payment_url);
  console.log("✅ premium_extra_day_not_open_marks_payment_failed_without_payment_url passed");
  flow.cleanup();

  flow = await runFlow({
    updateResult: { matchedCount: 1, modifiedCount: 0 },
    latestDay: (fixture) => ({
      premiumExtraPayment: {
        status: "pending",
        paymentId: fixture.paymentId,
        providerInvoiceId: "inv_premium_extra",
        revisionHash: "premium-extra-rev",
      },
    }),
  });
  assert.strictEqual(flow.result.ok, true);
  assert.strictEqual(flow.result.status, 201);
  assert.strictEqual(flow.result.data.payment_url, "https://pay.test/premium-extra");
  assert.strictEqual(flow.paymentUpdateStub.callCount, 0);
  console.log("✅ premium_extra_day_noop_update_matching_payment_is_not_failed passed");
  flow.cleanup();

  flow = await runFlow({
    updateRejects: new Error("write failed"),
  });
  assert.strictEqual(flow.result.ok, false);
  assert.strictEqual(flow.result.code, "PAYMENT_PERSISTENCE_ERROR");
  assertMarkedFailed(flow.paymentUpdateStub, "premium_extra_day_update_failed");
  assert.ok(!flow.result.data || !flow.result.data.payment_url);
  console.log("✅ premium_extra_day_update_exception_marks_payment_failed_without_payment_url passed");
  flow.cleanup();

  await runPaidButUnappliedVerifyTest();

  console.log("✅ Premium extra day update guard tests passed");
}

run().catch((err) => {
  console.error("❌ Premium extra day update guard tests failed");
  console.error(err);
  process.exitCode = 1;
});

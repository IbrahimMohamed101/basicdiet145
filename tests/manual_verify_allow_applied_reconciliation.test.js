const assert = require("node:assert");
const mongoose = require("mongoose");
const sinon = require("sinon");

async function run() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const providerInvoiceId = "inv_unified_paid";
  const fakeSession = {
    startTransaction: sinon.stub(),
    commitTransaction: sinon.stub().resolves(),
    abortTransaction: sinon.stub().resolves(),
    endSession: sinon.stub(),
    inTransaction: () => false,
  };
  const subscription = { _id: subscriptionId, userId, planId: { mealsPerDay: 3 } };
  const day = {
    _id: dayId,
    subscriptionId,
    date: "2026-05-10",
    status: "open",
    mealSlots: [],
    addonSelections: [],
    premiumExtraPayment: { status: "none" },
  };
  const payment = {
    _id: paymentId,
    subscriptionId,
    userId,
    type: "day_planning_payment",
    status: "initiated",
    applied: false,
    amount: 2000,
    currency: "SAR",
    providerInvoiceId,
    metadata: {
      subscriptionId: String(subscriptionId),
      dayId: String(dayId),
      date: "2026-05-10",
      totalHalala: 2000,
    },
  };
  const paymentDoc = {
    ...payment,
    paidAt: null,
    save: sinon.stub().resolves(),
  };
  const claimedPayment = { ...paymentDoc, status: "paid", applied: true };

  const Subscription = require("../src/models/Subscription");
  const SubscriptionDay = require("../src/models/SubscriptionDay");
  const Payment = require("../src/models/Payment");
  const { verifyUnifiedDayPaymentFlow } = require("../src/services/subscription/unifiedDayPaymentService");

  const sandbox = sinon.createSandbox();
  sandbox.stub(Subscription, "findById").returns({ lean: () => Promise.resolve(subscription) });
  sandbox.stub(SubscriptionDay, "findById").returns({ lean: () => Promise.resolve(day) });
  const paymentFindOneStub = sandbox.stub(Payment, "findOne");
  paymentFindOneStub.onFirstCall().returns({ lean: () => Promise.resolve(payment) });
  paymentFindOneStub.onSecondCall().returns({ session: () => Promise.resolve(paymentDoc) });
  sandbox.stub(Payment, "findOneAndUpdate").resolves(claimedPayment);
  sandbox.stub(Payment, "findById").returns({ lean: () => Promise.resolve(claimedPayment) });
  const applyPaymentSideEffectsFn = sinon.stub().resolves({ applied: true });

  try {
    const result = await verifyUnifiedDayPaymentFlow({
      subscriptionId,
      date: "2026-05-10",
      paymentId,
      userId,
      getInvoiceFn: sinon.stub().resolves({
        id: providerInvoiceId,
        status: "paid",
        amount: 2000,
        currency: "SAR",
        payments: [{ id: "provider_pay_1", status: "paid", amount: 2000, currency: "SAR" }],
      }),
      startSessionFn: sinon.stub().resolves(fakeSession),
      applyPaymentSideEffectsFn,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(applyPaymentSideEffectsFn.firstCall.args[0].source, "client_manual_verify");
    assert.strictEqual(applyPaymentSideEffectsFn.firstCall.args[0].allowAppliedReconciliation, true);
    console.log("✅ manual_verify_should_pass_allow_applied_reconciliation passed");
  } finally {
    sandbox.restore();
  }
}

run().catch((err) => {
  console.error("❌ manual verify allowAppliedReconciliation test failed");
  console.error(err);
  process.exit(1);
});

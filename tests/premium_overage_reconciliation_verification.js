const assert = require("node:assert");
const mongoose = require("mongoose");
const sinon = require("sinon");

async function run() {
  const subscriptionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const dayId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const providerInvoiceId = "inv_overage_paid";
  const fakeSession = {
    startTransaction: sinon.stub(),
    commitTransaction: sinon.stub().resolves(),
    abortTransaction: sinon.stub().resolves(),
    endSession: sinon.stub(),
    inTransaction: () => false,
  };

  const subscription = { _id: subscriptionId, userId };
  const day = {
    _id: dayId,
    subscriptionId,
    date: "2026-05-10",
    premiumOverageCount: 1,
    premiumOverageStatus: "pending",
  };
  const payment = {
    _id: paymentId,
    subscriptionId,
    userId,
    type: "premium_overage_day",
    status: "initiated",
    applied: false,
    amount: 1000,
    currency: "SAR",
    providerInvoiceId,
    metadata: {
      subscriptionId: String(subscriptionId),
      dayId: String(dayId),
      date: "2026-05-10",
    },
  };
  const paymentDoc = {
    ...payment,
    paidAt: null,
    save: sinon.stub().resolves(),
  };
  const claimedPayment = { ...paymentDoc, applied: true, status: "paid" };

  const Subscription = require("../src/models/Subscription");
  const SubscriptionDay = require("../src/models/SubscriptionDay");
  const Payment = require("../src/models/Payment");
  const { verifyPremiumOverageDayPaymentFlow } = require("../src/services/subscription/premiumOverageDayPaymentService");

  const sandbox = sinon.createSandbox();
  sandbox.stub(Subscription, "findById").returns({ lean: () => Promise.resolve(subscription) });
  sandbox.stub(Subscription, "findOne").returns({ session: () => Promise.resolve(subscription) });
  sandbox.stub(SubscriptionDay, "findById").returns({
    lean: () => Promise.resolve(day),
    session: () => Promise.resolve(day),
  });
  const paymentFindOneStub = sandbox.stub(Payment, "findOne");
  paymentFindOneStub.onFirstCall().returns({ lean: () => Promise.resolve(payment) });
  paymentFindOneStub.onSecondCall().returns({ session: () => Promise.resolve(paymentDoc) });
  sandbox.stub(Payment, "findOneAndUpdate").resolves(claimedPayment);
  const paymentUpdateStub = sandbox.stub(Payment, "updateOne").resolves({ modifiedCount: 1 });
  sandbox.stub(Payment, "findById").returns({ lean: () => Promise.resolve({ ...payment, status: "paid", applied: false }) });

  try {
    const applyPaymentSideEffectsFn = sinon.stub().resolves({ applied: false, reason: "day_not_open:locked" });
    const result = await verifyPremiumOverageDayPaymentFlow({
      subscriptionId,
      date: "2026-05-10",
      paymentId,
      userId,
      getInvoiceFn: sinon.stub().resolves({
        id: providerInvoiceId,
        status: "paid",
        amount: 1000,
        currency: "SAR",
        payments: [{ id: "provider_pay_1", status: "paid", amount: 1000, currency: "SAR" }],
      }),
      startSessionFn: sinon.stub().resolves(fakeSession),
      applyPaymentSideEffectsFn,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(applyPaymentSideEffectsFn.firstCall.args[0].allowAppliedReconciliation, true);
    assert.strictEqual(paymentUpdateStub.callCount, 1);
    assert.deepStrictEqual(paymentUpdateStub.firstCall.args[1].$set, {
      applied: false,
      status: "paid",
      metadata: {
        ...claimedPayment.metadata,
        unappliedReason: "day_not_open:locked",
      },
    });
    console.log("✅ premium_overage_verify_paid_but_unapplied_should_remain_applied_false passed");
  } finally {
    sandbox.restore();
  }
}

run().catch((err) => {
  console.error("❌ Premium overage reconciliation verification failed");
  console.error(err);
  process.exit(1);
});

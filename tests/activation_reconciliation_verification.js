const assert = require("node:assert");
const mongoose = require("mongoose");
const sinon = require("sinon");

async function paid_activation_payment_with_applied_false_can_be_reconciled() {
  const paymentId = new mongoose.Types.ObjectId();
  const draftId = new mongoose.Types.ObjectId();
  const providerInvoiceId = "inv_activation_paid";
  const fakeSession = {
    inTransaction: () => false,
  };
  const existingPayment = {
    _id: paymentId,
    type: "subscription_activation",
    status: "paid",
    applied: false,
    provider: "moyasar",
    providerInvoiceId,
    amount: 1000,
    currency: "SAR",
    metadata: {
      draftId: String(draftId),
      redirectContext: {
        token: "redirect-token",
        paymentType: "subscription_activation",
        draftId: String(draftId),
        successRedirectUrl: "https://example.test/success",
        cancelRedirectUrl: "https://example.test/cancel",
      },
    },
  };
  const paymentDoc = {
    ...existingPayment,
    paidAt: null,
    toObject() {
      return { ...this };
    },
  };
  const claimedPayment = {
    ...paymentDoc,
    applied: true,
    status: "paid",
    paidAt: new Date(),
    toObject() {
      return { ...this };
    },
  };

  const moyasarService = require("../src/services/moyasarService");
  const paymentApplicationService = require("../src/services/paymentApplicationService");
  const mongoRetryService = require("../src/services/mongoTransactionRetryService");
  const Payment = require("../src/models/Payment");

  const sandbox = sinon.createSandbox();
  sandbox.stub(moyasarService, "getInvoice").resolves({
    id: providerInvoiceId,
    amount: 1000,
    currency: "SAR",
    status: "paid",
    payments: [{ id: "pay_provider_1", status: "paid", amount: 1000, currency: "SAR" }],
  });
  const applyStub = sandbox.stub(paymentApplicationService, "applyPaymentSideEffects").resolves({
    applied: true,
    subscriptionId: String(new mongoose.Types.ObjectId()),
  });
  sandbox.stub(mongoRetryService, "runMongoTransactionWithRetry").callsFake((fn) => fn(fakeSession, { attempt: 0 }));
  sandbox.stub(Payment, "findOne").returns({
    sort: () => ({
      lean: () => Promise.resolve(existingPayment),
    }),
  });
  const findByIdStub = sandbox.stub(Payment, "findById");
  findByIdStub.returns({
    session: () => Promise.resolve(paymentDoc),
  });
  sandbox.stub(Payment, "findOneAndUpdate").resolves(claimedPayment);

  delete require.cache[require.resolve("../src/services/paymentFlowService")];
  const { synchronizePaymentForRedirect } = require("../src/services/paymentFlowService");

  try {
    const result = await synchronizePaymentForRedirect({
      payment_type: "subscription_activation",
      token: "redirect-token",
      draft_id: String(draftId),
    }, { source: "activation_reconciliation_test" });

    assert.strictEqual(result.paymentStatus, "paid");
    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.businessApplied, true);
    assert.strictEqual(applyStub.callCount, 1);
    assert.strictEqual(String(applyStub.firstCall.args[0].payment._id), String(paymentId));
  } finally {
    sandbox.restore();
    delete require.cache[require.resolve("../src/services/paymentFlowService")];
  }
}

async function activation_reconciliation_does_not_duplicate_subscription_days() {
  const draftId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const subscriptionId = new mongoose.Types.ObjectId();
  const paymentId = new mongoose.Types.ObjectId();
  const session = {};
  const draft = {
    _id: draftId,
    userId,
    status: "completed",
    subscriptionId,
    paymentId,
    save: sinon.stub().resolves(),
  };
  const payment = {
    _id: paymentId,
    userId,
    subscriptionId: null,
    providerInvoiceId: "inv_existing",
    save: sinon.stub().resolves(),
  };
  const activateSubscriptionFromCanonicalDraft = sinon.stub().throws(new Error("should not activate twice"));

  const Subscription = require("../src/models/Subscription");
  const { finalizeSubscriptionDraftPaymentFlow } = require("../src/services/subscription/subscriptionActivationService");
  const findByIdStub = sinon.stub(Subscription, "findById").returns({
    session: () => Promise.resolve({ _id: subscriptionId }),
  });

  try {
    const result = await finalizeSubscriptionDraftPaymentFlow(
      { draft, payment, session },
      { activateSubscriptionFromCanonicalDraft }
    );

    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.subscriptionId, String(subscriptionId));
    assert.strictEqual(activateSubscriptionFromCanonicalDraft.callCount, 0);
    assert.strictEqual(payment.save.callCount, 1);
    assert.strictEqual(String(payment.subscriptionId), String(subscriptionId));
  } finally {
    findByIdStub.restore();
  }
}

async function run() {
  await paid_activation_payment_with_applied_false_can_be_reconciled();
  console.log("✅ paid_activation_payment_with_applied_false_can_be_reconciled passed");
  await activation_reconciliation_does_not_duplicate_subscription_days();
  console.log("✅ activation_reconciliation_does_not_duplicate_subscription_days passed");
}

run().catch((err) => {
  console.error("❌ Activation reconciliation verification failed");
  console.error(err);
  process.exit(1);
});

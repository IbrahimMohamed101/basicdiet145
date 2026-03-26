const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { reconcileCheckoutDraft, RECONCILE_MODES } = require("../src/services/reconciliationService");
const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");

function objectId() {
  return new mongoose.Types.ObjectId();
}

test("Subscription Reconciliation Service (Mocked)", async (t) => {
  const userId = objectId();
  const draftId = objectId();
  const paymentId = objectId();

  await t.test("should heal a broken draft connection if an orphan payment exists", async () => {
    const mockDraft = {
      _id: draftId,
      userId,
      status: "pending_payment",
      save: async () => {},
      session: function() { return this; }
    };

    const mockPayment = {
      _id: paymentId,
      userId,
      amount: 100,
      currency: "SAR",
      type: "subscription_activation",
      provider: "moyasar",
      status: "initiated",
      metadata: { draftId: String(draftId) },
      session: function() { return this; }
    };

    const originalDraftFindById = CheckoutDraft.findById;
    const originalPaymentFindById = Payment.findById;
    const originalPaymentFindOne = Payment.findOne;
    const originalDraftUpdateOne = CheckoutDraft.updateOne;

    CheckoutDraft.findById = () => ({ session: () => Promise.resolve(mockDraft) });
    Payment.findById = () => ({ session: () => Promise.resolve(null) });
    Payment.findOne = () => ({ sort: () => ({ session: () => Promise.resolve(mockPayment) }) });
    
    // We expect draft.paymentId to be updated
    const result = await reconcileCheckoutDraft(draftId, { mode: RECONCILE_MODES.PERSIST });
    
    assert.strictEqual(result.draft.paymentId, paymentId);
    
    // Restore
    CheckoutDraft.findById = originalDraftFindById;
    Payment.findById = originalPaymentFindById;
    Payment.findOne = originalPaymentFindOne;
    CheckoutDraft.updateOne = originalDraftUpdateOne;
  });

  await t.test("should sync with provider if payment status is initiated", async () => {
    const mockDraft = {
      _id: draftId,
      userId,
      status: "pending_payment",
      paymentId,
      providerInvoiceId: "inv_123",
      save: async () => {},
      session: function() { return this; }
    };

    const mockPayment = {
      _id: paymentId,
      userId,
      amount: 100,
      currency: "SAR",
      type: "subscription_activation",
      provider: "moyasar",
      providerInvoiceId: "inv_123",
      status: "initiated",
      save: async () => {},
      session: function() { return this; }
    };

    const mockInvoice = {
      id: "inv_123",
      status: "captured",
      amount: 10000,
      currency: "SAR",
      payments: [{ id: "pay_123", status: "captured", amount: 10000, currency: "SAR" }],
    };

    const originalDraftFindById = CheckoutDraft.findById;
    const originalPaymentFindById = Payment.findById;

    CheckoutDraft.findById = () => ({ session: () => Promise.resolve(mockDraft) });
    Payment.findById = () => ({ session: () => Promise.resolve(mockPayment) });

    const result = await reconcileCheckoutDraft(draftId, { 
      mode: RECONCILE_MODES.PERSIST,
      getInvoiceFn: async () => mockInvoice
    });
    
    assert.strictEqual(result.payment.status, "paid");
    assert.strictEqual(result.payment.providerPaymentId, "pay_123");

    CheckoutDraft.findById = originalDraftFindById;
    Payment.findById = originalPaymentFindById;
  });
});

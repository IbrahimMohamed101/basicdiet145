"use strict";

const assert = require("node:assert/strict");
const { test, before, after, beforeEach } = require("node:test");
const mongoose = require("mongoose");
const sinon = require("sinon");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Payment = require("../src/models/Payment");
const Draft = require("../src/models/CheckoutDraft");
const Subscription = require("../src/models/Subscription");
const Batch = require("../src/models/SubscriptionEntitlementBatch");
const Day = require("../src/models/SubscriptionDay");
const moyasar = require("../src/services/moyasarService");
require("../src/services/installSubscriptionStackingWriteRouter");
const { settlePaidSubscriptionPayment, verifyAndRecordPaidSubscriptionPayment } = require("../src/services/subscription/subscriptionVerifiedPaymentService");
const { recoverPaidSubscriptionPayment } = require("../src/services/subscription/subscriptionPaymentRecoveryService");
const { handleMoyasarWebhook } = require("../src/controllers/webhookController");
const { synchronizePaymentForRedirect } = require("../src/services/paymentFlowService");
const { verifyCheckoutDraftPayment } = require("../src/controllers/subscriptionController");
const { runMongoTransactionWithRetry } = require("../src/services/mongoTransactionRetryService");
const { buildCanonicalSubscriptionActivationPayload } = require("../src/services/subscription/subscriptionActivationService");
const { activatePaidDraftIntoExistingContainerTransactional } = require("../src/services/subscription/subscriptionStackingActivationService");
let mongo;
const sandbox = sinon.createSandbox();
const oid = () => new mongoose.Types.ObjectId();
const response = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } });

before(async () => {
  process.env.SUBSCRIPTION_STACKING_READ_ENABLED = "true";
  process.env.SUBSCRIPTION_STACKING_WRITE_ENABLED = "true";
  process.env.SUBSCRIPTION_STACKING_ALLOW_ALL_USERS = "true";
  process.env.MOYASAR_WEBHOOK_SECRET = "test-secret";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: "verified_checkout_test", autoIndex: false });
  for (const model of [Payment, Draft, Subscription, Batch, Day]) {
    await model.createCollection();
    await model.syncIndexes();
  }
});
beforeEach(async () => {
  sandbox.restore();
  await Promise.all([Payment, Draft, Subscription, Batch, Day].map(m => m.deleteMany({})));
});
after(async () => { sandbox.restore(); await mongoose.disconnect(); await mongo?.stop(); });

async function fixture({ failed = false } = {}) {
  const userId = oid(), planId = oid(), draftId = oid(), paymentId = oid();
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const parent = await Subscription.create({ userId, planId: oid(), status: "active",
    startDate: new Date(start.getTime() - 40 * 86400000), endDate: new Date(start.getTime() - 10 * 86400000),
    totalMeals: 0, remainingMeals: 0, selectedMealsPerDay: 2, selectedGrams: 200, deliveryMode: "pickup" });
  await Draft.create({ _id: draftId, userId, planId, paymentId,
    providerInvoiceId: "invoice-test", status: failed ? "failed" : "pending_payment",
    failureReason: failed ? "payment_failed" : "", daysCount: 30, mealsPerDay: 1, grams: 200,
    startDate: start, delivery: { type: "pickup", pickupLocationId: "test-branch" },
    breakdown: { basePlanPriceHalala: 70380, premiumTotalHalala: 0, addonsTotalHalala: 0,
      deliveryFeeHalala: 0, vatHalala: 0, totalHalala: 70380, currency: "SAR" },
    contractHash: "synthetic-contract", contractSnapshot: {
      plan: { planId, daysCount: 30, mealsPerDay: 1, selectedGrams: 200 },
      start: { resolvedStartDate: start }, pricing: { totalHalala: 70380, currency: "SAR" },
    }, stackingFinalization: { version: "subscription_stacking.finalization.v1", mode: "additive_existing_parent",
      expectedParentSubscriptionId: parent._id, decidedAt: new Date() } });
  const payment = await Payment.create({ _id: paymentId, userId, type: "subscription_activation", provider: "moyasar",
    status: failed ? "failed" : "initiated", applied: false, amount: 70380, currency: "SAR",
    providerInvoiceId: "invoice-test", ...(failed ? { providerPaymentId: "attempt-failed" } : {}),
    metadata: { draftId: String(draftId), redirectContext: { token: "redirect-token" } } });
  const attempt = { id: "attempt-paid", invoice_id: "invoice-test", status: "paid", amount: 70380,
    currency: "SAR", refunded: 0, updated_at: new Date().toISOString() };
  const invoice = { id: "invoice-test", status: "paid", amount: 70380, currency: "SAR",
    metadata: { userId: String(userId), draftId: String(draftId) },
    payments: [{ ...attempt, id: "attempt-failed", status: "failed" }, attempt] };
  sandbox.stub(moyasar, "getInvoiceDetails").callsFake(async () => structuredClone(invoice));
  sandbox.stub(moyasar, "getPayment").callsFake(async () => structuredClone(attempt));
  // getInvoice was captured by existing modules; webhook overrides use this
  // authority and the new settlement service separately fetches detail/attempt.
  return { payment, parent, draftId, userId, invoice, attempt };
}
async function webhook(f, status, id = status === "paid" ? "attempt-paid" : "attempt-failed") {
  const res = response();
  await handleMoyasarWebhook({ headers: { "x-webhook-secret": "test-secret" }, body: {
    type: "payment_" + status, data: { id, invoice_id: f.invoice.id, status, amount: 70380, currency: "SAR" },
  } }, res, { applyOrderWebhookInvoice: async () => ({ handled: false }), writeLog: async () => {} });
  return res;
}
async function assertAppliedOnce(f) {
  const payment = await Payment.findById(f.payment._id).lean();
  const draft = await Draft.findById(f.draftId).lean();
  const batches = await Batch.find({ $or: [{ paymentId: payment._id }, { checkoutDraftId: f.draftId }] }).lean();
  assert.equal(payment.status, "paid"); assert.equal(payment.applied, true);
  assert.equal(payment.providerPaymentId, "attempt-paid");
  assert.equal(draft.status, "completed");
  assert.equal(batches.length, 1); assert.equal(batches[0].applicationState, "applied");
  assert.equal(batches[0].totalMeals, 30); assert.equal(batches[0].remainingMeals, 30);
  assert.equal(batches[0].mealsPerDay, 1); assert.equal(batches[0].proteinGrams, 200);
  assert.equal(await Subscription.countDocuments({ userId: f.userId }), 1);
  assert.equal(await Day.countDocuments({ subscriptionId: payment.subscriptionId }), 30);
  assert.equal(String(payment.subscriptionId), String(draft.subscriptionId));
  return { batch: batches[0], verifiedAt: payment.metadata.providerVerification.verifiedAt };
}

test("regression evidence: the old draft filter rolled back the paid update with activation", async () => {
  const f = await fixture({ failed: true });
  await assert.rejects(runMongoTransactionWithRetry(async session => {
    const payment = await Payment.findOneAndUpdate({ _id: f.payment._id }, { $set: { status: "paid", applied: true } }, { new: true, session });
    const draft = await Draft.findById(f.draftId).session(session);
    const { subscriptionPayload } = await buildCanonicalSubscriptionActivationPayload({ draft });
    await activatePaidDraftIntoExistingContainerTransactional({ draft, payment, subscriptionPayload,
      businessDate: new Date().toISOString().slice(0, 10), expectedParentSubscriptionId: f.parent._id, session,
      runtime: { updateDraftCompleted: ({ draftId, session: activeSession }) => Draft.findOneAndUpdate({
        _id: draftId, status: { $in: ["pending_payment", "completed"] },
      }, { $set: { status: "completed" } }, { new: true, session: activeSession }) },
    });
  }), { code: "STACKING_DRAFT_COMPLETION_CONFLICT" });
  assert.equal((await Payment.findById(f.payment._id)).status, "failed");
  assert.equal(await Batch.countDocuments({ checkoutDraftId: f.draftId }), 0);
  assert.equal((await Draft.findById(f.draftId)).status, "failed");
});

test("failed attempt then successful callback commits paid and activates exactly once", async () => {
  const f = await fixture();
  assert.equal((await webhook(f, "failed")).statusCode, 200);
  assert.equal((await Payment.findById(f.payment._id)).status, "failed");
  assert.equal((await Draft.findById(f.draftId)).failureReason, "payment_failed");
  assert.equal((await webhook(f, "paid")).statusCode, 200);
  const before = await assertAppliedOnce(f);
  assert.equal((await webhook(f, "paid")).statusCode, 200);
  await settlePaidSubscriptionPayment({ paymentId: f.payment._id });
  assert.deepEqual(await assertAppliedOnce(f), before);
});

test("success then late failed callback cannot downgrade paid or touch entitlements", async () => {
  const f = await fixture();
  assert.equal((await webhook(f, "paid")).statusCode, 200);
  const before = await assertAppliedOnce(f);
  assert.equal((await webhook(f, "failed")).statusCode, 200);
  assert.deepEqual(await assertAppliedOnce(f), before);
});

test("paid financial fact survives activation failure and official recovery resumes", async () => {
  const f = await fixture({ failed: true });
  await assert.rejects(settlePaidSubscriptionPayment({ paymentId: f.payment._id }, {
    recover: async () => { throw new Error("synthetic activation failure"); },
  }), /synthetic/);
  assert.equal((await Payment.findById(f.payment._id)).status, "paid");
  assert.equal((await Payment.findById(f.payment._id)).applied, false);
  assert.equal((await recoverPaidSubscriptionPayment(f.payment._id)).recovered, true);
  await assertAppliedOnce(f);
});

test("redirect verifies provider authority, replacing the old failed reference", async () => {
  const f = await fixture({ failed: true });
  const result = await synchronizePaymentForRedirect({ payment_type: "subscription_activation",
    draft_id: String(f.draftId), token: "redirect-token" });
  assert.equal(result.paymentStatus, "paid"); assert.equal(result.applied, true);
  await assertAppliedOnce(f);
});

test("provider mismatches fail closed without financial or entitlement writes", async () => {
  const cases = [
    f => { f.attempt.id = "wrong-reference"; },
    f => { f.attempt.invoice_id = "other-invoice"; },
    f => { f.attempt.amount = 1; },
    f => { f.attempt.currency = "USD"; },
    f => { f.invoice.metadata.userId = String(oid()); },
    f => { f.invoice.metadata.draftId = String(oid()); },
    f => { f.invoice.amount = 1; },
    f => { f.attempt.status = "failed"; },
    f => { f.attempt.refunded = 1; },
  ];
  for (const mutate of cases) {
    sandbox.restore(); await Promise.all([Payment, Draft, Subscription, Batch, Day].map(m => m.deleteMany({})));
    const f = await fixture({ failed: true }); mutate(f);
    const before = await Payment.findById(f.payment._id).lean();
    await assert.rejects(settlePaidSubscriptionPayment({ paymentId: f.payment._id, providerPaymentId: "attempt-paid" }),
      { code: "PAYMENT_PROVIDER_MISMATCH" });
    assert.deepEqual(await Payment.findById(f.payment._id).lean(), before);
    assert.equal(await Batch.countDocuments({ checkoutDraftId: f.draftId }), 0);
    assert.equal(await Day.countDocuments({}), 0);
  }
});

test("callback claiming paid is insufficient when provider invoice is not paid", async () => {
  const f = await fixture({ failed: true }); f.invoice.status = "failed";
  assert.equal((await webhook(f, "paid")).statusCode, 409);
  assert.equal((await Payment.findById(f.payment._id)).status, "failed");
  assert.equal(await Batch.countDocuments({ checkoutDraftId: f.draftId }), 0);
});

test("dry run validates the exact reference without writes or activation", async () => {
  const f = await fixture({ failed: true });
  const result = await verifyAndRecordPaidSubscriptionPayment({ paymentId: f.payment._id, apply: false });
  assert.equal(result.verified, true);
  assert.equal((await Payment.findById(f.payment._id)).status, "failed");
  assert.equal(await Batch.countDocuments({ checkoutDraftId: f.draftId }), 0);
});

test("late failure cannot downgrade a verified payment awaiting recovery", async () => {
  const f = await fixture({ failed: true });
  await verifyAndRecordPaidSubscriptionPayment({ paymentId: f.payment._id });
  assert.equal((await webhook(f, "failed")).statusCode, 200);
  assert.equal((await Payment.findById(f.payment._id)).status, "paid");
  assert.equal((await recoverPaidSubscriptionPayment(f.payment._id)).recovered, true);
  await assertAppliedOnce(f);
});

test("duplicate concurrent callbacks converge to one purchase and thirty days", async () => {
  const f = await fixture({ failed: true });
  // CAS/transaction losers may ask for retry; a repeated callback converges.
  const results = await Promise.all([webhook(f, "paid"), webhook(f, "paid")]);
  assert(results.some(r => r.statusCode === 200));
  assert.equal((await webhook(f, "paid")).statusCode, 200);
  await assertAppliedOnce(f);
});

test("invoice callback replaces tampered body with fetched evidence", async () => {
  const f = await fixture({ failed: true });
  const res = response();
  await handleMoyasarWebhook({ headers: {}, body: { ...f.invoice, amount: 1 } }, res, {
    getInvoice: async () => structuredClone(f.invoice),
    applyOrderWebhookInvoice: async () => ({ handled: false }),
  });
  assert.equal(res.statusCode, 200);
  await assertAppliedOnce(f);
});

test("explicit successful reference works when invoice omits its attempt list", async () => {
  const f = await fixture({ failed: true }); f.invoice.payments = [];
  await settlePaidSubscriptionPayment({ paymentId: f.payment._id, providerPaymentId: "attempt-paid" });
  await assertAppliedOnce(f);
});

test("authenticated draft verification recovers a failed draft after provider confirmation", async () => {
  const f = await fixture({ failed: true });
  const res = response();
  await verifyCheckoutDraftPayment({ params: { draftId: String(f.draftId) }, userId: f.userId, headers: {} }, res, {
    getInvoice: async () => structuredClone(f.invoice),
  });
  assert.equal(res.statusCode, 200);
  await assertAppliedOnce(f);
});

test("draft verification rejects another user before fetching provider evidence", async () => {
  const f = await fixture({ failed: true });
  const res = response();
  await verifyCheckoutDraftPayment({ params: { draftId: String(f.draftId) }, userId: oid(), headers: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(moyasar.getInvoiceDetails.callCount, 0);
  assert.equal((await Payment.findById(f.payment._id)).status, "failed");
});

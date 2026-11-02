"use strict";

// Regression coverage for the stacking paid-draft recovery fixes:
// 1. A paid draft whose first provider attempt failed can still be completed.
// 2. Stacking passes ONE options object to consumePromoCodeUsageReservation.
// 3. A cancelled promo reservation is never re-inserted for the same key.
// 4. Moyasar provider references are decided before in-memory mutation.
//
// No database is used: model statics are stubbed with sinon.

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const sinon = require("sinon");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const PromoUsage = require("../src/models/PromoUsage");
const {
  STACKING_COMPLETABLE_DRAFT_STATUSES,
  buildDraftCompletionQuery,
  buildDraftCompletionUpdate,
  completePaidDraftStackingActivation,
  assertPaidDraftLinkage,
} = require("../src/services/subscription/subscriptionStackingActivationService");
const {
  resolveExistingPromoUsageDecision,
} = require("../src/services/promoCodeService");
const {
  resolveProviderReferenceUpdates,
  shouldIgnoreNonPaidAttemptAfterPaid,
} = require("../src/controllers/webhookController");

const results = [];

async function run(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✅ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.error(`❌ ${name}`);
    console.error(err);
  } finally {
    sinon.restore();
  }
}

function oid() {
  return new mongoose.Types.ObjectId();
}

async function main() {
  await run("completion query accepts drafts failed by an earlier provider attempt", async () => {
    const draftId = oid();
    const containerId = oid();
    const query = buildDraftCompletionQuery({ draftId, containerId });

    assert.equal(query._id, draftId);
    for (const status of ["pending_payment", "completed", "failed", "canceled", "expired"]) {
      assert.ok(query.status.$in.includes(status), `missing ${status}`);
    }
    assert.equal(query.status.$in.length, STACKING_COMPLETABLE_DRAFT_STATUSES.length);
    assert.ok(!query.status.$in.includes("processing"));
  });

  await run("completion query never re-points a draft bound to another subscription", async () => {
    const containerId = oid();
    const query = buildDraftCompletionQuery({ draftId: oid(), containerId });

    assert.deepEqual(query.$or, [
      { subscriptionId: null },
      { subscriptionId: { $exists: false } },
      { subscriptionId: containerId },
    ]);
  });

  await run("completion update clears the failure and records the paying payment", async () => {
    const containerId = oid();
    const paymentId = oid();
    const now = new Date("2026-11-02T18:00:00.000Z");
    const update = buildDraftCompletionUpdate({ containerId, paymentId, now });

    assert.deepEqual(update, {
      $set: {
        status: "completed",
        subscriptionId: containerId,
        activationSubscriptionId: containerId,
        completedAt: now,
        failedAt: null,
        failureReason: "",
        paymentId,
      },
    });
    assert.equal("paymentId" in buildDraftCompletionUpdate({ containerId, now }).$set, false);
  });

  await run("default runtime completes a failed paid draft and consumes its promo with one options object", async () => {
    const draftId = oid();
    const containerId = oid();
    const paymentId = oid();
    const usageId = oid();
    const draft = {
      _id: draftId,
      userId: oid(),
      status: "failed",
      promo: { usageId },
    };
    const payment = { _id: paymentId, status: "paid" };

    const draftUpdate = sinon.stub(CheckoutDraft, "findOneAndUpdate").resolves({
      _id: draftId,
      status: "completed",
      subscriptionId: containerId,
    });
    sinon.stub(Payment, "findOneAndUpdate").resolves({
      _id: paymentId,
      status: "paid",
      subscriptionId: containerId,
      applied: true,
    });
    const usage = {
      _id: usageId,
      status: "reserved",
      save: sinon.stub().resolves(),
    };
    const usageFind = sinon.stub(PromoUsage, "findOne").resolves(usage);

    const result = await completePaidDraftStackingActivation({
      draft,
      payment,
      containerId,
      now: new Date("2026-11-02T18:00:00.000Z"),
    });

    assert.equal(result.draft.status, "completed");
    const [query, update] = draftUpdate.firstCall.args;
    assert.ok(query.status.$in.includes("failed"));
    assert.equal(String(update.$set.paymentId), String(paymentId));

    assert.equal(usageFind.callCount, 1);
    const usageQuery = usageFind.firstCall.args[0];
    assert.equal(String(usageQuery.checkoutDraftId), String(draftId),
      "consume must receive checkoutDraftId, not undefined");
    assert.equal(usage.status, "consumed");
    assert.equal(String(usage.subscriptionId), String(containerId));
    assert.equal(String(usage.paymentId), String(paymentId));
    assert.equal(usage.save.callCount, 1);
  });

  await run("completion still fails closed when the draft cannot be matched", async () => {
    sinon.stub(CheckoutDraft, "findOneAndUpdate").resolves(null);
    const linkPayment = sinon.stub(Payment, "findOneAndUpdate").resolves(null);

    await assert.rejects(
      completePaidDraftStackingActivation({
        draft: { _id: oid(), userId: oid(), status: "failed" },
        payment: { _id: oid(), status: "paid" },
        containerId: oid(),
      }),
      (err) => err.code === "STACKING_DRAFT_COMPLETION_CONFLICT"
    );
    assert.equal(linkPayment.callCount, 0, "payment must not be linked when the draft did not complete");
  });

  await run("runtime overrides receive paymentId in consume options", async () => {
    const calls = [];
    const paymentId = oid();
    await completePaidDraftStackingActivation({
      draft: { _id: oid(), userId: oid(), status: "pending_payment", promo: { usageId: oid() } },
      payment: { _id: paymentId, status: "paid" },
      containerId: oid(),
      runtime: {
        updateDraftCompleted: async (args) => ({ _id: args.draftId, status: "completed" }),
        linkPayment: async (args) => ({ _id: args.paymentId, status: "paid" }),
        consumePromoReservation: async (...args) => {
          calls.push(args);
          return { consumed: true };
        },
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(String(calls[0][2].paymentId), String(paymentId));
  });

  await run("promo usage decision never re-inserts a cancelled reservation", async () => {
    assert.equal(resolveExistingPromoUsageDecision(null), "none");
    assert.equal(resolveExistingPromoUsageDecision({ status: "reserved" }), "reuse");
    assert.equal(resolveExistingPromoUsageDecision({ status: "consumed" }), "reuse");
    assert.equal(resolveExistingPromoUsageDecision({ status: "cancelled" }), "expired");
    assert.equal(resolveExistingPromoUsageDecision({ status: "released" }), "expired");
  });

  await run("provider references are computed from the stored payment, not the mutated one", async () => {
    const stored = { providerPaymentId: null, providerInvoiceId: null };
    const updates = resolveProviderReferenceUpdates(stored, {
      paymentId: "pay_success",
      invoiceId: "inv_1",
    });
    // Simulate the controller's later in-memory assignment.
    stored.providerPaymentId = "pay_success";
    stored.providerInvoiceId = "inv_1";

    assert.deepEqual(updates, { providerPaymentId: "pay_success", providerInvoiceId: "inv_1" });
  });

  await run("existing provider references are never overwritten", async () => {
    assert.deepEqual(
      resolveProviderReferenceUpdates(
        { providerPaymentId: "pay_existing", providerInvoiceId: "inv_existing" },
        { paymentId: "pay_other", invoiceId: "inv_other" }
      ),
      {}
    );
    assert.deepEqual(resolveProviderReferenceUpdates({}, {}), {});
  });

  await run("completed draft checks all already linked parent/payment IDs", async () => {
    const containerId = oid();
    const paymentId = oid();
    const query = buildDraftCompletionQuery({ draftId: oid(), containerId, paymentId });
    assert.equal(query.$and.length, 2);
    assert.deepEqual(query.$and[0].$or, [
      { activationSubscriptionId: null },
      { activationSubscriptionId: { $exists: false } },
      { activationSubscriptionId: containerId },
    ]);
    assert.deepEqual(query.$and[1].$or, [
      { paymentId: null },
      { paymentId: { $exists: false } },
      { paymentId },
    ]);
  });

  await run("completion fails closed for conflicting payment, owner, invoice, or amount", async () => {
    const userId = oid();
    const containerId = oid();
    const draftId = oid();
    const paymentId = oid();
    const draft = {
      _id: draftId, userId, subscriptionId: containerId,
      activationSubscriptionId: containerId, paymentId,
      providerInvoiceId: "invoice_1",
      breakdown: { totalHalala: 113135, currency: "SAR" },
    };
    const payment = {
      _id: paymentId, userId, status: "paid",
      subscriptionId: containerId, checkoutDraftId: draftId,
      providerInvoiceId: "invoice_1", amount: 113135, currency: "SAR",
    };
    assert.doesNotThrow(() => assertPaidDraftLinkage({ draft, payment, containerId }));
    const fail = (changedDraft, changedPayment) => assert.throws(
      () => assertPaidDraftLinkage({
        draft: changedDraft || draft,
        payment: changedPayment || payment,
        containerId,
      }),
      (err) => err.code === "STACKING_PAID_DRAFT_LINK_MISMATCH"
    );
    fail(null, { ...payment, userId: oid() });
    fail(null, { ...payment, status: "failed" });
    fail(null, { ...payment, checkoutDraftId: oid() });
    fail(null, { ...payment, subscriptionId: oid() });
    fail(null, { ...payment, providerInvoiceId: "another_invoice" });
    fail(null, { ...payment, amount: 120000 });
    fail(null, { ...payment, currency: "USD" });
    fail({ ...draft, subscriptionId: oid() });
    fail({ ...draft, activationSubscriptionId: oid() });
    fail({ ...draft, paymentId: oid() });
  });

  await run("late failure cannot downgrade a paid Moyasar invoice", async () => {
    assert.equal(shouldIgnoreNonPaidAttemptAfterPaid({ status: "paid" }, false), true);
    assert.equal(shouldIgnoreNonPaidAttemptAfterPaid({ status: "paid" }, true), false);
    assert.equal(shouldIgnoreNonPaidAttemptAfterPaid({ status: "failed" }, false), false);
  });

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} stacking paid-draft recovery tests failed`);
    process.exit(1);
  }
  console.log(`\nstacking paid-draft recovery tests passed (${results.length})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

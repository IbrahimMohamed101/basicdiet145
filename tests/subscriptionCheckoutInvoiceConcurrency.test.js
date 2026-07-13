"use strict";

process.env.NODE_ENV = "test";

const assert = require("assert");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const {
  createSubscriptionCheckoutInvoice,
} = require("../src/services/subscription/subscriptionInvoiceInitializationService");
const {
  ensureSubscriptionCheckoutPayment,
} = require("../src/services/subscription/subscriptionCheckoutHelpers");

let mongoServer;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createDraft(overrides = {}) {
  return CheckoutDraft.create({
    userId: new mongoose.Types.ObjectId(),
    planId: new mongoose.Types.ObjectId(),
    idempotencyKey: `checkout-concurrency-${new mongoose.Types.ObjectId()}`,
    requestHash: `hash-${new mongoose.Types.ObjectId()}`,
    daysCount: 5,
    grams: 150,
    mealsPerDay: 2,
    delivery: {
      type: "pickup",
      pickupLocationId: "main",
      slot: { type: "pickup", window: "", slotId: "" },
    },
    breakdown: {
      basePlanPriceHalala: 10000,
      basePlanGrossHalala: 10000,
      basePlanNetHalala: 8621,
      premiumTotalHalala: 0,
      addonsTotalHalala: 0,
      deliveryFeeHalala: 0,
      grossTotalHalala: 10000,
      discountHalala: 0,
      subtotalHalala: 8621,
      subtotalBeforeVatHalala: 8621,
      vatPercentage: 16,
      vatHalala: 1379,
      totalHalala: 10000,
      currency: "SAR",
    },
    ...overrides,
  });
}

async function testConcurrentInvoiceAndPaymentReuse() {
  const draft = await createDraft();
  let providerCalls = 0;

  const payload = {
    amount: draft.breakdown.totalHalala,
    currency: "SAR",
    description: "Concurrent subscription checkout test",
    metadata: {
      type: "subscription_activation",
      draftId: String(draft._id),
      userId: String(draft.userId),
    },
  };

  const createInvoiceFn = async (requestPayload) => {
    providerCalls += 1;
    const callNumber = providerCalls;
    await sleep(150);
    return {
      id: `inv_concurrency_${callNumber}`,
      url: `https://payments.example.test/invoices/${callNumber}`,
      amount: requestPayload.amount,
      currency: requestPayload.currency,
      status: "initiated",
      metadata: requestPayload.metadata,
    };
  };

  const invoices = await Promise.all(
    Array.from({ length: 20 }, () => createSubscriptionCheckoutInvoice(payload, {
      createInvoiceFn,
      pollIntervalMs: 10,
      waitTimeoutMs: 10000,
      staleClaimMs: 60000,
    }))
  );

  assert.strictEqual(providerCalls, 1, "exactly one provider invoice must be created");
  assert.strictEqual(new Set(invoices.map((invoice) => invoice.id)).size, 1, "all callers must reuse one invoice id");
  assert.strictEqual(new Set(invoices.map((invoice) => invoice.url)).size, 1, "all callers must reuse one payment URL");

  const persistedDraft = await CheckoutDraft.findById(draft._id);
  assert.ok(persistedDraft, "checkout draft must still exist");
  assert.strictEqual(persistedDraft.providerInvoiceId, "inv_concurrency_1");
  assert.strictEqual(persistedDraft.paymentUrl, "https://payments.example.test/invoices/1");
  assert.strictEqual(persistedDraft.invoiceInitialization.status, "ready");
  assert.strictEqual(persistedDraft.invoiceInitialization.token, "");

  const payments = await Promise.all(
    invoices.map((invoice) => ensureSubscriptionCheckoutPayment({
      draft: persistedDraft,
      paymentType: "subscription_activation",
      totalHalala: persistedDraft.breakdown.totalHalala,
      invoiceCurrency: "SAR",
      providerInvoiceId: invoice.id,
      paymentUrl: invoice.url,
      redirectContext: null,
    }))
  );

  assert.strictEqual(new Set(payments.map((payment) => String(payment._id))).size, 1, "all callers must reuse one Payment row");
  assert.strictEqual(await CheckoutDraft.countDocuments({ idempotencyKey: draft.idempotencyKey }), 1, "one CheckoutDraft must exist");
  assert.strictEqual(await Payment.countDocuments({ providerInvoiceId: "inv_concurrency_1" }), 1, "one Payment must exist");
}

async function testStaleClaimRecovery() {
  const draft = await createDraft({
    invoiceInitialization: {
      status: "initializing",
      token: "abandoned-token",
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
    },
  });
  let providerCalls = 0;

  const invoice = await createSubscriptionCheckoutInvoice({
    amount: 10000,
    currency: "SAR",
    metadata: { draftId: String(draft._id) },
  }, {
    staleClaimMs: 1000,
    pollIntervalMs: 5,
    waitTimeoutMs: 3000,
    createInvoiceFn: async () => {
      providerCalls += 1;
      return {
        id: "inv_stale_claim_recovered",
        url: "https://payments.example.test/invoices/stale-recovered",
        amount: 10000,
        currency: "SAR",
      };
    },
  });

  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(invoice.id, "inv_stale_claim_recovered");
  const persisted = await CheckoutDraft.findById(draft._id).lean();
  assert.strictEqual(persisted.invoiceInitialization.status, "ready");
  assert.strictEqual(persisted.providerInvoiceId, "inv_stale_claim_recovered");
}

async function testProviderFailureReleasesClaim() {
  const draft = await createDraft();
  const payload = {
    amount: 10000,
    currency: "SAR",
    metadata: { draftId: String(draft._id) },
  };

  await assert.rejects(
    () => createSubscriptionCheckoutInvoice(payload, {
      createInvoiceFn: async () => {
        const err = new Error("simulated provider failure");
        err.code = "SIMULATED_PROVIDER_FAILURE";
        throw err;
      },
      waitTimeoutMs: 1000,
      pollIntervalMs: 5,
    }),
    (err) => err.code === "SIMULATED_PROVIDER_FAILURE"
  );

  const failed = await CheckoutDraft.findById(draft._id).lean();
  assert.strictEqual(failed.invoiceInitialization.status, "failed");
  assert.strictEqual(failed.invoiceInitialization.token, "");
  assert.strictEqual(failed.invoiceInitialization.lastError, "SIMULATED_PROVIDER_FAILURE");

  const retry = await createSubscriptionCheckoutInvoice(payload, {
    createInvoiceFn: async () => ({
      id: "inv_after_retry",
      url: "https://payments.example.test/invoices/after-retry",
      amount: 10000,
      currency: "SAR",
    }),
    waitTimeoutMs: 1000,
    pollIntervalMs: 5,
  });

  assert.strictEqual(retry.id, "inv_after_retry");
  const recovered = await CheckoutDraft.findById(draft._id).lean();
  assert.strictEqual(recovered.invoiceInitialization.status, "ready");
  assert.strictEqual(recovered.providerInvoiceId, "inv_after_retry");
}

(async function run() {
  try {
    mongoServer = await MongoMemoryServer.create({
      instance: { dbName: `checkout_invoice_concurrency_${Date.now()}` },
    });
    await mongoose.connect(mongoServer.getUri());
    await CheckoutDraft.syncIndexes();
    await Payment.syncIndexes();

    await testConcurrentInvoiceAndPaymentReuse();
    console.log("  OK  20 concurrent callers create one draft, invoice, and payment");

    await testStaleClaimRecovery();
    console.log("  OK  stale invoice initialization claim is recovered");

    await testProviderFailureReleasesClaim();
    console.log("  OK  provider failure releases the claim for retry");

    console.log("\nSubscription checkout invoice concurrency: 3 passed, 0 failed");
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

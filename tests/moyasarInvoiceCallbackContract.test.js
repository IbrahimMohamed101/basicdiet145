"use strict";

const assert = require("node:assert");
const sinon = require("sinon");

const Payment = require("../src/models/Payment");
const { handleMoyasarWebhook } = require("../src/controllers/webhookController");

function buildResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function buildInvoice({ id = "inv_verified", amount = 30700 } = {}) {
  return {
    id,
    status: "paid",
    amount,
    currency: "SAR",
    payments: [
      {
        id: "pay_verified",
        invoice_id: id,
        status: "paid",
        amount,
        currency: "SAR",
      },
    ],
    metadata: {
      type: "subscription_activation",
      draftId: "draft_verified",
    },
  };
}

async function verified_invoice_callback_uses_provider_authority() {
  const sandbox = sinon.createSandbox();
  const invoice = buildInvoice();
  const payment = {
    _id: "internal_payment",
    provider: "moyasar",
    providerInvoiceId: invoice.id,
    providerPaymentId: invoice.payments[0].id,
    type: "subscription_activation",
    status: "paid",
    applied: true,
    amount: invoice.amount,
    currency: invoice.currency,
  };
  let paymentFilter = null;
  sandbox.stub(Payment, "findOne").callsFake((filter) => {
    paymentFilter = filter;
    return { lean: () => Promise.resolve(payment) };
  });

  const req = {
    // Deliberately tampered amount. Processing must use the fetched invoice.
    body: { ...invoice, amount: 1 },
    headers: {},
  };
  const res = buildResponse();
  let fetchedInvoiceId = null;

  try {
    await handleMoyasarWebhook(req, res, {
      getInvoice: async (invoiceId) => {
        fetchedInvoiceId = String(invoiceId);
        return invoice;
      },
      applyOrderWebhookInvoice: async () => ({ handled: false }),
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, true);
    assert.strictEqual(fetchedInvoiceId, invoice.id);
    assert.deepStrictEqual(paymentFilter, {
      provider: "moyasar",
      $or: [
        { providerPaymentId: invoice.payments[0].id },
        { providerInvoiceId: invoice.id },
      ],
    });
  } finally {
    sandbox.restore();
  }
}

async function mismatched_provider_invoice_is_rejected_before_payment_lookup() {
  const sandbox = sinon.createSandbox();
  const callbackInvoice = buildInvoice({ id: "inv_callback" });
  const paymentLookup = sandbox.stub(Payment, "findOne");
  const req = { body: callbackInvoice, headers: {} };
  const res = buildResponse();

  try {
    await handleMoyasarWebhook(req, res, {
      getInvoice: async () => buildInvoice({ id: "inv_different" }),
      applyOrderWebhookInvoice: async () => {
        throw new Error("order processing must not run");
      },
    });

    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.error.code, "PAYMENT_PROVIDER_MISMATCH");
    assert.strictEqual(paymentLookup.callCount, 0);
  } finally {
    sandbox.restore();
  }
}

async function invalid_account_webhook_secret_still_fails_closed() {
  const sandbox = sinon.createSandbox();
  const paymentLookup = sandbox.stub(Payment, "findOne");
  const req = {
    body: {
      type: "payment_paid",
      secret_token: "wrong-secret",
      data: { id: "pay_untrusted", invoice_id: "inv_untrusted", status: "paid" },
    },
    headers: {},
  };
  const res = buildResponse();

  try {
    await handleMoyasarWebhook(req, res, {
      getInvoice: async () => {
        throw new Error("account webhook must not use invoice fallback");
      },
      applyOrderWebhookInvoice: async () => {
        throw new Error("order processing must not run");
      },
    });

    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(res.body.error.code, "UNAUTHORIZED");
    assert.strictEqual(paymentLookup.callCount, 0);
  } finally {
    sandbox.restore();
  }
}

async function run() {
  const originalWebhookSecret = process.env.MOYASAR_WEBHOOK_SECRET;
  const originalAllowedIps = process.env.MOYASAR_WEBHOOK_ALLOWED_IPS;
  process.env.MOYASAR_WEBHOOK_SECRET = "expected-webhook-secret";
  delete process.env.MOYASAR_WEBHOOK_ALLOWED_IPS;

  try {
    await verified_invoice_callback_uses_provider_authority();
    console.log("✅ verified_invoice_callback_uses_provider_authority passed");
    await mismatched_provider_invoice_is_rejected_before_payment_lookup();
    console.log("✅ mismatched_provider_invoice_is_rejected_before_payment_lookup passed");
    await invalid_account_webhook_secret_still_fails_closed();
    console.log("✅ invalid_account_webhook_secret_still_fails_closed passed");
  } finally {
    if (originalWebhookSecret === undefined) delete process.env.MOYASAR_WEBHOOK_SECRET;
    else process.env.MOYASAR_WEBHOOK_SECRET = originalWebhookSecret;
    if (originalAllowedIps === undefined) delete process.env.MOYASAR_WEBHOOK_ALLOWED_IPS;
    else process.env.MOYASAR_WEBHOOK_ALLOWED_IPS = originalAllowedIps;
  }
}

run().catch((err) => {
  console.error("❌ Moyasar invoice callback contract tests failed");
  console.error(err);
  process.exit(1);
});

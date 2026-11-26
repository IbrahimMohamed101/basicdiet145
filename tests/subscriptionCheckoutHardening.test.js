"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const CheckoutDraft = require("../src/models/CheckoutDraft");
const Payment = require("../src/models/Payment");
const {
  buildCanonicalSubscriptionCheckoutBreakdown,
} = require("../src/services/subscription/subscriptionCheckoutService");

const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function hasUniqueIndex(indexes, expectedKeys) {
  return indexes.some(([keys, options]) => {
    if (!options || options.unique !== true) return false;
    return Object.entries(expectedKeys).every(([key, value]) => keys[key] === value);
  });
}

(async function run() {
  console.log("\n-- Subscription checkout hardening --");

  await test("rebuilds checkout totals from server-owned quote rows", async () => {
    const quote = {
      premiumItems: [
        { premiumKey: "shrimp", qty: 2, unitExtraFeeHalala: 1500 },
      ],
      breakdown: {
        basePlanPriceHalala: 10000,
        premiumTotalHalala: 1,
        addonsTotalHalala: 1200,
        deliveryFeeHalala: 500,
        discountHalala: 700,
        vatPercentage: 99,
        vatHalala: 1,
        totalHalala: 2,
      },
    };

    const result = buildCanonicalSubscriptionCheckoutBreakdown(quote);
    assert.strictEqual(result.premiumTotalHalala, 3000);
    assert.strictEqual(result.breakdown.grossTotalHalala, 14700);
    assert.strictEqual(result.breakdown.totalHalala, 14000);
    assert.strictEqual(result.breakdown.vatPercentage, 15);
    assert.strictEqual(
      result.breakdown.vatHalala,
      Math.round((14000 * 15) / 115)
    );
  });

  await test("rejects malformed canonical premium rows", async () => {
    assert.throws(
      () => buildCanonicalSubscriptionCheckoutBreakdown({
        premiumItems: [{ premiumKey: "shrimp", qty: 1, unitExtraFeeHalala: -1 }],
        breakdown: {},
      }),
      /Canonical premium quote row is invalid/
    );
  });

  await test("CheckoutDraft has unique idempotency and pending request hash guards", async () => {
    const indexes = CheckoutDraft.schema.indexes();
    assert.ok(hasUniqueIndex(indexes, { userId: 1, idempotencyKey: 1 }));
    assert.ok(hasUniqueIndex(indexes, { userId: 1, requestHash: 1, status: 1 }));
  });

  await test("Payment has unique provider and operation idempotency guards", async () => {
    const indexes = Payment.schema.indexes();
    assert.ok(hasUniqueIndex(indexes, { provider: 1, providerInvoiceId: 1 }));
    assert.ok(hasUniqueIndex(indexes, { provider: 1, providerPaymentId: 1 }));
    assert.ok(hasUniqueIndex(indexes, { operationIdempotencyKey: 1 }));
  });

  await test("checkout always resolves a fresh server-side quote before persistence", async () => {
    const source = read("src/services/subscription/subscriptionCheckoutService.js");
    const resolvePos = source.indexOf("resolveCheckoutQuoteOrThrow(body");
    const createPos = source.indexOf("CheckoutDraft.create(draftPayload)");
    assert.ok(resolvePos >= 0, "server quote resolution missing");
    assert.ok(createPos > resolvePos, "draft persisted before server quote resolution");
    assert.ok(!source.includes("body.totalHalala"));
    assert.ok(!source.includes("body.vatHalala"));
    assert.ok(!source.includes("body.premiumTotalHalala"));
  });

  await test("payment verification checks ownership, amount, currency, and atomic applied claim", async () => {
    const controller = read("src/controllers/subscriptionController.js");
    const verification = read("src/services/subscription/subscriptionVerifiedPaymentService.js");
    assert.ok(controller.includes("settlePaidSubscriptionPayment"), "draft verification must use the shared verified settlement path");
    assert.ok(verification.includes("invoice.metadata?.userId"), "provider invoice ownership must be checked");
    assert.ok(verification.includes("invoice.metadata?.draftId"), "provider invoice draft ownership must be checked");
    assert.ok(verification.includes("assertPrice(invoice, payment)"), "invoice amount and currency must match the saved payment");
    assert.ok(verification.includes("assertPrice(attempt, payment)"), "successful attempt amount and currency must match the saved payment");
    assert.ok(verification.includes("status: payment.status"), "paid state must use a conditional update");
    assert.ok(verification.includes("status: \"paid\""), "only provider-verified payment may be promoted to paid");
  });

  await test("checkout idempotency conflict is enforced for payload changes", async () => {
    const source = read("src/services/subscription/subscriptionCheckoutService.js");
    assert.ok(source.includes("existingByKey.requestHash !== requestHash"));
    assert.ok(source.includes("IDEMPOTENCY_CONFLICT"));
  });

  if (results.failed > 0) process.exitCode = 1;
  console.log(`\nSubscription checkout hardening: ${results.passed} passed, ${results.failed} failed`);
})();
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const Payment = require("../src/models/Payment");
const {
  PAYMENT_METHODS,
  decorateQuotePayload,
  extractQuoteTotalHalala,
  normalizeDashboardPaymentMethod,
  paymentMethodOptions,
} = require("../src/controllers/dashboard/subscriptionPaymentRecordingController");
const {
  buildPaymentMethodSummary,
  normalizeRecordedPaymentMethod,
} = require("../src/services/dashboard/subscriptionPaymentMethodReportService");

const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`❌ ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

(async function run() {
  await test("cash and visa are the canonical dashboard subscription payment methods", async () => {
    assert.deepStrictEqual(PAYMENT_METHODS, ["cash", "visa"]);
    assert.deepStrictEqual(normalizeDashboardPaymentMethod({ payment: { method: "cash" } }), {
      method: "cash",
      defaulted: false,
    });
    assert.deepStrictEqual(normalizeDashboardPaymentMethod({ paymentMethod: "visa" }), {
      method: "visa",
      defaulted: false,
    });
  });

  await test("common card aliases normalize to visa without a gateway", async () => {
    for (const alias of ["card", "credit_card", "credit-card", "mada"]) {
      assert.strictEqual(normalizeDashboardPaymentMethod({ payment: { method: alias } }).method, "visa");
    }
    const visaOption = paymentMethodOptions().find((row) => row.method === "visa");
    assert(visaOption, "visa option exists");
    assert.strictEqual(visaOption.gatewayRequired, false);
    assert.strictEqual(visaOption.labelAr, "فيزا");
  });

  await test("legacy create requests without a method remain cash compatible", async () => {
    assert.deepStrictEqual(normalizeDashboardPaymentMethod({}), {
      method: "cash",
      defaulted: true,
    });
  });

  await test("unsupported payment methods are rejected with a controlled code", async () => {
    assert.throws(
      () => normalizeDashboardPaymentMethod({ payment: { method: "bank_transfer" } }),
      (err) => err && err.code === "INVALID_PAYMENT_METHOD" && err.status === 400
    );
  });

  await test("quote contract advertises cash and visa manual recording", async () => {
    const payload = decorateQuotePayload({
      status: true,
      data: {
        pricing: { totalHalala: 254200, currency: "SAR" },
        allowedPaymentMethods: ["cash"],
      },
    });
    assert.deepStrictEqual(payload.data.allowedPaymentMethods, ["cash", "visa"]);
    assert.strictEqual(payload.data.paymentGatewayRequired, false);
    assert.strictEqual(payload.data.paymentRecordingMode, "dashboard_manual");
    assert.deepStrictEqual(payload.data.paymentMethodOptions.map((row) => row.method), ["cash", "visa"]);
    assert.strictEqual(extractQuoteTotalHalala(payload), 254200);
  });

  await test("subscription payment report counts people and amounts by method", async () => {
    const summary = buildPaymentMethodSummary([
      { customerId: "u1", paymentMethod: "cash", amountHalala: 10000 },
      { customerId: "u2", paymentMethod: "cash", amountHalala: 15000 },
      { customerId: "u1", paymentMethod: "visa", amountHalala: 20000 },
      { customerId: "u3", paymentMethod: "visa", amountHalala: 25000 },
    ]);
    assert.strictEqual(summary.totalPaymentsCount, 4);
    assert.strictEqual(summary.uniqueCustomersCount, 3);
    assert.strictEqual(summary.cashCount, 2);
    assert.strictEqual(summary.cashCustomersCount, 2);
    assert.strictEqual(summary.cashTotalHalala, 25000);
    assert.strictEqual(summary.visaCount, 2);
    assert.strictEqual(summary.visaCustomersCount, 2);
    assert.strictEqual(summary.visaTotalHalala, 45000);
    assert.strictEqual(summary.totalHalala, 70000);
  });

  await test("stored manual provider and explicit metadata resolve as visa", async () => {
    assert.strictEqual(normalizeRecordedPaymentMethod({ provider: "manual" }), "visa");
    assert.strictEqual(normalizeRecordedPaymentMethod({ provider: "manual", method: "visa" }), "visa");
    assert.strictEqual(normalizeRecordedPaymentMethod({ provider: "cash", method: "cash" }), "cash");
    assert.strictEqual(
      normalizeRecordedPaymentMethod({ provider: "manual", metadata: { paymentMethod: "visa" } }),
      "visa"
    );
  });

  await test("Payment schema accepts manual provider for recorded card payments", async () => {
    const providerEnum = Payment.schema.path("provider").enumValues;
    assert(providerEnum.includes("moyasar"));
    assert(providerEnum.includes("cash"));
    assert(providerEnum.includes("manual"));
  });

  await test("canonical dashboard routes use payment recording and expose the daily report", async () => {
    const subscriptionsRoute = read("src/routes/dashboardSubscriptions.js");
    assert(subscriptionsRoute.includes('require("../controllers/dashboard/subscriptionPaymentRecordingController")'));
    assert(subscriptionsRoute.includes("subscriptionPaymentController.quoteSubscriptionAdmin"));
    assert(subscriptionsRoute.includes("subscriptionPaymentController.createSubscriptionAdmin"));

    const accountingRoute = read("src/routes/dashboardAccounting.js");
    assert(accountingRoute.includes('"/subscription-payments/daily"'));
    assert(accountingRoute.includes("subscriptionPaymentController.getDailySubscriptionPayments"));
    assert(accountingRoute.includes('dashboardRoleMiddleware(["admin"])'));
  });

  await test("visa recording code never invokes a payment gateway", async () => {
    const source = read("src/controllers/dashboard/subscriptionPaymentRecordingController.js");
    assert(source.includes('gatewayUsed: false'));
    assert(source.includes('paymentGatewayRequired: false'));
    assert(!source.includes("moyasarService"));
    assert(!source.includes("createInvoice"));
    assert(!source.includes("paymentUrl"));
  });

  if (results.failed > 0) process.exitCode = 1;
  console.log(`\nDashboard subscription payment methods: ${results.passed} passed, ${results.failed} failed`);
})();

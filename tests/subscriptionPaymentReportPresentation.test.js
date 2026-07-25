process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const {
  buildPaymentMethodSummary,
  listMonthDates,
  moneyValue,
  normalizeMonth,
  normalizeRecordedPaymentMethod,
  resolvePaymentMethodClassification,
} = require("../src/services/dashboard/subscriptionPaymentMethodReportService");

function item(overrides = {}) {
  return {
    customerId: "customer-1",
    paymentMethod: "cash",
    subscriptionStatus: "active",
    amountHalala: 11500,
    vatHalala: 1500,
    netBeforeVatHalala: 10000,
    needsReview: false,
    reviewReasonsAr: [],
    ...overrides,
  };
}

function testPaymentMethodClassification() {
  assert.strictEqual(normalizeRecordedPaymentMethod({ method: "cash" }), "cash");
  assert.strictEqual(normalizeRecordedPaymentMethod({ metadata: { paymentMethod: "mada" } }), "visa");
  assert.strictEqual(normalizeRecordedPaymentMethod({ provider: "moyasar", providerPaymentId: "pay_123" }), "visa");
  assert.strictEqual(
    normalizeRecordedPaymentMethod(
      { provider: "moyasar" },
      { action: "subscription_cash_payment_collected", meta: {} }
    ),
    "cash"
  );
  assert.strictEqual(normalizeRecordedPaymentMethod({ provider: "moyasar" }), "unknown");

  const recovered = resolvePaymentMethodClassification(
    { provider: "moyasar" },
    { action: "subscription_visa_payment_recorded", meta: {} }
  );
  assert.strictEqual(recovered.method, "visa");
  assert.strictEqual(recovered.recoveredFromLegacyAudit, true);
}

function testArabicMoneyAndSummary() {
  const money = moneyValue(127400);
  assert.strictEqual(money.amountSar, 1274);
  assert(money.formattedAr, "Arabic money label is returned");

  const summary = buildPaymentMethodSummary([
    item(),
    item({ customerId: "customer-2", paymentMethod: "visa", amountHalala: 23000, vatHalala: 3000, netBeforeVatHalala: 20000 }),
    item({ paymentMethod: "unknown", amountHalala: 5000, vatHalala: 652, netBeforeVatHalala: 4348, needsReview: true }),
  ]);
  assert.strictEqual(summary.totalPaymentsCount, 3);
  assert.strictEqual(summary.uniqueCustomersCount, 2);
  assert.strictEqual(summary.totalHalala, 39500);
  assert.strictEqual(summary.cashTotalHalala, 11500);
  assert.strictEqual(summary.visaTotalHalala, 23000);
  assert.strictEqual(summary.unknownTotalHalala, 5000);
  assert.strictEqual(summary.vatHalala, 5152);
  assert.strictEqual(summary.netBeforeVatHalala, 34348);
  assert.strictEqual(summary.byPaymentMethod.find((row) => row.method === "cash").labelAr, "نقدي");
}

function testMonthlyValidation() {
  assert.strictEqual(normalizeMonth("2026-07"), "2026-07");
  assert.strictEqual(listMonthDates("2026-02").length, 28);
  assert.strictEqual(listMonthDates("2028-02").length, 29);
  assert.throws(() => normalizeMonth("07-2026"), /صيغة الشهر/);
  assert.throws(() => normalizeMonth("2026-13"), /الشهر غير صالح/);
}

function run() {
  testPaymentMethodClassification();
  testArabicMoneyAndSummary();
  testMonthlyValidation();
  console.log("subscription payment report presentation tests passed");
}

run();

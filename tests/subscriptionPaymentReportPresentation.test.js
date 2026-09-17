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
  assert.strictEqual(normalizeRecordedPaymentMethod({ provider: "moyasar", providerPaymentId: "pay_123" }), "moyasar");
  assert.strictEqual(
    normalizeRecordedPaymentMethod(
      { provider: "moyasar" },
      { action: "subscription_cash_payment_collected", meta: {} }
    ),
    "cash"
  );
  assert.strictEqual(normalizeRecordedPaymentMethod({ provider: "moyasar" }), "moyasar");

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
    item({ customerId: "customer-3", paymentMethod: "moyasar", amountHalala: 10000, vatHalala: 1379, netBeforeVatHalala: 8621 }),
    item({ paymentMethod: "unknown", amountHalala: 5000, vatHalala: 652, netBeforeVatHalala: 4348, needsReview: true }),
  ]);
  assert.strictEqual(summary.totalPaymentsCount, 4);
  assert.strictEqual(summary.uniqueCustomersCount, 3);
  assert.strictEqual(summary.totalHalala, 49500);
  assert.strictEqual(summary.cashTotalHalala, 11500);
  assert.strictEqual(summary.visaTotalHalala, 23000);
  assert.strictEqual(summary.moyasarCount, 1);
  assert.strictEqual(summary.moyasarTotalHalala, 10000);
  assert.strictEqual(summary.unknownTotalHalala, 5000);
  assert.strictEqual(summary.vatHalala, 6531);
  assert.strictEqual(summary.netBeforeVatHalala, 42969);
  assert.strictEqual(summary.byPaymentMethod.find((row) => row.method === "cash").labelAr, "نقدي");
  assert.strictEqual(summary.byPaymentMethod.find((row) => row.method === "visa").labelAr, "بوابة دفع إلكتروني");
  assert.strictEqual(summary.byPaymentMethod.find((row) => row.method === "moyasar").labelAr, "ميسر");

  const refundSummary = buildPaymentMethodSummary(
    [
      item({
        movementType: "collection",
        paymentProvider: "none",
        amountHalala: 11500,
        vatHalala: 1500,
        netBeforeVatHalala: 10000,
      }),
    ],
    [
      item({
        movementType: "refund",
        countedInTotals: true,
        amountHalala: 2300,
        vatHalala: 300,
        netBeforeVatHalala: 2000,
      }),
      item({
        movementType: "refund",
        countedInTotals: false,
        amountHalala: 1150,
        vatHalala: 150,
        netBeforeVatHalala: 1000,
      }),
    ]
  );
  assert.strictEqual(refundSummary.grossCollectionHalala, 11500);
  assert.strictEqual(refundSummary.refundsHalala, 2300);
  assert.strictEqual(refundSummary.netCollectionHalala, 9200);
  assert.strictEqual(refundSummary.salesVatHalala, 1500);
  assert.strictEqual(refundSummary.refundVatHalala, 300);
  assert.strictEqual(refundSummary.netVatHalala, 1200);
  assert.strictEqual(
    refundSummary.netCollectionHalala,
    refundSummary.netBeforeVatHalala + refundSummary.netVatHalala
  );
  assert.strictEqual(refundSummary.refundsTrackingStatus, "needs_review");
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

"use strict";

const assert = require("assert");
const {
  decorateReport,
  normalizeExistingItemAxes,
  resolvePaymentProviderFromPayment,
  resolveSourceChannelFromPayment,
} = require("../src/services/dashboard/subscriptionPaymentAccountingFacade");

function collection(overrides = {}) {
  return {
    movementId: "payment-1",
    movementType: "collection",
    paymentId: "payment-1",
    paymentReference: "PAY-1",
    customerId: "customer-1",
    paymentMethod: "card",
    paymentMethodLabelAr: "بطاقة / بوابة إلكترونية",
    provider: "moyasar",
    source: "mobile_app_subscription",
    sourceChannel: "app",
    paymentProvider: "moyasar",
    amountHalala: 30000,
    vatHalala: 3913,
    netBeforeVatHalala: 26087,
    netMovementHalala: 30000,
    subscriptionStatus: "active",
    reviewReasonsAr: [],
    needsReview: false,
    paidAt: "2026-08-05T08:00:00.000Z",
    businessDate: "2026-08-05",
    ...overrides,
  };
}

function run() {
  assert.strictEqual(
    resolveSourceChannelFromPayment({ provider: "moyasar" }),
    "app"
  );
  assert.strictEqual(
    resolvePaymentProviderFromPayment({ provider: "moyasar" }, "card"),
    "moyasar"
  );

  const normalized = normalizeExistingItemAxes(collection({
    paymentMethod: "moyasar",
    sourceChannel: "unknown",
    paymentProvider: "unknown",
  }));
  assert.strictEqual(normalized.paymentMethod, "card");
  assert.strictEqual(normalized.sourceChannel, "app");
  assert.strictEqual(normalized.paymentProvider, "moyasar");

  const cash = collection({
    movementId: "payment-2",
    paymentId: "payment-2",
    paymentReference: "PAY-2",
    customerId: "customer-2",
    paymentMethod: "cash",
    provider: "cash",
    source: "dashboard_subscription_cash",
    sourceChannel: "dashboard",
    paymentProvider: "none",
    amountHalala: 10000,
    vatHalala: 1304,
    netBeforeVatHalala: 8696,
    netMovementHalala: 10000,
    paidAt: "2026-08-05T09:00:00.000Z",
  });

  const orphan = collection({
    movementId: "orphan-payment:3",
    paymentId: "payment-3",
    paymentReference: "PAY-3",
    customerId: "customer-3",
    amountHalala: 15000,
    vatHalala: 1957,
    netBeforeVatHalala: 13043,
    netMovementHalala: 15000,
    subscriptionRecordPresent: false,
    reviewReasonsAr: ["سجل الاشتراك المرتبط بالدفعة غير موجود"],
    needsReview: true,
    paidAt: "2026-08-05T10:00:00.000Z",
  });

  const report = decorateReport({
    reportType: "daily",
    businessDate: "2026-08-05",
    businessDateLabelAr: "5 أغسطس 2026",
    items: [collection(), cash],
    warnings: [],
    accountingPolicyAr: {},
  }, [orphan], true);

  assert.strictEqual(report.summary.grossCollectionHalala, 55000);
  assert.strictEqual(report.summary.cardTotalHalala, 45000);
  assert.strictEqual(report.summary.cashTotalHalala, 10000);
  assert.strictEqual(report.summary.moyasarTotalHalala, 45000);

  const allocated = report.byPaymentMethod.reduce(
    (sum, row) => sum + row.totalHalala,
    0
  );
  assert.strictEqual(allocated, report.summary.grossCollectionHalala);
  assert.strictEqual(report.reconciliation.differenceHalala, 0);

  const moyasar = report.byPaymentProvider.find(
    (row) => row.paymentProvider === "moyasar"
  );
  assert(moyasar);
  assert.strictEqual(moyasar.totalHalala, 45000);

  assert(report.warnings.some(
    (warning) => warning.code === "PAYMENT_SUBSCRIPTION_RECORD_MISSING"
  ));
  assert(report.dashboardCards.some(
    (card) => card.titleAr === "منها عبر ميسر"
  ));
  assert.strictEqual(report.items.length, 3);
  assert(report.accountingPolicyAr.paymentMethodTreatment.includes("لا يُجمع مرتين"));

  console.log("subscription payment accounting facade tests passed");
}

run();

"use strict";

const assert = require("assert");
const {
  buildInvoiceFinancialSnapshot,
  buildRefundSummary,
  buildInvoiceNumber,
  findLegacyPrimaryInvoicePayment,
} = require("../src/controllers/dashboard/subscriptionInvoiceController");

function sumLineItems(rows) {
  return rows.reduce((sum, row) => sum + row.amountHalala, 0);
}

// Purchase-time checkout snapshot must win over later/current aggregate subscription pricing.
{
  const snapshot = buildInvoiceFinancialSnapshot({
    subscription: {
      totalPriceHalala: 99900,
      basePlanPriceHalala: 90000,
      deliveryFeeHalala: 9900,
      discountHalala: 0,
      premiumBalance: [],
      addonSubscriptions: [],
    },
    payment: { amount: 11500 },
    checkoutDraft: {
      breakdown: {
        basePlanPriceHalala: 10000,
        basePlanGrossHalala: 10000,
        basePlanNetHalala: 10000,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 1500,
        discountHalala: 0,
        totalHalala: 11500,
      },
    },
    paymentCount: 1,
  });

  assert.strictEqual(snapshot.authoritativeTotalHalala, 11500);
  assert.strictEqual(snapshot.snapshotSource, "checkout_draft");
  assert.strictEqual(snapshot.deliveryFeeHalala, 1500);
  assert.strictEqual(sumLineItems(snapshot.lineItems), 11500);
  assert.ok(snapshot.lineItems.some((row) => row.kind === "plan" && row.amountHalala === 10000));
  assert.ok(!snapshot.lineItems.some((row) => row.amountHalala === 90000));
}

// Stacked/multi-purchase subscriptions must never use the aggregate Subscription breakdown
// to describe one individual historical payment when no checkout snapshot is available.
{
  const snapshot = buildInvoiceFinancialSnapshot({
    subscription: {
      totalPriceHalala: 25000,
      basePlanPriceHalala: 23000,
      deliveryFeeHalala: 2000,
      premiumBalance: [],
      addonSubscriptions: [],
    },
    payment: { amount: 10000 },
    checkoutDraft: null,
    paymentCount: 2,
  });

  assert.strictEqual(snapshot.authoritativeTotalHalala, 10000);
  assert.strictEqual(snapshot.snapshotSource, "payment_record");
  assert.strictEqual(snapshot.reconciliationStatus, "payment_scoped_multi_purchase");
  assert.deepStrictEqual(snapshot.lineItems, [
    {
      kind: "historical_payment_total",
      labelAr: "المبلغ المدفوع تاريخياً",
      amountHalala: 10000,
    },
  ]);
}

// Exact checkout components, including discount, must reconcile in integer halalas.
{
  const snapshot = buildInvoiceFinancialSnapshot({
    subscription: { totalPriceHalala: 99999 },
    payment: { amount: 15000 },
    checkoutDraft: {
      breakdown: {
        basePlanGrossHalala: 12000,
        basePlanNetHalala: 10500,
        premiumTotalHalala: 3000,
        addonsTotalHalala: 1000,
        deliveryFeeHalala: 500,
        discountHalala: 1500,
        totalHalala: 15000,
      },
    },
    paymentCount: 1,
  });

  assert.strictEqual(snapshot.discountHalala, 1500);
  assert.strictEqual(sumLineItems(snapshot.lineItems), 15000);
  assert.ok(snapshot.lineItems.some((row) => row.kind === "discount" && row.amountHalala === -1500));
}

// If a legacy snapshot differs from the immutable Payment amount, Payment stays authoritative
// and an explicit adjustment keeps the printed arithmetic exact instead of silently drifting.
{
  const snapshot = buildInvoiceFinancialSnapshot({
    subscription: { totalPriceHalala: 11500 },
    payment: { amount: 11499 },
    checkoutDraft: {
      breakdown: {
        basePlanPriceHalala: 10000,
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 1500,
        discountHalala: 0,
        totalHalala: 11500,
      },
    },
    paymentCount: 1,
  });

  assert.strictEqual(snapshot.authoritativeTotalHalala, 11499);
  assert.strictEqual(snapshot.reconciliationStatus, "payment_authoritative_snapshot_mismatch");
  assert.strictEqual(sumLineItems(snapshot.lineItems), 11499);
  assert.ok(
    snapshot.lineItems.some(
      (row) => row.kind === "payment_reconciliation_adjustment" && row.amountHalala === -1
    )
  );
}

// Refund recognition is reported separately and does not mutate the original invoice total.
{
  const refunds = buildRefundSummary([
    {
      _id: "refund-a",
      amountHalala: 3000,
      vatHalala: 391,
      executionMode: "recorded_only",
      refundChannel: "cash",
      settlement: { status: "partially_settled", settledAmountHalala: 1000 },
    },
    {
      _id: "refund-b",
      amountHalala: 500,
      vatHalala: 65,
      executionMode: "provider_confirmed",
      refundChannel: "moyasar",
      settlement: { status: "settled", settledAmountHalala: 0 },
    },
  ]);

  assert.strictEqual(refunds.recognizedAmountHalala, 3500);
  assert.strictEqual(refunds.settledAmountHalala, 1500);
  assert.strictEqual(refunds.pendingSettlementAmountHalala, 2000);
}

// Preserve the exact legacy invoice identity for the purchase that the old endpoint used to expose.
// Additional stacked/renewal purchases receive their own payment-scoped invoice numbers.
{
  const subscription = {
    _id: "66aaaaaaaaaaaaaaaaaaaaaa",
    createdAt: "2026-08-01T10:00:00.000Z",
  };
  const activation = {
    _id: "66bbbbbbbbbbbbbbbbbbbbbb",
    type: "subscription_activation",
    paidAt: "2026-08-10T10:00:00.000Z",
  };
  const renewal = {
    _id: "66cccccccccccccccccccccc",
    type: "subscription_renewal",
    paidAt: "2026-08-20T10:00:00.000Z",
  };

  const legacyPrimary = findLegacyPrimaryInvoicePayment([renewal, activation]);
  assert.strictEqual(String(legacyPrimary._id), String(activation._id));

  const originalInvoiceNumber = buildInvoiceNumber(
    subscription,
    activation,
    activation.paidAt,
    { preserveLegacy: true }
  );
  const renewalInvoiceNumber = buildInvoiceNumber(
    subscription,
    renewal,
    renewal.paidAt,
    { preserveLegacy: false }
  );

  assert.strictEqual(originalInvoiceNumber, "INV-202608-AAAAAAAA");
  assert.ok(renewalInvoiceNumber.startsWith("INV-202608-"));
  assert.notStrictEqual(originalInvoiceNumber, renewalInvoiceNumber);

  // A single historical renewal-only subscription also keeps the old subscription-based number.
  const renewalOnlyPrimary = findLegacyPrimaryInvoicePayment([renewal]);
  assert.strictEqual(String(renewalOnlyPrimary._id), String(renewal._id));
  assert.strictEqual(
    buildInvoiceNumber(subscription, renewal, renewal.paidAt, { preserveLegacy: true }),
    "INV-202608-AAAAAAAA"
  );
}

console.log("subscription invoice historical pricing test: PASS");
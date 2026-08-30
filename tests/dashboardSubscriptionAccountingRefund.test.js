"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Payment = require("../src/models/Payment");
const PaymentRefund = require("../src/models/PaymentRefund");
const Plan = require("../src/models/Plan");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const dateUtils = require("../src/utils/date");
const {
  executeFinancialControl,
  getFinancialControlPreview,
  settleRecordedRefund,
} = require("../src/services/dashboard/subscriptionFinancialControlNoTxnService");
const {
  buildDailySubscriptionPaymentReport,
} = require("../src/services/dashboard/subscriptionPaymentMethodReportService");

async function main() {
  const mongo = await MongoMemoryServer.create();
  const dbName = `dashboard_accounting_refund_${process.pid}`;

  try {
    await mongoose.connect(mongo.getUri(dbName));

    const user = await User.create({
      phone: "+966511117777",
      name: "Accounting Refund Test Customer",
      role: "client",
      isActive: true,
    });
    const plan = await Plan.create({
      name: { ar: "باقة اختبار الاسترجاع المحاسبي", en: "Accounting Refund Test" },
      daysCount: 7,
      currency: "SAR",
      isActive: true,
      gramsOptions: [{
        grams: 150,
        isActive: true,
        mealsOptions: [{
          mealsPerDay: 1,
          priceHalala: 10000,
          compareAtHalala: 10000,
          isActive: true,
        }],
      }],
    });
    const subscription = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      status: "active",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      validityEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      totalMeals: 7,
      remainingMeals: 7,
      selectedMealsPerDay: 1,
      selectedGrams: 150,
      deliveryMode: "pickup",
      totalPriceHalala: 10000,
      subtotalBeforeVatHalala: 8696,
      vatHalala: 1304,
    });
    const payment = await Payment.create({
      provider: "cash",
      type: "subscription_activation",
      status: "paid",
      amount: 10000,
      currency: "SAR",
      userId: user._id,
      subscriptionId: subscription._id,
      source: "dashboard_subscription_cash",
      method: "cash",
      applied: true,
      paidAt: new Date(),
    });

    const actorId = new mongoose.Types.ObjectId();
    const operationKey = "acct_refund_standalone_001";
    const first = await executeFinancialControl({
      subscriptionId: String(subscription._id),
      payload: {
        action: "refund",
        operationKey,
        reason: "customer refund approved",
        paymentId: String(payment._id),
        refundMode: "partial",
        refundChannel: "moyasar",
        amountHalala: 4000,
      },
      actorId: String(actorId),
      actorRole: "superadmin",
      requestMeta: { ip: "127.0.0.1", userAgent: "test" },
      lang: "ar",
    });

    assert.equal(first.replayed, false);
    assert.equal(first.operation.status, "completed");
    assert.equal(first.operation.accountingOnly, true);
    assert.equal(first.operation.refundChannel, "moyasar");

    const refunds = await PaymentRefund.find({ paymentId: payment._id }).lean();
    assert.equal(refunds.length, 1, "accounting refund must create exactly one ledger row");
    const refund = refunds[0];
    assert.equal(refund.provider, "none");
    assert.equal(refund.executionMode, "recorded_only");
    assert.equal(refund.refundChannel, "moyasar");
    assert.equal(refund.amountHalala, 4000);
    assert.equal(refund.status, "confirmed");
    assert.equal(refund.settlement.status, "pending");
    assert.equal(refund.settlement.method, "moyasar");
    assert.equal(refund.settlement.settledAmountHalala, 0);
    assert.equal(refund.rawReference.moneyMovementPerformed, false);

    const paymentAfterRecord = await Payment.findById(payment._id).lean();
    assert.equal(paymentAfterRecord.status, "paid");
    assert.equal(paymentAfterRecord.metadata.accountingRefundedHalala, 4000);
    assert.equal(paymentAfterRecord.metadata.accountingRefundStatus, "partially_refunded");
    assert.equal(paymentAfterRecord.metadata.providerRefundedHalala, undefined);
    assert.equal(paymentAfterRecord.metadata.providerRefundStatus, undefined);

    const replay = await executeFinancialControl({
      subscriptionId: String(subscription._id),
      payload: {
        action: "refund",
        operationKey,
        reason: "customer refund approved",
        paymentId: String(payment._id),
        refundMode: "partial",
        refundChannel: "moyasar",
        amountHalala: 4000,
      },
      actorId: String(actorId),
      actorRole: "superadmin",
      requestMeta: { ip: "127.0.0.1", userAgent: "test" },
      lang: "ar",
    });
    assert.equal(replay.replayed, true);
    assert.equal(await PaymentRefund.countDocuments({ paymentId: payment._id }), 1);

    const preview = await getFinancialControlPreview({
      subscriptionId: String(subscription._id),
    });
    assert.equal(preview.accountingOnly, true);
    assert.equal(preview.moneyMovementEnabled, false);
    assert.equal(preview.totalRefundableHalala, 6000);
    assert.equal(preview.pendingSettlementHalala, 4000);
    assert.equal(preview.refunds.length, 1);
    assert.equal(preview.refunds[0].settlement.status, "pending");

    const settlement = await settleRecordedRefund({
      subscriptionId: String(subscription._id),
      refundId: String(refund._id),
      payload: {
        method: "cash",
        reference: "CASH-RECEIPT-001",
        note: "Money returned outside the dashboard",
      },
      actorId: String(actorId),
      actorRole: "superadmin",
    });
    assert.equal(settlement.replayed, false);
    assert.equal(settlement.refund.refundChannel, "moyasar");
    assert.equal(settlement.refund.settlement.status, "settled");
    assert.equal(settlement.refund.settlement.method, "cash");
    assert.equal(settlement.refund.settlement.settledAmountHalala, 4000);

    const settlementReplay = await settleRecordedRefund({
      subscriptionId: String(subscription._id),
      refundId: String(refund._id),
      payload: { method: "cash" },
      actorId: String(actorId),
      actorRole: "superadmin",
    });
    assert.equal(settlementReplay.replayed, true);

    const refundForReport = await PaymentRefund.findById(refund._id).lean();
    assert.equal(refundForReport.refundChannel, "moyasar");
    assert.equal(refundForReport.settlement.method, "cash");
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { paidAt: refundForReport.refundedAt } }
    );
    const businessDate = dateUtils.toKSADateString(refundForReport.refundedAt);
    const report = await buildDailySubscriptionPaymentReport({ date: businessDate });
    assert.equal(report.summary.grossCollectionHalala, 10000);
    assert.equal(report.summary.refundsHalala, 4000);
    assert.equal(report.summary.netCollectionHalala, 6000);
    assert.equal(report.summary.refundsCount, 1);
    assert.equal(report.reconciliation.movementDifferenceHalala, 0);
    assert.equal(report.reconciliation.vatDifferenceHalala, 0);

    console.log("dashboardSubscriptionAccountingRefund.test.js: OK");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await mongo.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

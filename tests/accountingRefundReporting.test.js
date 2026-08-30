"use strict";

process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || "accounting-refund-test-secret";
process.env.MOYASAR_WEBHOOK_SECRET = process.env.MOYASAR_WEBHOOK_SECRET || "accounting-refund-webhook-secret";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");

const { createApp } = require("../src/app");
const Payment = require("../src/models/Payment");
const PaymentRefund = require("../src/models/PaymentRefund");
const Plan = require("../src/models/Plan");
const Setting = require("../src/models/Setting");
const Subscription = require("../src/models/Subscription");
const User = require("../src/models/User");
const accountingDailyReportService = require("../src/services/dashboard/accountingDailyReportService");
const {
  buildDailySubscriptionPaymentReport,
  buildMonthlySubscriptionPaymentReport,
} = require("../src/services/dashboard/subscriptionPaymentMethodReportService");
const {
  buildMoyasarRefundIdempotencyKey,
  extractMoyasarRefundSnapshot,
} = require("../src/services/paymentRefundService");

function refundPayload({ paymentId, cumulative, refundedAt, webhookId }) {
  return {
    id: webhookId,
    secret_token: process.env.MOYASAR_WEBHOOK_SECRET,
    type: "payment_refunded",
    data: {
      id: paymentId,
      status: "refunded",
      amount: 10000,
      refunded: cumulative,
      refunded_at: refundedAt,
      currency: "SAR",
    },
  };
}

async function main() {
  const fullDay = accountingDailyReportService.resolveFullDayPeriod("2026-08-01");
  assert.equal(fullDay.start.toISOString(), "2026-07-31T21:00:00.000Z");
  assert.equal(fullDay.end.toISOString(), "2026-08-01T20:59:59.999Z");

  const snapshot = extractMoyasarRefundSnapshot({
    payload: { id: "webhook-1" },
    data: {
      id: "provider-payment-1",
      refunded: 3000,
      refunded_at: "2026-08-01T08:00:00.000Z",
    },
  });
  assert.equal(snapshot.cumulativeRefundedHalala, 3000);
  assert.equal(buildMoyasarRefundIdempotencyKey(snapshot), "webhook:webhook-1");

  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const dbName = `accounting_refund_${process.pid}_test`;
  try {
    await mongoose.connect(mongo.getUri(dbName));
    const user = await User.create({
      phone: "+966511119955",
      name: "Accounting Refund Customer",
      role: "client",
      isActive: true,
    });
    const plan = await Plan.create({
      name: { ar: "باقة اختبار المرتجعات", en: "Accounting Refund Test" },
      daysCount: 28,
      currency: "SAR",
      isActive: true,
      gramsOptions: [{
        grams: 100,
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
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      endDate: new Date("2026-08-31T00:00:00.000Z"),
      validityEndDate: new Date("2026-08-31T00:00:00.000Z"),
      totalMeals: 28,
      remainingMeals: 28,
      selectedMealsPerDay: 1,
      deliveryMode: "pickup",
      totalPriceHalala: 10000,
      subtotalBeforeVatHalala: 8696,
      vatHalala: 1304,
    });
    await Setting.create([
      { key: "restaurant_open_time", value: "10:00" },
      { key: "restaurant_close_time", value: "18:00" },
    ]);

    const providerPaymentId = `refund-provider-${Date.now()}`;
    const moyasarPayment = await Payment.create({
      provider: "moyasar",
      type: "subscription_activation",
      status: "paid",
      amount: 10000,
      currency: "SAR",
      userId: user._id,
      subscriptionId: subscription._id,
      providerPaymentId,
      source: "mobile_app_subscription",
      metadata: { paymentOrigin: "mobile_app", recordingMode: "moyasar_gateway" },
      applied: true,
      paidAt: new Date("2026-07-15T09:00:00.000Z"),
    });
    await Payment.create([
      {
        provider: "cash",
        type: "subscription_activation",
        status: "paid",
        amount: 70200,
        currency: "SAR",
        userId: user._id,
        subscriptionId: subscription._id,
        source: "dashboard_subscription_cash",
        applied: true,
        paidAt: new Date("2026-07-31T21:00:00.000Z"),
      },
      {
        provider: "manual",
        type: "subscription_renewal",
        status: "paid",
        amount: 11500,
        currency: "SAR",
        userId: user._id,
        subscriptionId: subscription._id,
        source: "dashboard_subscription_visa",
        method: "visa",
        applied: true,
        paidAt: new Date("2026-08-01T10:00:00.000Z"),
      },
      {
        provider: "moyasar",
        type: "subscription_renewal",
        status: "initiated",
        amount: 99900,
        currency: "SAR",
        userId: user._id,
        subscriptionId: subscription._id,
        paidAt: new Date("2026-08-01T11:00:00.000Z"),
      },
      {
        provider: "moyasar",
        type: "subscription_renewal",
        status: "failed",
        amount: 88800,
        currency: "SAR",
        userId: user._id,
        subscriptionId: subscription._id,
        paidAt: new Date("2026-08-01T12:00:00.000Z"),
      },
    ]);

    const api = request(createApp());
    const firstPayload = refundPayload({
      paymentId: providerPaymentId,
      cumulative: 3000,
      refundedAt: "2026-08-01T08:00:00.000Z",
      webhookId: "refund-webhook-1",
    });
    const first = await api.post("/api/webhooks/moyasar").send(firstPayload);
    const duplicate = await api.post("/api/webhooks/moyasar").send(firstPayload);
    const second = await api.post("/api/webhooks/moyasar").send(refundPayload({
      paymentId: providerPaymentId,
      cumulative: 5000,
      refundedAt: "2026-08-01T12:00:00.000Z",
      webhookId: "refund-webhook-2",
    }));
    const full = await api.post("/api/webhooks/moyasar").send(refundPayload({
      paymentId: providerPaymentId,
      cumulative: 10000,
      refundedAt: "2026-08-01T13:00:00.000Z",
      webhookId: "refund-webhook-3",
    }));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
    assert.equal(duplicate.body.alreadyProcessed, true);
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(full.status, 200, JSON.stringify(full.body));

    const [refunds, refreshedPayment] = await Promise.all([
      PaymentRefund.find({ paymentId: moyasarPayment._id }).sort({ refundedAt: 1 }).lean(),
      Payment.findById(moyasarPayment._id).lean(),
    ]);
    assert.deepEqual(refunds.map((row) => row.amountHalala), [3000, 2000, 5000]);
    assert.equal(refunds.reduce((sum, row) => sum + row.amountHalala, 0), 10000);
    assert.equal(refunds.reduce((sum, row) => sum + row.vatHalala, 0), 1304);
    assert.equal(new Set(refunds.map((row) => row.idempotencyKey)).size, 3);
    assert(refunds.every((row) => row.executionMode === "provider_confirmed"));
    assert(refunds.every((row) => row.refundChannel === "moyasar"));
    assert(refunds.every((row) => row.settlement && row.settlement.status === "settled"));
    assert.equal(refreshedPayment.status, "paid", "gross collection must remain paid");

    const report = await buildDailySubscriptionPaymentReport({ date: "2026-08-01" });
    assert.equal(report.period.timezone, "Asia/Riyadh");
    assert.equal(report.period.openTime, "00:00");
    assert.equal(report.period.closeTime, "23:59");
    assert.equal(report.period.start, "2026-07-31T21:00:00.000Z");
    assert.equal(report.period.end, "2026-08-01T20:59:59.999Z");
    assert.equal(report.summary.totalPaymentsCount, 2);
    assert.equal(report.summary.grossCollectionHalala, 81700);
    assert.equal(report.summary.refundsCount, 3);
    assert.equal(report.summary.refundsHalala, 10000);
    assert.equal(report.summary.refundVatHalala, 1304);
    assert.equal(report.summary.netCollectionHalala, 71700);
    assert.equal(
      report.summary.netCollectionHalala,
      report.summary.grossCollectionHalala - report.summary.refundsHalala
    );
    assert.equal(
      report.summary.netCollectionHalala,
      report.summary.netBeforeVatHalala + report.summary.netVatHalala
    );
    assert.equal(report.summary.cashCount, 1);
    assert.equal(report.summary.cardCount, 1);
    const refundRows = report.items.filter((row) => row.movementType === "refund");
    const collectionRows = report.items.filter((row) => row.movementType === "collection");
    assert.equal(refundRows.length, 3);
    assert.equal(report.reconciliation.differenceHalala, 0);
    assert.equal(report.reconciliation.movementDifferenceHalala, 0);
    assert.equal(report.reconciliation.vatDifferenceHalala, 0);
    assert.equal(
      collectionRows.reduce((sum, row) => sum + row.netBeforeVatHalala, 0)
        + refundRows.reduce((sum, row) => sum + row.netBeforeVatHalala, 0),
      report.summary.netBeforeVatHalala
    );
    assert(report.items.some((row) => row.sourceChannel === "dashboard" && row.paymentMethod === "cash"));
    assert(report.items.some((row) => row.paymentProvider === "manual_gateway" && row.paymentMethod === "card"));
    assert.equal(report.items.some((row) => row.amountHalala === 99900), false);
    assert.equal(report.items.some((row) => row.amountHalala === 88800), false);

    const julyReport = await buildDailySubscriptionPaymentReport({ date: "2026-07-15" });
    assert.equal(julyReport.summary.grossCollectionHalala, 10000);
    assert.equal(julyReport.summary.refundsHalala, 0);
    assert.equal(julyReport.summary.netCollectionHalala, 10000);

    const monthlyReport = await buildMonthlySubscriptionPaymentReport({ month: "2026-08" });
    assert.equal(monthlyReport.month, "2026-08");
    assert.equal(monthlyReport.businessMonth, "2026-08");
    assert.equal(monthlyReport.period.timezone, "Asia/Riyadh");
    assert.equal(monthlyReport.period.openTime, "00:00");
    assert.equal(monthlyReport.period.closeTime, "23:59");
  } finally {
    await mongoose.disconnect().catch(() => {});
    await mongo.stop();
  }
}

main().then(() => {
  console.log("accountingRefundReporting.test.js: ok");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

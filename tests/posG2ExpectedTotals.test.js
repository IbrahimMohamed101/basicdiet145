"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { businessDateAt, boundsForBusinessDate } = require("../src/services/pos/businessDate");
const { summarizeExpectedTotals } = require("../src/services/pos/expectedTotals");
const { reconcileCountedWithServer } = require("../src/services/dashboard/dailyCashClosingService");

test("POS G2: Riyadh date changes at 21:00 UTC and bounds are exclusive", () => {
  assert.equal(businessDateAt(new Date("2026-11-07T20:59:59.000Z")), "2026-11-07");
  assert.equal(businessDateAt(new Date("2026-11-07T21:00:00.000Z")), "2026-11-08");
  const { start, end } = boundsForBusinessDate("2026-11-08");
  assert.equal(start.toISOString(), "2026-11-07T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-11-08T21:00:00.000Z");
  assert.throws(() => boundsForBusinessDate("2026-02-31"), /Invalid/);
});

test("POS G2: 3 sales, partial refund and two dashboard subscriptions reconcile in halalas", () => {
  const invoices = [
    { _id: "sale1", channel: "restaurant", tender: { method: "cash" },
      totals: { grossHalalas: 4200, vatHalalas: 548 } },
    { _id: "sale2", channel: "restaurant", tender: { method: "network" },
      totals: { grossHalalas: 300, vatHalalas: 39 } },
    { _id: "sale3", channel: "hungerstation", tender: { method: "app_receivable" },
      totals: { grossHalalas: 3400, vatHalalas: 443 } },
  ];
  const refunds = [{ _id: "refund1", invoiceId: "sale1", method: "cash",
    totals: { grossHalalas: 150, vatHalalas: 20 } }];
  const payments = [
    { source: "dashboard_subscription_cash", collectedBy: "cashier1", amount: 10000 },
    { source: "dashboard_subscription_visa", collectedBy: "cashier1", amount: 20000 },
  ];
  const totals = summarizeExpectedTotals({
    businessDate: "2026-11-08", invoices, refunds, relatedInvoices: [], payments,
  });
  assert.equal(totals.pos.invoiceCount, 3);
  assert.equal(totals.pos.refundCount, 1);
  assert.equal(totals.pos.restaurantCashHalalas, 4050);
  assert.equal(totals.pos.restaurantNetworkHalalas, 300);
  assert.equal(totals.pos.appReceivableByChannelHalalas.hungerstation, 3400);
  assert.equal(totals.pos.netHalalas, 7750);
  assert.equal(totals.subscriptions.cashHalalas, 10000);
  assert.equal(totals.subscriptions.visaHalalas, 20000);
  assert.equal(totals.subscriptions.byCollector.cashier1.paymentCount, 2);
  assert.equal(totals.expected.cashHalalas, 14050);
  assert.equal(totals.expected.networkHalalas, 20300);
  assert.equal(totals.expected.totalHalalas, 37750);
  const same = reconcileCountedWithServer({ cashHalala: 14050, cardHalala: 20300 }, totals);
  assert.equal(same.localDifferenceHalala, 0);
  const short = reconcileCountedWithServer({ cashHalala: 14049, cardHalala: 20300 }, totals);
  assert.equal(short.cashDifferenceHalala, -1);
  assert.equal(short.localDifferenceHalala, -1);
});

test("POS G2: app refund on a previous-day invoice adjusts current-day channel receivable", () => {
  const totals = summarizeExpectedTotals({
    businessDate: "2026-11-08", invoices: [],
    relatedInvoices: [{ _id: "previous", channel: "keeta", tender: { method: "app_receivable" } }],
    refunds: [{ invoiceId: "previous", method: "external", totals: { grossHalalas: 500, vatHalalas: 65 } }],
    payments: [],
  });
  assert.equal(totals.pos.appReceivableByChannelHalalas.keeta, -500);
  assert.equal(totals.pos.netHalalas, -500);
  assert.equal(totals.expected.totalHalalas, -500);
});

test("POS G2: no POS/Payment double count and orphaned refunds are flagged", () => {
  const totals = summarizeExpectedTotals({
    businessDate: "2026-11-08",
    invoices: [{ _id: "a", channel: "restaurant", tender: { method: "cash" },
      totals: { grossHalalas: 500, vatHalalas: 65 } }],
    refunds: [{ invoiceId: "missing", method: "cash", totals: { grossHalalas: 100, vatHalalas: 13 } }],
    relatedInvoices: [],
    payments: [{ source: "moyasar", amount: 500 }, { source: "dashboard_subscription_cash", amount: 1000 }],
  });
  assert.equal(totals.pos.unresolvedRefundInvoiceCount, 1);
  assert.equal(totals.subscriptions.cashHalalas, 1000);
  assert.equal(totals.subscriptions.paymentCount, 2);
});

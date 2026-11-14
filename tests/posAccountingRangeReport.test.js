"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePosReportQuery, summarizePosRows } =
  require("../src/services/dashboard/posAccountingRangeReportService");

test("POS accountant range is strict and bounded; no implicit all-time scan", () => {
  assert.deepEqual(parsePosReportQuery({ from: "2026-11-15", to: "2026-11-15" }),
    { from: "2026-11-15", to: "2026-11-15", days: 1, limit: 100, offset: 0 });
  assert.throws(() => parsePosReportQuery({}), /التاريخ/);
  assert.throws(() => parsePosReportQuery({ from: "2026-02-30", to: "2026-03-01" }), /التاريخ/);
  assert.throws(() => parsePosReportQuery({ from: "2026-11-16", to: "2026-11-15" }), /النطاق/);
  assert.throws(() => parsePosReportQuery({ from: "2025-01-01", to: "2026-11-15" }), /النطاق/);
  assert.throws(() => parsePosReportQuery({ from: "2026-11-15", to: "2026-11-15",
    limit: 1000 }), /التصفح/);
});

test("POS cash/network distinct from app receivables and refunds", () => {
  const invoices = [
    { _id: { businessDate: "2026-11-15", channel: "restaurant", tender: "cash" },
      count: 2, grossHalalas: 1400, vatHalalas: 182, netHalalas: 1218 },
    { _id: { businessDate: "2026-11-15", channel: "restaurant", tender: "network" },
      count: 1, grossHalalas: 700, vatHalalas: 91, netHalalas: 609 },
    { _id: { businessDate: "2026-11-15", channel: "jahez", tender: "app_receivable" },
      count: 1, grossHalalas: 2300, vatHalalas: 300, netHalalas: 2000 },
  ];
  const refunds = [
    { _id: { businessDate: "2026-11-15", channel: "restaurant", method: "network" },
      count: 1, grossHalalas: 700, vatHalalas: 91 },
    { _id: { businessDate: "2026-11-16", channel: "jahez", method: "external" },
      count: 1, grossHalalas: 300, vatHalalas: 39 },
  ];
  const { summary, channels, daily } = summarizePosRows(invoices, refunds);
  assert.equal(summary.invoiceCount, 4);
  assert.equal(summary.grossHalalas, 4400);
  assert.equal(summary.cashGrossHalalas, 1400);
  assert.equal(summary.networkGrossHalalas, 700);
  assert.equal(summary.appReceivableGrossHalalas, 2300);
  assert.equal(summary.refundDocumentsHalalas, 1000);
  assert.equal(summary.netAfterRefundDocumentsHalalas, 3400);
  assert.equal(summary.networkRefundDocumentsHalalas, 700);
  assert.equal(summary.externalRefundDocumentsHalalas, 300);
  assert.deepEqual(channels.map(x => [x.channel, x.netAfterRefundDocumentsHalalas]),
    [["jahez", 2000], ["restaurant", 1400]]);
  assert.deepEqual(daily.map(x => [x.businessDate, x.netAfterRefundDocumentsHalalas]),
    [["2026-11-15", 3700], ["2026-11-16", -300]]);
  assert.equal(summary.vatHalalas, 573);
  assert.equal(summary.refundVatHalalas, 130);
});

test("only server group totals participate; empty report is zero, not fabricated revenue", () => {
  const result = summarizePosRows([], []);
  assert.equal(result.summary.invoiceCount, 0);
  assert.equal(result.summary.grossHalalas, 0);
  assert.equal(result.summary.netAfterRefundDocumentsHalalas, 0);
  assert.deepEqual(result.channels, []);
});

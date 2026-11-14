"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePosReportQuery } = require("../src/services/dashboard/posAccountingRangeReportService");
const {
  resolveOrderGrossHalalas, makeBoundaries, summarizeOneTimeGroups,
} = require("../src/services/dashboard/oneTimeAccountingRangeReportService");

test("one-time accounting uses canonical positive halalas with legacy fallback", () => {
  assert.equal(resolveOrderGrossHalalas({ totalHalala: 700, totalPrice: 999 }), 700);
  assert.equal(resolveOrderGrossHalalas({ totalHalala: 0, totalPrice: 700 }), 700);
  assert.equal(resolveOrderGrossHalalas({ total: 700 }), 700);
  assert.equal(resolveOrderGrossHalalas({ totalHalala: -10 }), 0);
  assert.equal(resolveOrderGrossHalalas(null), 0);
});
test("historical business boundaries stay contiguous when cutoff changes", () => {
  const date = parsePosReportQuery({ from: "2026-11-14", to: "2026-11-16" });
  const policy = { baselineCutoff: "00:00",
    changes: [{ effectiveFrom: "2026-11-15", cutoff: "02:00", previousCutoff: "00:00" }] };
  const bounds = makeBoundaries(date.from, date.days, policy);
  assert.equal(bounds.length, 3);
  assert.equal(bounds[0].end.getTime(), bounds[1].start.getTime());
  assert.equal(bounds[1].end.getTime(), bounds[2].start.getTime());
  assert.equal(bounds[1].businessDate, "2026-11-15");
});
test("paid one-time orders never double count refunded-status orders", () => {
  const policy = { baselineCutoff: "00:00", changes: [] };
  const bounds = makeBoundaries("2026-11-15", 1, policy);
  const rows = [{
    _id: bounds[0].start,
    paidCount: 2, paidGrossHalalas: 1800,
    refundedStatusCount: 1, refundedStatusGrossHalalas: 900,
    unpricedPaidCount: 0,
  }];
  const report = summarizeOneTimeGroups(rows, bounds);
  assert.equal(report.summary.paidGrossHalalas, 1800);
  assert.equal(report.summary.refundedStatusGrossHalalas, 900);
  assert.equal(report.summary.paidCount, 2);
  assert.equal(report.summary.refundedStatusCount, 1);
  assert.deepEqual(summarizeOneTimeGroups([], bounds).daily, []);
});

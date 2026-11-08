"use strict";
process.env.NODE_ENV = "test";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Setting = require("../src/models/Setting");
const Payment = require("../src/models/Payment");
const PosInvoice = require("../src/models/PosInvoice");
const { expectedTotals } = require("../src/services/pos/expectedTotals");
const { subscriptionPaymentsForDate } = require("../src/services/dashboard/dailyCashClosingService");
const { businessDateAt } = require("../src/services/pos/businessDate");
const { resolveBusinessPeriod } = require("../src/services/dashboard/accountingDailyReportService");
const ActivityLog = require("../src/models/ActivityLog");
const {
  getBusinessDayBounds, getBusinessDateAt, scheduleBusinessDayCutoff,
} = require("../src/services/pos/businessDaySetting");

test("D-091 closing boundaries and subscription paidAt agree on isolated Mongo topology", async () => {
  const uri = process.env.MONGO_URI_TEST || "";
  if (!/^mongodb:\/\/127\.0\.0\.1:27017\/basicdiet_pos_g_d091_ci_test\?directConnection=true$/.test(uri)) {
    throw new Error("Refusing any nonlocal or non-disposable database");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    assert.equal(mongoose.connection.name, "basicdiet_pos_g_d091_ci_test");
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName || "standalone", process.env.EXPECT_MONGO_TOPOLOGY || "standalone");
    await mongoose.connection.dropDatabase();
    await Setting.create({ key: "businessDayCutoff", value: "04:00" });
    const one = new Date("2026-11-09T00:59:00.000Z"); // 03:59 Riyadh
    const two = new Date("2026-11-09T01:00:00.000Z"); // 04:00 Riyadh
    assert.equal(businessDateAt(one, "04:00"), "2026-11-08");
    assert.equal(businessDateAt(two, "04:00"), "2026-11-09");
    await PosInvoice.collection.insertMany([
      { idempotencyKey: "d091-sale-1", number: "STG-D091-1", channel: "restaurant", tender: { method: "cash" }, totals: { grossHalalas: 150, vatHalalas: 20 },
        businessDate: "2026-11-08", issuedAt: one },
      { idempotencyKey: "d091-sale-2", number: "STG-D091-2", channel: "restaurant", tender: { method: "network" }, totals: { grossHalalas: 250, vatHalalas: 33 },
        businessDate: "2026-11-09", issuedAt: two },
    ]);
    await Payment.collection.insertMany([
      { type: "subscription_activation", status: "paid", source: "dashboard_cashier",
        method: "cash", amount: 200, paidAt: one },
      { type: "subscription_activation", status: "paid", source: "dashboard_subscription_visa",
        method: "visa", amount: 300, paidAt: two },
    ]);
    const dayBefore = await expectedTotals("2026-11-08");
    const dayAfter = await expectedTotals("2026-11-09");
    assert.equal(dayBefore.pos.invoiceCount, 1);
    assert.equal(dayAfter.pos.invoiceCount, 1);
    assert.equal(dayBefore.expected.cashHalalas, 350);
    assert.equal(dayBefore.expected.networkHalalas, 0);
    assert.equal(dayAfter.expected.cashHalalas, 0);
    assert.equal(dayAfter.expected.networkHalalas, 550);
    const closeBefore = await subscriptionPaymentsForDate("2026-11-08");
    const closeAfter = await subscriptionPaymentsForDate("2026-11-09");
    assert.equal(closeBefore.amountHalala, 200);
    assert.equal(closeAfter.amountHalala, 300);
    assert.equal(PosInvoice.schema.path("businessDate").options.immutable, true,
      "recorded invoice businessDate must be immutable");
    const invoice = await PosInvoice.findOne({ businessDate: "2026-11-08" });
    assert.equal(invoice.businessDate, "2026-11-08");
    const historical = await resolveBusinessPeriod("2026-11-08");
    assert.deepEqual([historical.start, historical.end],
      [(await getBusinessDayBounds("2026-11-08")).start,
        (await getBusinessDayBounds("2026-11-08")).end]);
    // Only rs0 has transactional cutoff changes. A standalone cannot mutate
    // the protected setting; both topologies still use historical read bounds.
    const actorId = new mongoose.Types.ObjectId();
    const change = {
      newCutoff: "00:00", actorId, actorRole: "admin",
      at: new Date("2026-11-09T09:00:00.000Z"),
    };
    if (hello.setName === "rs0") {
      const result = await scheduleBusinessDayCutoff(change, { testOnly: true });
      assert.equal(result.previousCutoff, "04:00");
      assert.equal(result.newCutoff, "00:00");
      assert.equal(result.effectiveFrom, "2026-11-10");
      const audit = await ActivityLog.findOne({
        action: "business_day_cutoff_scheduled", byUserId: actorId,
      }).lean();
      assert.ok(audit);
      assert.equal(audit.meta.previousCutoff, "04:00");
      assert.equal(audit.meta.newCutoff, "00:00");
      assert.equal(audit.meta.effectiveFrom, "2026-11-10");
      assert.equal(audit.byRole, "admin");
      const oldPeriod = await getBusinessDayBounds("2026-11-09");
      const effectivePeriod = await getBusinessDayBounds("2026-11-10");
      const followingPeriod = await getBusinessDayBounds("2026-11-11");
      assert.equal(oldPeriod.end.toISOString(), "2026-11-10T01:00:00.000Z");
      assert.equal(effectivePeriod.start.toISOString(), oldPeriod.end.toISOString());
      assert.equal(effectivePeriod.end.toISOString(), "2026-11-10T21:00:00.000Z");
      assert.equal(followingPeriod.start.toISOString(), effectivePeriod.end.toISOString());
      assert.equal(await getBusinessDateAt(new Date("2026-11-10T00:59:00.000Z")), "2026-11-09");
      assert.equal(await getBusinessDateAt(new Date("2026-11-10T01:00:00.000Z")), "2026-11-10");
      assert.equal((await resolveBusinessPeriod("2026-11-10")).end.toISOString(),
        effectivePeriod.end.toISOString());
      assert.equal((await expectedTotals("2026-11-08")).expected.cashHalalas, 350,
        "cutoff update may not move historical paidAt or POS invoices");
      assert.equal((await PosInvoice.findById(invoice._id)).businessDate, "2026-11-08");
    } else {
      await assert.rejects(() => scheduleBusinessDayCutoff(change, { testOnly: true }),
        /Staging/);
    }

  } finally {
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  }
});

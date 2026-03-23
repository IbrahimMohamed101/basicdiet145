"use strict";

/**
 * P2-S7-S2 — Compensation & Validity Extension Logic
 *
 * Assertions:
 * 1.  validityEndDate = endDate + frozenCount
 * 2.  Freeze extends validity and creates "open" days.
 * 3.  Unfreeze reduces extension but NEVER deletes days within base contract window.
 * 4.  Shrink safety: Only removable trailing extension days are deleted.
 * 5.  Skip/Unskip are no-ops for validity.
 * 6.  Regression: Multiple freezes across base and extension correctly compute validity.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const { toKSADateString, addDaysToKSADateString } = require("../src/utils/date");

const SubscriptionDay = require("../src/models/SubscriptionDay");
const Subscription = require("../src/models/Subscription");
const { syncSubscriptionValidity } = require("../src/services/subscriptionService");

// ─── Helpers ────────────────────────────────────────────────────────────────

function objectId() {
  return new mongoose.Types.ObjectId();
}

function countStub(n) {
  return {
    session() { return this; },
    then(res, rej) { return Promise.resolve(n).then(res, rej); },
  };
}

function queryStub(result) {
  return {
    select() { return this; },
    session() { return this; },
    lean() { return Promise.resolve(result); },
    then(res, rej) { return Promise.resolve(result).then(res, rej); },
  };
}

function deleteManyStub(onDelete) {
  return {
    session(s) {
      this._session = s;
      return this;
    },
    then(res, rej) {
      return Promise.resolve(onDelete(this._session)).then(res, rej);
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("P2-S7-S2 — Compensation & Validity Extension Logic", async (t) => {

  // 1. Activation Baseline: validityEndDate matches endDate
  await t.test("(1) Baseline: validityEndDate matches endDate", () => {
    const start = new Date("2026-10-01T00:00:00+03:00");
    const end = addDays(start, 29); // 30 day plan
    const sub = new Subscription({
      userId: objectId(),
      planId: objectId(),
      status: "active",
      startDate: start,
      endDate: end,
      validityEndDate: end,
      totalMeals: 30,
      remainingMeals: 30,
      deliveryMode: "delivery",
    });

    assert.equal(toKSADateString(sub.validityEndDate), toKSADateString(sub.endDate));
  });

  // 2. Extension on Freeze
  await t.test("(2) Extension: Freezing 1 day moves validityEndDate forward by 1", async () => {
    const start = new Date("2026-10-01T00:00:00+03:00");
    const end = addDays(start, 2); // 3 days: 01, 02, 03
    const sub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: end,
    });

    const origCount = SubscriptionDay.countDocuments;
    const origFind = SubscriptionDay.find;
    const origInsert = SubscriptionDay.insertMany;
    let saved = false;
    sub.save = async () => { saved = true; };

    // 1 frozen day
    SubscriptionDay.countDocuments = () => countStub(1);
    // No extension days exist yet
    SubscriptionDay.find = () => queryStub([]);
    
    let insertedDays = [];
    SubscriptionDay.insertMany = async (days) => { insertedDays = days; };

    try {
      const result = await syncSubscriptionValidity(sub, null);
      
      const expectedEnd = addDays(end, 1);
      assert.equal(toKSADateString(result.validityEndDate), toKSADateString(expectedEnd));
      assert.equal(toKSADateString(sub.validityEndDate), toKSADateString(expectedEnd));
      assert.equal(insertedDays.length, 1, "Should insert 1 extension day");
      assert.equal(insertedDays[0].date, toKSADateString(expectedEnd));
      assert.ok(saved, "Subscription must be saved");
    } finally {
      SubscriptionDay.countDocuments = origCount;
      SubscriptionDay.find = origFind;
      SubscriptionDay.insertMany = origInsert;
    }
  });

  // 3. Shrink Safety: Base Window Protection
  await t.test("(3) Shrink Safety: Unfreezing never deletes days within base contract window", async () => {
    const start = new Date("2026-10-01T00:00:00+03:00");
    const end = addDays(start, 2); // 01, 02, 03
    const initialValidity = addDays(end, 5); // Extended to 08
    
    const sub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: initialValidity,
    });

    const origCount = SubscriptionDay.countDocuments;
    const origFind = SubscriptionDay.find;
    const origDelete = SubscriptionDay.deleteMany;
    sub.save = async () => {};

    // Now 0 frozen days (all unfrozen)
    SubscriptionDay.countDocuments = () => countStub(0);
    
    // Days existing: 01, 02, 03 (base), 04, 05, 06, 07, 08 (extension)
    const baseEndStr = toKSADateString(end); // 2026-10-03
    const allDays = [
      { date: "2026-10-01", status: "open" },
      { date: "2026-10-02", status: "open" },
      { date: "2026-10-03", status: "open" },
      { date: "2026-10-04", status: "open" },
      { date: "2026-10-05", status: "open" },
      { date: "2026-10-06", status: "open" },
      { date: "2026-10-07", status: "open" },
      { date: "2026-10-08", status: "open" },
    ];
    
    // Find called for days > newValidityEndDate (2026-10-03)
    SubscriptionDay.find = () => queryStub(allDays.filter(d => d.date > baseEndStr));
    
    let deletedIds = [];
    SubscriptionDay.deleteMany = (query) => deleteManyStub((_session) => {
      deletedIds = query._id.$in;
    });

    try {
      await syncSubscriptionValidity(sub, null);
      
      // validityEndDate should move back to baseEndDate
      assert.equal(toKSADateString(sub.validityEndDate), baseEndStr);
      
      // Should delete exactly 5 extension days: 04, 05, 06, 07, 08
      assert.equal(deletedIds.length, 5);
    } finally {
      SubscriptionDay.countDocuments = origCount;
      SubscriptionDay.find = origFind;
      SubscriptionDay.deleteMany = origDelete;
    }
  });

  // 4. Shrink Safety: Conflict protection
  await t.test("(4) Conflict: Cannot shrink if trailing day has selections", async () => {
    const start = new Date("2026-10-01T00:00:00+03:00");
    const end = addDays(start, 2); // 01, 02, 03
    const initialValidity = addDays(end, 1); // 04
    
    const sub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: initialValidity,
    });

    SubscriptionDay.countDocuments = () => countStub(0); // Unfreeze
    
    // Extension day 04 has selections
    const day04 = { 
      date: "2026-10-04", 
      status: "open", 
      selections: [objectId()] // CONFLICT
    };
    SubscriptionDay.find = () => queryStub([day04]);

    try {
      await syncSubscriptionValidity(sub, null);
      assert.fail("Should have thrown conflict error");
    } catch (err) {
      assert.equal(err.code, "VALIDITY_SHRINK_CONFLICT");
      assert.ok(err.message.includes("2026-10-04"));
    }
  });

  // 5. Formula Regression: Multiple mixed freezes
  await t.test("(5) Regression: validityEndDate = endDate + totalFrozenCount (mixed range)", async () => {
    const start = new Date("2026-10-01T00:00:00+03:00");
    const end = addDays(start, 9); // 10 days: 01 to 10
    const sub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: end,
    });

    // 4 days frozen: 2 in base, 2 in previous extension tail
    SubscriptionDay.countDocuments = () => countStub(4);
    SubscriptionDay.find = () => queryStub([]); // No days exist yet beyond current
    SubscriptionDay.insertMany = async () => {};
    sub.save = async () => {};

    const result = await syncSubscriptionValidity(sub, null);
    
    const expectedEnd = addDays(end, 4); // 10 + 4 = 14
    assert.equal(toKSADateString(result.validityEndDate), "2026-10-14");
    assert.equal(result.frozenCount, 4);
  });

  // 6. State Transition: Frozen -> Locked reduces extension
  await t.test("(6) Transition: Frozen day becoming Locked reduces frozenCount and extension", async () => {
    const start = new Date("2026-11-01T00:00:00+03:00");
    const end = addDays(start, 0); // 1 day: 01
    const sub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: addDays(end, 1), // Extended to 02 because 01 was frozen
    });

    // Now 01 is locked (cutoff passed), so frozenCount = 0
    SubscriptionDay.countDocuments = () => countStub(0);
    // Day 02 is open extension day
    const day02 = { date: "2026-11-02", status: "open" };
    SubscriptionDay.find = () => queryStub([day02]);
    SubscriptionDay.deleteMany = () => deleteManyStub(() => {});
    sub.save = async () => {};

    const result = await syncSubscriptionValidity(sub, null);
    
    assert.equal(toKSADateString(result.validityEndDate), "2026-11-01");
    assert.equal(result.frozenCount, 0);
  });

  // 7. Regression: Skip/Unskip is a validity no-op
  await t.test("(7) Regression: Skip/Unskip does NOT affect validityEndDate", async () => {
    const start = new Date("2026-12-01T00:00:00+03:00");
    const end = addDays(start, 4); // 5 days: 01 to 05
    const sub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: end,
    });

    // 0 frozen days, but 1 skipped day (status: "skipped")
    SubscriptionDay.countDocuments = (filter) => {
      // syncSubscriptionValidity should only count status: "frozen"
      if (filter.status === "frozen") return countStub(0);
      return countStub(1);
    };
    
    // No extension days exist
    SubscriptionDay.find = () => queryStub([]);
    SubscriptionDay.insertMany = async () => {};
    sub.save = async () => {};

    const result = await syncSubscriptionValidity(sub, null);
    
    // validityEndDate must remain identical to endDate
    assert.equal(toKSADateString(result.validityEndDate), toKSADateString(sub.endDate));
    assert.equal(result.frozenCount, 0);
  });
});

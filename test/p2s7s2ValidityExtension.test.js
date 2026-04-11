"use strict";

/**
 * P2-S7-S2 — Compensation & Validity Extension Logic
 *
 * Assertions:
 * 1.  validityEndDate = endDate + total compensated day count
 * 2.  Freeze extends validity and creates "open" days.
 * 3.  Unfreeze reduces extension but NEVER deletes days within base contract window.
 * 4.  Shrink safety: Only removable trailing extension days are deleted.
 * 5.  Multiple compensated days across base and extension correctly compute validity.
 * 6.  Frozen -> locked transition removes extension when no compensation remains.
 * 7.  Legacy skips remain no-op, compensated skips extend validity.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const { toKSADateString, addDaysToKSADateString } = require("../src/utils/date");

const SubscriptionDay = require("../src/models/SubscriptionDay");
const Subscription = require("../src/models/Subscription");
const { syncSubscriptionValidity } = require("../src/services/subscription/subscriptionService");

// ─── Helpers ────────────────────────────────────────────────────────────────

function objectId() {
  return new mongoose.Types.ObjectId();
}

function queryStub(result) {
  return {
    select() { return this; },
    session() { return this; },
    lean() { return Promise.resolve(result); },
    then(res, rej) { return Promise.resolve(result).then(res, rej); },
  };
}

function buildFindStub({ sourceDays = [], trailingDays = [] } = {}) {
  return (query) => {
    if (query && query.$or) {
      return queryStub(sourceDays);
    }
    if (query && query.date && query.date.$gt !== undefined) {
      return queryStub(trailingDays);
    }
    return queryStub([]);
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

    SubscriptionDay.countDocuments = origCount;
    SubscriptionDay.find = buildFindStub({
      sourceDays: [{ date: "2026-10-02", status: "frozen", canonicalDayActionType: "freeze" }],
      trailingDays: [],
    });
    
    let insertedDays = [];
    SubscriptionDay.insertMany = async (days) => { insertedDays = days; };

    try {
      const result = await syncSubscriptionValidity(sub, null);
      
      const expectedEnd = addDays(end, 1);
      assert.equal(toKSADateString(result.validityEndDate), toKSADateString(expectedEnd));
      assert.equal(toKSADateString(sub.validityEndDate), toKSADateString(expectedEnd));
      assert.equal(result.frozenCount, 1);
      assert.equal(result.compensatedSkipCount, 0);
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

    // Days existing: 01, 02, 03 (base), 04, 05, 06, 07, 08 (extension)
    const baseEndStr = toKSADateString(end); // 2026-10-03
    const allDays = [
      { _id: objectId(), date: "2026-10-01", status: "open" },
      { _id: objectId(), date: "2026-10-02", status: "open" },
      { _id: objectId(), date: "2026-10-03", status: "open" },
      { _id: objectId(), date: "2026-10-04", status: "open" },
      { _id: objectId(), date: "2026-10-05", status: "open" },
      { _id: objectId(), date: "2026-10-06", status: "open" },
      { _id: objectId(), date: "2026-10-07", status: "open" },
      { _id: objectId(), date: "2026-10-08", status: "open" },
    ];

    SubscriptionDay.countDocuments = origCount;
    SubscriptionDay.find = buildFindStub({
      sourceDays: [],
      trailingDays: allDays.filter((day) => day.date > baseEndStr),
    });
    
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
    const origFind = SubscriptionDay.find;

    // Extension day 04 has selections
    const day04 = { 
      date: "2026-10-04", 
      status: "open", 
      selections: [objectId()] // CONFLICT
    };
    SubscriptionDay.find = buildFindStub({
      sourceDays: [],
      trailingDays: [day04],
    });

    try {
      await syncSubscriptionValidity(sub, null);
      assert.fail("Should have thrown conflict error");
    } catch (err) {
      assert.equal(err.code, "VALIDITY_SHRINK_CONFLICT");
      assert.ok(err.message.includes("2026-10-04"));
    } finally {
      SubscriptionDay.find = origFind;
    }
  });

  // 5. Formula Regression: Mixed compensated days
  await t.test("(5) Regression: validityEndDate = endDate + total compensated days (freeze + skip)", async () => {
    const start = new Date("2026-10-01T00:00:00+03:00");
    const end = addDays(start, 9); // 10 days: 01 to 10
    const sub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: end,
    });
    const origFind = SubscriptionDay.find;
    const origInsert = SubscriptionDay.insertMany;

    SubscriptionDay.find = buildFindStub({
      sourceDays: [
        { date: "2026-10-02", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-10-04", status: "frozen", canonicalDayActionType: "freeze" },
        { date: "2026-10-11", status: "skipped", canonicalDayActionType: "skip", skipCompensated: true },
        { date: "2026-10-12", status: "skipped", canonicalDayActionType: "skip", skipCompensated: true },
      ],
      trailingDays: [],
    });
    SubscriptionDay.insertMany = async () => {};
    sub.save = async () => {};

    try {
      const result = await syncSubscriptionValidity(sub, null);
      
      const expectedEnd = addDays(end, 4); // 10 + 4 = 14
      assert.equal(toKSADateString(result.validityEndDate), "2026-10-14");
      assert.equal(result.frozenCount, 2);
      assert.equal(result.compensatedSkipCount, 2);
      assert.equal(result.totalCompensationCount, 4);
    } finally {
      SubscriptionDay.find = origFind;
      SubscriptionDay.insertMany = origInsert;
    }
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
    const origFind = SubscriptionDay.find;
    const origDelete = SubscriptionDay.deleteMany;

    const day02 = { _id: objectId(), date: "2026-11-02", status: "open" };
    SubscriptionDay.find = buildFindStub({
      sourceDays: [],
      trailingDays: [day02],
    });
    SubscriptionDay.deleteMany = () => deleteManyStub(() => {});
    sub.save = async () => {};

    try {
      const result = await syncSubscriptionValidity(sub, null);
      
      assert.equal(toKSADateString(result.validityEndDate), "2026-11-01");
      assert.equal(result.frozenCount, 0);
    } finally {
      SubscriptionDay.find = origFind;
      SubscriptionDay.deleteMany = origDelete;
    }
  });

  // 7. Regression: Legacy skip vs compensated skip
  await t.test("(7) Regression: legacy skip is a no-op, compensated skip extends validity", async () => {
    const start = new Date("2026-12-01T00:00:00+03:00");
    const end = addDays(start, 4); // 5 days: 01 to 05
    const legacySub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: end,
    });
    const compensatedSub = new Subscription({
      _id: objectId(),
      endDate: end,
      validityEndDate: end,
    });
    const origFind = SubscriptionDay.find;
    const origInsert = SubscriptionDay.insertMany;

    SubscriptionDay.insertMany = async () => {};
    legacySub.save = async () => {};
    compensatedSub.save = async () => {};

    try {
      SubscriptionDay.find = buildFindStub({
        sourceDays: [
          { date: "2026-12-03", status: "skipped", canonicalDayActionType: "skip" },
        ],
        trailingDays: [],
      });
      const legacyResult = await syncSubscriptionValidity(legacySub, null);
      assert.equal(toKSADateString(legacyResult.validityEndDate), toKSADateString(legacySub.endDate));
      assert.equal(legacyResult.compensatedSkipCount, 0);

      SubscriptionDay.find = buildFindStub({
        sourceDays: [
          { date: "2026-12-03", status: "skipped", canonicalDayActionType: "skip", skipCompensated: true },
        ],
        trailingDays: [],
      });
      const compensatedResult = await syncSubscriptionValidity(compensatedSub, null);
      assert.equal(toKSADateString(compensatedResult.validityEndDate), "2026-12-06");
      assert.equal(compensatedResult.compensatedSkipCount, 1);
    } finally {
      SubscriptionDay.find = origFind;
      SubscriptionDay.insertMany = origInsert;
    }
  });
});

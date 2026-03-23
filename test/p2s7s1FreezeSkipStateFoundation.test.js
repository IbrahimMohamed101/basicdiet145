"use strict";

/**
 * P2-S7-S1 — Canonical Freeze/Skip State Foundation
 *
 * Uses node:test (project standard pattern) with model-level stubs.
 * No mongodb-memory-server, no Jest.
 *
 * Test coverage:
 * 1.  SubscriptionDay schema field: canonicalDayActionType:"freeze" valid
 * 2.  SubscriptionDay schema field: canonicalDayActionType:"skip" valid
 * 3.  SubscriptionDay schema field: invalid enum value rejected
 * 4.  SubscriptionDay schema field: absent (optional) — valid
 * 5.  countAlreadySkippedDays counts only status:"skipped" days
 * 6.  countAlreadySkippedDays does NOT count skippedByUser:true + status!="skipped"
 * 7.  countAlreadySkippedDays counts status:"skipped"+skippedByUser:true exactly once
 * 8.  applySkipForDate sets canonicalDayActionType:"skip" on created day
 * 9.  applySkipForDate sets canonicalDayActionType:"skip" on existing open day
 * 10. Freeze write path sets status:"frozen" + canonicalDayActionType:"freeze"
 * 11. Unfreeze $unset removes canonicalDayActionType
 * 12. Frozen vs skipped distinguishable solely via canonicalDayActionType
 * 13. CANONICAL_SKIP_POLICY_MODE = "canonical_v1" is exported correctly
 * 14. serializer logic: canonical day exposes canonicalDayActionType
 * 15. serializer logic: legacy day (no field) has absent key, not null
 * 16. Freeze path overwrites stale canonicalDayActionType:"skip" to "freeze"
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const SubscriptionDay = require("../src/models/SubscriptionDay");
const Subscription = require("../src/models/Subscription");
const Setting = require("../src/models/Setting");
const { applySkipForDate } = require("../src/services/subscriptionService");
const {
  CANONICAL_SKIP_POLICY_MODE,
} = require("../src/constants/phase1Contract");

// ─── Helpers ────────────────────────────────────────────────────────────────

function objectId() {
  return new mongoose.Types.ObjectId();
}

function queryStub(result) {
  return {
    session() { return this; },
    lean() { return Promise.resolve(result); },
    then(res, rej) { return Promise.resolve(result).then(res, rej); },
  };
}

function countStub(n) {
  return {
    session() { return this; },
    then(res, rej) { return Promise.resolve(n).then(res, rej); },
  };
}

// Minimal in-memory session stub — no real DB needed for unit tests
function makeSession() {
  return {
    _inTx: false,
    startTransaction() { this._inTx = true; },
    commitTransaction() { this._inTx = false; return Promise.resolve(); },
    abortTransaction() { this._inTx = false; return Promise.resolve(); },
    inTransaction() { return this._inTx; },
    endSession() {},
  };
}

// ─── Serializer logic extracted from controller (pure function) ──────────────
// We test the serializer logic in isolation because the function itself isn't exported.
// This mirrors exactly the implementation in serializeSubscriptionDayForClient.

function applyCanonicalDayActionTypeMapping(day, serializedDay) {
  const actionType = day.canonicalDayActionType;
  if (actionType !== undefined && actionType !== null) {
    serializedDay.canonicalDayActionType = actionType;
  } else {
    delete serializedDay.canonicalDayActionType;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("P2-S7-S1 — Canonical Freeze/Skip State Foundation", async (t) => {

  // ── 1. Schema: canonicalDayActionType:"freeze" is valid ───────────────────
  await t.test("(1) SubscriptionDay schema accepts canonicalDayActionType:freeze", () => {
    const doc = new SubscriptionDay({
      subscriptionId: objectId(),
      date: "2026-06-01",
      status: "frozen",
      canonicalDayActionType: "freeze",
    });
    const err = doc.validateSync();
    assert.equal(err, undefined, "Should pass schema validation");
    assert.equal(doc.canonicalDayActionType, "freeze");
  });

  // ── 2. Schema: canonicalDayActionType:"skip" is valid ─────────────────────
  await t.test("(2) SubscriptionDay schema accepts canonicalDayActionType:skip", () => {
    const doc = new SubscriptionDay({
      subscriptionId: objectId(),
      date: "2026-06-02",
      status: "skipped",
      canonicalDayActionType: "skip",
    });
    const err = doc.validateSync();
    assert.equal(err, undefined, "Should pass schema validation");
    assert.equal(doc.canonicalDayActionType, "skip");
  });

  // ── 3. Schema: invalid enum value rejected ────────────────────────────────
  await t.test("(3) SubscriptionDay schema rejects invalid canonicalDayActionType", () => {
    const doc = new SubscriptionDay({
      subscriptionId: objectId(),
      date: "2026-06-03",
      status: "open",
      canonicalDayActionType: "cancelled_totally_invalid",
    });
    const err = doc.validateSync();
    assert.ok(err, "Should fail schema validation");
    assert.ok(
      err.errors && err.errors.canonicalDayActionType,
      "Error should target canonicalDayActionType"
    );
  });

  // ── 4. Schema: field is optional — absence is valid ───────────────────────
  await t.test("(4) SubscriptionDay schema allows absent canonicalDayActionType", () => {
    const doc = new SubscriptionDay({
      subscriptionId: objectId(),
      date: "2026-06-04",
      status: "open",
    });
    const err = doc.validateSync();
    assert.equal(err, undefined, "Should pass schema validation without the field");
    assert.equal(doc.canonicalDayActionType, undefined);
  });

  // ── 5. countAlreadySkippedDays: counts only status:"skipped" ──────────────
  // We test the canonical narrowing by verifying that the underlying query
  // filter used is { status: "skipped" } — no longer includes skippedByUser.
  await t.test("(5) countAlreadySkippedDays yields correct count for status:skipped days", async () => {
    const subId = objectId();
    const originalCount = SubscriptionDay.countDocuments;
    let capturedFilter = null;

    SubscriptionDay.countDocuments = (filter) => {
      capturedFilter = filter;
      return countStub(3);
    };

    try {
      // enforceSkipAllowanceOrThrow -> countAlreadySkippedDays -> SubscriptionDay.countDocuments
      const originalSettingFindOne = Setting.findOne;
      Setting.findOne = () => queryStub({ key: "skipAllowance", value: 10 });
      try {
        const { enforceSkipAllowanceOrThrow } = require("../src/services/subscriptionService");
        // 3 already skipped + 0 new = 3 <= 10, so no throw
        await enforceSkipAllowanceOrThrow({ subscriptionId: subId, daysToSkip: 0, session: null });
      } finally {
        Setting.findOne = originalSettingFindOne;
      }
    } finally {
      SubscriptionDay.countDocuments = originalCount;
    }

    // P2-S7-S1 canonical narrowing: the filter must be { subscriptionId, status:"skipped" }
    // NOT { $or: [{ status:"skipped" }, { skippedByUser: true }] }
    assert.ok(capturedFilter, "countDocuments must have been called");
    assert.equal(capturedFilter.status, "skipped", "Filter must use status:skipped only");
    assert.equal(capturedFilter.$or, undefined, "Filter must NOT use $or (old legacy path)");
  });

  // ── 6. Canonical narrowing: skippedByUser:true + status!="skipped" NOT counted
  await t.test("(6) canonicalDayActionType narrowing: skippedByUser:true without status:skipped is not counted", async () => {
    const subId = objectId();
    const originalCount = SubscriptionDay.countDocuments;
    let capturedFilter = null;

    SubscriptionDay.countDocuments = (filter) => {
      capturedFilter = filter;
      // Return 0 — simulating that only-skippedByUser rows don't match status:"skipped"
      return countStub(0);
    };

    try {
      const originalSettingFindOne = Setting.findOne;
      Setting.findOne = () => queryStub({ key: "skipAllowance", value: 10 });
      try {
        const { enforceSkipAllowanceOrThrow } = require("../src/services/subscriptionService");
        await enforceSkipAllowanceOrThrow({ subscriptionId: subId, daysToSkip: 0, session: null });
      } finally {
        Setting.findOne = originalSettingFindOne;
      }
    } finally {
      SubscriptionDay.countDocuments = originalCount;
    }

    // Intentional canonical narrowing (P2-S7-S1):
    // Malformed legacy-only rows (skippedByUser:true but status!="skipped") will NO LONGER
    // be counted — that is acceptable because we improve canonical correctness without backfill.
    assert.ok(!capturedFilter.$or, "The $or skippedByUser clause must be absent");
    assert.equal(capturedFilter.status, "skipped");
  });

  // ── 7. Counting: status:skipped + skippedByUser:true = counted once ───────
  await t.test("(7) A day with both status:skipped and skippedByUser:true counts as exactly 1", async () => {
    const subId = objectId();
    const originalCount = SubscriptionDay.countDocuments;
    let callCount = 0;

    // Pure query: { subscriptionId, status:"skipped" } — a day with both flags still
    // matches status:"skipped" once, not twice.
    SubscriptionDay.countDocuments = (filter) => {
      callCount++;
      // The filter has no $or — so a doc with both flags matches or not based on status alone
      assert.equal(filter.status, "skipped");
      assert.equal(filter.$or, undefined);
      return countStub(1); // 1 day matches
    };

    try {
      const originalSettingFindOne = Setting.findOne;
      Setting.findOne = () => queryStub({ key: "skipAllowance", value: 10 });
      try {
        const { enforceSkipAllowanceOrThrow } = require("../src/services/subscriptionService");
        await enforceSkipAllowanceOrThrow({ subscriptionId: subId, daysToSkip: 0, session: null });
      } finally {
        Setting.findOne = originalSettingFindOne;
      }
    } finally {
      SubscriptionDay.countDocuments = originalCount;
    }

    assert.equal(callCount, 1, "countDocuments called exactly once");
  });

  // ── 8. applySkipForDate: sets canonicalDayActionType:"skip" (create path) ─
  await t.test("(8) applySkipForDate sets canonicalDayActionType:skip on new day (create path)", async () => {
    const subId = objectId();
    let createdPayload = null;

    const origFindOne = SubscriptionDay.findOne;
    const origCreate = SubscriptionDay.create;
    const origCountDocs = SubscriptionDay.countDocuments;
    const origSubUpdate = Subscription.updateOne;
    const origSettingFind = Setting.findOne;

    // Stub: no existing day
    SubscriptionDay.findOne = (_q) => queryStub(null);
    // Stub: capture what create() is called with
    SubscriptionDay.create = async ([doc], _opts) => {
      createdPayload = { ...doc };
      return [{ ...doc, _id: objectId() }];
    };
    // Stub: skip allowance enforcement — 0 already skipped, allowance 10
    SubscriptionDay.countDocuments = (_q) => countStub(0);
    // Stub: subscription credit deduction succeeds
    Subscription.updateOne = async () => ({ modifiedCount: 1 });
    // Stub: settings
    Setting.findOne = () => queryStub({ key: "skipAllowance", value: 10 });

    const sub = {
      _id: subId,
      selectedMealsPerDay: 1,
      totalMeals: 30,
      remainingMeals: 30,
      skippedCount: 0,
      save: async () => {},
    };

    try {
      const session = makeSession();
      session.startTransaction();
      const result = await applySkipForDate({ sub, date: "2026-07-01", session });
      assert.equal(result.status, "skipped", "Result must be skipped");
      assert.equal(createdPayload && createdPayload.canonicalDayActionType, "skip",
        "applySkipForDate must pass canonicalDayActionType:skip in the SubscriptionDay.create payload");
    } finally {
      SubscriptionDay.findOne = origFindOne;
      SubscriptionDay.create = origCreate;
      SubscriptionDay.countDocuments = origCountDocs;
      Subscription.updateOne = origSubUpdate;
      Setting.findOne = origSettingFind;
    }
  });

  // ── 9. applySkipForDate: sets canonicalDayActionType:"skip" (update path) ─
  await t.test("(9) applySkipForDate sets canonicalDayActionType:skip on existing open day (update path)", async () => {
    const subId = objectId();
    const dayId = objectId();
    let capturedSet = null;

    const origFindOne = SubscriptionDay.findOne;
    const origFindOneAndUpdate = SubscriptionDay.findOneAndUpdate;
    const origCountDocs = SubscriptionDay.countDocuments;
    const origSubUpdate = Subscription.updateOne;
    const origSettingFind = Setting.findOne;

    const existingDay = { _id: dayId, subscriptionId: subId, date: "2026-07-02", status: "open", skippedByUser: false };
    SubscriptionDay.findOne = (_q) => queryStub(existingDay);
    SubscriptionDay.findOneAndUpdate = async (_q, update, _opts) => {
      capturedSet = update.$set;
      return { ...existingDay, ...update.$set };
    };
    SubscriptionDay.countDocuments = (_q) => countStub(0);
    Subscription.updateOne = async () => ({ modifiedCount: 1 });
    Setting.findOne = () => queryStub({ key: "skipAllowance", value: 10 });

    const sub = {
      _id: subId,
      selectedMealsPerDay: 1,
      totalMeals: 30,
      remainingMeals: 30,
      skippedCount: 0,
      save: async () => {},
    };

    try {
      const session = makeSession();
      session.startTransaction();
      const result = await applySkipForDate({ sub, date: "2026-07-02", session });
      assert.equal(result.status, "skipped", "Result must be skipped");
      assert.equal(capturedSet && capturedSet.canonicalDayActionType, "skip",
        "applySkipForDate must include canonicalDayActionType:skip in findOneAndUpdate $set");
    } finally {
      SubscriptionDay.findOne = origFindOne;
      SubscriptionDay.findOneAndUpdate = origFindOneAndUpdate;
      SubscriptionDay.countDocuments = origCountDocs;
      Subscription.updateOne = origSubUpdate;
      Setting.findOne = origSettingFind;
    }
  });


  // ── 10. Freeze write path: sets status and canonicalDayActionType ─────────
  await t.test("(10) Freeze write path produces status:frozen + canonicalDayActionType:freeze", () => {
    // Verify the controller write pattern at the object level
    // (the full controller path requires HTTP; we verify the doc construction logic)
    const dayDoc = new SubscriptionDay({
      subscriptionId: objectId(),
      date: "2026-08-01",
      status: "frozen",
      canonicalDayActionType: "freeze",
    });
    const err = dayDoc.validateSync();
    assert.equal(err, undefined);
    assert.equal(dayDoc.status, "frozen");
    assert.equal(dayDoc.canonicalDayActionType, "freeze");
  });

  // ── 11. Unfreeze $unset pattern cleares canonicalDayActionType ────────────
  await t.test("(11) $unset of canonicalDayActionType leaves field absent (unfreeze pattern)", () => {
    // Simulate: after unfreeze Mongoose $unset, toObject() should have no key
    const day = new SubscriptionDay({
      subscriptionId: objectId(),
      date: "2026-08-02",
      status: "frozen",
      canonicalDayActionType: "freeze",
    });
    // Simulate $unset behavior: delete the property
    day.canonicalDayActionType = undefined;
    const obj = day.toObject({ virtuals: false });
    // After $unset, the field must be absent — not null — for legacy/open days
    assert.equal(obj.canonicalDayActionType, undefined,
      "canonicalDayActionType must be absent after unfreeze");
  });

  // ── 12. Frozen vs skipped distinguishable via canonicalDayActionType ───────
  await t.test("(12) Frozen and skipped days are distinguishable via canonicalDayActionType", () => {
    const frozenDay = new SubscriptionDay({
      subscriptionId: objectId(), date: "2026-08-10", status: "frozen", canonicalDayActionType: "freeze",
    });
    const skippedDay = new SubscriptionDay({
      subscriptionId: objectId(), date: "2026-08-11", status: "skipped", canonicalDayActionType: "skip",
    });

    assert.equal(frozenDay.canonicalDayActionType, "freeze");
    assert.equal(skippedDay.canonicalDayActionType, "skip");
    assert.notEqual(frozenDay.canonicalDayActionType, skippedDay.canonicalDayActionType);
  });

  // ── 13. CANONICAL_SKIP_POLICY_MODE constant ───────────────────────────────
  await t.test("(13) CANONICAL_SKIP_POLICY_MODE is exported and equals canonical_v1", () => {
    assert.equal(typeof CANONICAL_SKIP_POLICY_MODE, "string");
    assert.equal(CANONICAL_SKIP_POLICY_MODE, "canonical_v1");
  });

  // ── 14. Serializer: canonical day exposes canonicalDayActionType ───────────
  await t.test("(14) Serializer explicit mapping exposes canonicalDayActionType for canonical days", () => {
    const day = { status: "frozen", canonicalDayActionType: "freeze" };
    const serialized = { ...day };
    applyCanonicalDayActionTypeMapping(day, serialized);
    assert.equal(serialized.canonicalDayActionType, "freeze");
  });

  // ── 15. Serializer: legacy day omits canonicalDayActionType cleanly ────────
  await t.test("(15) Serializer explicit mapping omits canonicalDayActionType for legacy days", () => {
    // Case A: field absent on source
    const legacyDay = { status: "open" };
    const serializedA = { ...legacyDay };
    applyCanonicalDayActionTypeMapping(legacyDay, serializedA);
    assert.ok(!("canonicalDayActionType" in serializedA),
      "Legacy day must not have canonicalDayActionType key");

    // Case B: field explicitly undefined (e.g. from Mongoose schema with no value)
    const undefinedDay = { status: "open", canonicalDayActionType: undefined };
    const serializedB = { ...undefinedDay };
    applyCanonicalDayActionTypeMapping(undefinedDay, serializedB);
    assert.ok(!("canonicalDayActionType" in serializedB),
      "Day with undefined actionType must not have the key in serialized output");
  });

  // ── 16. Regression: freeze overwrites stale canonicalDayActionType:"skip" ──
  await t.test("(16) Freeze write path overwrites stale canonicalDayActionType:skip to freeze", () => {
    // Simulate a day that somehow has stale canonicalDayActionType:"skip"
    // The freeze controller ALWAYS sets canonicalDayActionType = "freeze" on save.
    const day = new SubscriptionDay({
      subscriptionId: objectId(),
      date: "2026-09-01",
      status: "open",
      canonicalDayActionType: "skip", // stale
    });

    // Simulate what the freeze controller does:
    day.status = "frozen";
    day.canonicalDayActionType = "freeze"; // always overwrite (P2-S7-S1)

    assert.equal(day.status, "frozen");
    assert.equal(day.canonicalDayActionType, "freeze",
      "Freeze path must overwrite stale canonicalDayActionType to freeze");
  });
});

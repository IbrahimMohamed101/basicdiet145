"use strict";

/**
 * P2-S7-S3 — Freeze/Skip Compensation Completion
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { addDays } = require("date-fns");
const dateUtils = require("../src/utils/date");
const { toKSADateString } = dateUtils;

const { 
  ensureActive
} = require("../src/controllers/subscriptionController");

// ─── Helpers ────────────────────────────────────────────────────────────────

function objectId() {
  return new mongoose.Types.ObjectId();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("P2-S7-S3 — Freeze/Skip Compensation Completion", async (t) => {

  const originalGetToday = dateUtils.getTodayKSADate;
  
  // (1) Active Window Accuracy: ensureActive correctly uses validityEndDate
  await t.test("(1) Active Window: Sub beyond endDate but within validityEndDate remains active", () => {
    const today = "2026-10-15";
    dateUtils.getTodayKSADate = () => today;

    const sub = {
      status: "active",
      endDate: new Date("2026-10-10T00:00:00+03:00"), // 10th
      validityEndDate: new Date("2026-10-20T00:00:00+03:00"), // 20th
    };

    // Should NOT throw for today
    try {
      ensureActive(sub);
    } catch (err) {
      assert.fail(`Should not have thrown for date within validity window: ${err.message}`);
    }

    // Now test true expiration
    sub.validityEndDate = new Date("2026-10-14T00:00:00+03:00"); // 14th (today is 15th)
    try {
      ensureActive(sub);
      assert.fail("Should have thrown SUB_EXPIRED");
    } catch (err) {
      assert.equal(err.code, "SUB_EXPIRED");
    }
  });

  // (2) Operational Extension: Actions allowed on extension days
  await t.test("(2) Operational Extension: Actions allowed on extension days", async () => {
    const today = "2026-10-15";
    dateUtils.getTodayKSADate = () => today;

    const sub = {
      status: "active",
      endDate: new Date("2026-10-10T00:00:00+03:00"),
      validityEndDate: new Date("2026-10-20T00:00:00+03:00"),
    };

    // ensureActive for an extension day (e.g. Oct 18)
    try {
      ensureActive(sub, "2026-10-18");
    } catch (err) {
      assert.fail(`Operational action on extension day should be allowed: ${err.message}`);
    }

    // ensureActive for day BEYOND extension day
    try {
      ensureActive(sub, "2026-10-21");
      assert.fail("Should block action beyond validity window");
    } catch (err) {
      assert.equal(err.code, "SUB_EXPIRED");
    }
  });

  // (3) Dynamic Serialization Logic Regression (Unit Test)
  await t.test("(3) Dynamic Serialization: Manual logic check (parity)", () => {
    const today = "2026-10-15";
    dateUtils.getTodayKSADate = () => today;

    const serializeLogic = (sub) => {
      const data = { ...sub };
      if (data.status === "active") {
        const endDate = data.validityEndDate || data.endDate;
        if (endDate && dateUtils.getTodayKSADate() > dateUtils.toKSADateString(endDate)) {
          data.status = "expired";
        }
      }
      return data.status;
    };

    const subActive = { 
      status: "active", 
      validityEndDate: new Date("2026-10-20T00:00:00+03:00") 
    };
    assert.equal(serializeLogic(subActive), "active", "Should stay active within window");

    const subExpired = { 
      status: "active", 
      validityEndDate: new Date("2026-10-10T00:00:00+03:00") 
    };
    assert.equal(serializeLogic(subExpired), "expired", "Should reflect expired beyond validityEndDate");
  });

  // Final cleanup
  dateUtils.getTodayKSADate = originalGetToday;
});

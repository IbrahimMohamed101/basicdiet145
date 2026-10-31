"use strict";
const assert = require("node:assert/strict");
const {
  buildCanonical, classifyEntitlements, buildLiveRows, addDays, dateKey,
} = require("../src/services/dashboard/customerRetentionReadService");

const nowKey = "2026-10-31";
const expiry = (day, remaining = 1, props = {}) => ({
  _id: props._id || "b1",
  containerSubscriptionId: "s1",
  sourceType: props.sourceType || "dashboard",
  applicationState: "applied",
  status: "active",
  validityEndDate: day + "T20:59:59.000Z",
  effectiveStartDate: "2026-10-01T00:00:00Z",
  remainingMeals: remaining,
  reservedMeals: 0,
  ...props,
});
const subscription = (props = {}) => ({
  _id: "s1", status: "active", createdAt: "2026-09-01T10:00:00Z",
  userId: "u1", remainingMeals: 10, reservedMeals: 0,
  validityEndDate: "2026-10-25T20:59:59Z", startDate: "2026-09-01T00:00:00Z",
  ...props,
});
const current = (s, b) => classifyEntitlements({
  subscriptions: [s], batches: b, nowKey,
});
assert.equal(addDays("2026-10-31", 1), "2026-11-01");
assert.equal(dateKey("2026-10-31T22:30:00Z"), "2026-11-01", "KSA calendar day must be used");
assert.equal(current(subscription(), [expiry("2026-11-20")]).status, "active");
assert.equal(current(subscription(), [expiry("2026-11-02")]).status, "due_soon");
assert.equal(current(subscription(), [expiry("2026-10-25", 0)]).status, "grace_14");
assert.equal(current(subscription(), [expiry("2026-10-10", 0)]).status, "overdue_14");
assert.equal(current(subscription(), [expiry("2026-11-20", 0)]).status, "review");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { remainingMeals: undefined })]).status, "review", "missing remaining must never become zero");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { reservedMeals: undefined })]).status, "review", "missing reserved must never become zero");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { exhaustedAt: "2026-10-15T10:00:00Z" })]).status, "overdue_14");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { sourceType: "legacy_seed", exhaustedAt: "2026-10-15T10:00:00Z" })]).status, "review");
assert.equal(current(subscription(), [expiry("2026-10-10", 0), expiry("2026-11-20", 5, { _id: "b2" })]).status, "active");
assert.equal(current(subscription({ status: "canceled" }), []).status, "canceled");
const canonical = buildCanonical([{ sourceUserId: "u1", targetUserId: "u2", state: "completed" }]);
assert.equal(canonical("u1"), "u2");
const rows = buildLiveRows({
  subscriptions: [subscription()],
  batches: [],
  users: [{ _id: "u2", name: "Test", phone: "966500000000" }],
  merges: [{ sourceUserId: "u1", targetUserId: "u2", state: "completed" }],
  now: new Date("2026-10-31T15:00:00Z"),
});
assert.equal(rows.length, 1);
assert.equal(rows[0].userId, "u2");
assert.equal(rows[0].status, "grace_14");
assert.equal(rows[0].lastRecordedAt, "2026-09-01T10:00:00.000Z");
assert.equal(rows[0].lastPurchaseAt, undefined, "record timestamp must not claim verified paid purchase");
console.log("customerRetentionReadService: PASS");

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
  applicationState: "applied", paymentId: "p1",
  status: "active",
  validityEndDate: day + "T20:59:59.000Z",
  effectiveStartDate: "2026-10-01T00:00:00Z",
  remainingMeals: remaining,
  reservedMeals: 0,
  ...props,
});
const subscription = (props = {}) => ({
  _id: "s1", status: "active", createdAt: "2026-09-01T10:00:00Z",
  userId: "u1", totalPriceHalala: 10000, remainingMeals: 10, reservedMeals: 0,
  validityEndDate: "2026-10-25T20:59:59Z", startDate: "2026-09-01T00:00:00Z",
  ...props,
});
const current = (s, b) => classifyEntitlements({
  subscriptions: [s], batches: b, nowKey,
  payments: [{ _id: "p1", subscriptionId: "s1", userId: "u1", type: "subscription_activation", status: "paid", amount: 10000 }],
});
assert.equal(addDays("2026-10-31", 1), "2026-11-01");
assert.equal(dateKey("2026-10-31T22:30:00Z"), "2026-11-01", "KSA calendar day must be used");
assert.equal(current(subscription(), [expiry("2026-11-20")]).status, "active");
assert.equal(current(subscription(), [expiry("2026-11-02")]).status, "due_soon");
assert.equal(current(subscription(), [expiry("2026-10-25", 1)]).status, "grace_14");
assert.equal(current(subscription(), [expiry("2026-10-10", 1)]).status, "overdue_14");
assert.equal(current(subscription(), [expiry("2026-11-20", 0)]).status, "review");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { remainingMeals: undefined })]).status, "review", "missing remaining must never become zero");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { reservedMeals: undefined })]).status, "review", "missing reserved must never become zero");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { exhaustedAt: "2026-10-15T10:00:00Z" })]).status, "overdue_14");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { sourceType: "legacy_seed", exhaustedAt: "2026-10-15T10:00:00Z" })]).status, "review");
assert.equal(current(subscription(), [expiry("2026-10-10", 0), expiry("2026-11-20", 5, { _id: "b2" })]).status, "active");
assert.equal(current(subscription({ status: "canceled" }), []).status, "canceled");
const cycle = buildCanonical([{ sourceUserId: "u1", targetUserId: "u2", state: "completed" },
  { sourceUserId: "u2", targetUserId: "u1", state: "completed" }]);
assert.equal(cycle("u1"), cycle("u2"));
assert.equal(cycle.isAmbiguous("u1"), true);
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
const suppressedRows = buildLiveRows({
  subscriptions: [subscription()], batches: [],
  users: [{ _id: "u2", name: "Test" }],
  merges: [{ sourceUserId: "u1", targetUserId: "u2", state: "completed" }],
  optedOutIds: ["u1"], now: new Date("2026-10-31T15:00:00Z"),
});
assert.equal(suppressedRows[0].doNotContact, true, "Opt-outs survive account merge");
// Positive applied entitlement is never proof of settlement on its own.
assert.equal(current(subscription(), [expiry("2026-11-20", 5, { paymentId: "missing" })]).status, "review");
for (const applicationState of ["pending", "applying", "failed"]) {
  assert.equal(current(subscription(), [expiry("2026-10-10", 1), expiry("2026-11-20", 5, { applicationState })]).status, "review");
}
assert.equal(classifyEntitlements({ subscriptions: [subscription({ totalPriceHalala: 0 })], batches: [], nowKey }).status, "review");
assert.equal(current(subscription(), [expiry("2026-11-20", 1, { effectiveStartDate: "2026-11-01T00:00:00+03:00" })]).status, "scheduled");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { reservedMeals: 4 })]).balance, 4);
assert.equal(current(subscription({ remainingMeals: 900 }), [expiry("2026-11-20", 3, { reservedMeals: 2 })]).balance, 5, "Never add parent mirror");
assert.equal(current(subscription({ status: "frozen" }), [expiry("2026-11-20", 4)]).status, "active", "Use freeze-extended batch validity");
assert.equal(current(subscription(), [expiry("2026-11-20", 4, { validityEndDate: "2026-11-23T20:59:59Z" })]).dueDate, "2026-11-24", "Compensation extension is authoritative");
assert.equal(current(subscription(), [expiry("2026-10-01", 0, { exhaustedAt: "2026-10-01T10:00:00Z" }), expiry("2026-10-30", 1)]).dueDate, "2026-10-31", "Most recent portfolio boundary includes expired purchases");
assert.equal(current(subscription(), [expiry("2026-10-10", 0)]).status, "review", "Expired zero balance with undated manual depletion remains uncertain");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { exhaustedAt: "2026-11-01T10:00:00Z" })]).status, "review");
assert.equal(current(subscription(), [expiry("2026-11-20", 0, { exhaustedAt: "2026-09-01T10:00:00Z" })]).status, "review");
assert.equal(current(subscription(), [expiry("2026-11-20", 1, { effectiveStartDate: "2026-12-01T10:00:00Z" })]).status, "review");
assert.equal(current(subscription(), [expiry("2026-11-20", 5, { status: "canceled" })]).status, "review");
assert.equal(current(subscription(), [expiry("2026-11-20", 5, { containerSubscriptionId: "orphan" })]).status, "review");
assert.equal(current(subscription(), [expiry("2026-10-16", 1)]).status, "grace_14", "Exactly day 14 remains in grace");
assert.equal(current(subscription(), [expiry("2026-10-15", 1)]).status, "overdue_14", "Day 15 is outside grace");
const initialRows = buildLiveRows({ subscriptions: [subscription()],
  batches: [expiry("2026-11-20", 5, { userId: "u1", createdAt: "2026-09-01T10:00:00Z", sourceType: "checkout" })],
  payments: [{ _id: "p1", userId: "u1", subscriptionId: "s1", status: "paid", type: "subscription_activation", amount: 10000 }],
  users: [], merges: [], now: new Date("2026-10-31T15:00:00Z") });
assert.equal(initialRows[0].subscriptionRecordCount, 1, "Initial checkout parent and batch count once");
for (const status of ["initiated", "failed", "canceled", "expired", "refunded"]) {
  assert.equal(classifyEntitlements({ subscriptions: [subscription()], batches: [], nowKey,
    payments: [{ _id: "p1", userId: "u1", subscriptionId: "s1", type: "subscription_activation", amount: 10000, status }] }).status, "review");
}
console.log("customerRetentionReadService: PASS (calendar, stacking, payment evidence, freeze, compensation, depletion, merge)");

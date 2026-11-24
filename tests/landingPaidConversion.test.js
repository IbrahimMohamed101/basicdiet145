"use strict";
const assert = require("node:assert/strict");
const { completedPipeline, summarizeCompleted } = require("../src/services/landingPaidConversionReadService");
const { parseEvent } = require("../src/services/landingAnalyticsService");
const { randomUUID } = require("node:crypto");

const at = new Date("2026-11-24T12:00:00Z");
const row = { _id: "p1", userId: "u1", type: "subscription_activation", amount: 100810, paidAt: at, completedAt: at };
const renewal = { ...row, _id: "p2", type: "subscription_renewal" };
const leads = [
  { _id: "l1", phone: "+966500000000", contactConsent: true, createdAt: new Date("2026-11-20"), source: "ig" },
  { _id: "l2", phone: "0500000000", contactConsent: true, createdAt: new Date("2026-11-25"), source: "fb" },
  { _id: "l3", phone: "0500000000", contactConsent: false, createdAt: new Date("2026-11-23"), source: "tt" }
];
const users = [{ _id: "u1", phone: "0500000000" }];
const history = [{ _id: "u1", firstPaymentId: "p1" }];
const result = summarizeCompleted([row, row, renewal], leads, users, history);
assert.equal(result.completed, 2);
assert.equal(result.firstRecordedPaidPurchases, 1);
assert.equal(result.renewalPayments, 1);
assert.equal(result.repeatOrRenewalPurchases, 1);
assert.equal(result.amountHalala, 201620);
assert.deepEqual(result.sources, [{ source: "instagram", completed: 2, amountHalala: 201620 }]);
assert.equal(summarizeCompleted([row], leads, [...users, {_id: "u2", phone: "0500000000"}], history).unmatched, 1);
assert.equal(summarizeCompleted([row], [{...leads[0], createdAt: new Date("2026-09-01")}], users, history).unmatched, 1);
assert.equal(summarizeCompleted([row], [], users, []).unknownPurchaseHistory, 1);
const pipeline = completedPipeline({ start: at, end: at }, "checkoutdrafts");
assert.equal(pipeline[0].$match.status, "paid");
assert.equal(pipeline[0].$match.applied, true);
assert.equal(pipeline[3].$match["draft.status"], "completed");
assert.equal(parseEvent({event:"subscription_paid_completed",eventId:randomUUID(),sessionId:randomUUID()}), null);
console.log("Landing paid conversion read-side contracts: PASS");

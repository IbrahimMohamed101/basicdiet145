"use strict";
const assert = require("node:assert/strict");
const { normalizeFollowupPayload } = require("../src/services/dashboard/customerRetentionFollowupService");
const sample = {
  requestId: "f0c0a3f9-1122-43b8-aabb-112233445566",
  channel: "phone", outcome: "no_answer", reasonCode: "unknown", note: "",
};
assert.deepEqual(normalizeFollowupPayload(sample), sample);
assert.throws(() => normalizeFollowupPayload({ ...sample, outcome: "renewed" }),
  (e) => e.code === "INVALID_RETENTION_FOLLOWUP");
assert.throws(() => normalizeFollowupPayload({ ...sample, phone: "9665" }),
  (e) => e.code === "INVALID_RETENTION_FOLLOWUP");
assert.throws(() => normalizeFollowupPayload({ ...sample, reasonCode: "other", note: "" }),
  (e) => e.code === "INVALID_RETENTION_FOLLOWUP");
assert.throws(() => normalizeFollowupPayload({ ...sample, requestId: "short" }),
  (e) => e.code === "INVALID_RETENTION_FOLLOWUP");
console.log("customerRetentionFollowupService: PASS");

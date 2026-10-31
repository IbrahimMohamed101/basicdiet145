"use strict";
const mongoose = require("mongoose");
const User = require("../../models/User");
const Event = require("../../models/RetentionFollowupEvent");
const { getRetentionContactPolicy } = require("./retentionContactPolicyService");

const CHANNELS = ["phone", "whatsapp", "in_person", "other"];
const OUTCOMES = [
  "no_answer", "contacted", "interested", "callback_requested",
  "not_interested", "client_claims_renewed", "do_not_contact",
];
const REASONS = ["unknown", "price", "menu", "delivery", "quality", "payment", "no_need", "other"];
function failure(status, code, message) {
  const error = new Error(message);
  error.status = status; error.code = code;
  return error;
}
function validateCustomerId(value) {
  if (!mongoose.isValidObjectId(value)) throw failure(400, "INVALID_CUSTOMER_ID", "Invalid customer ID");
  return String(value);
}
function normalizeFollowupPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure(400, "INVALID_RETENTION_FOLLOWUP", "Invalid follow-up payload");
  }
  const allowed = ["requestId", "channel", "outcome", "reasonCode", "note"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw failure(400, "INVALID_RETENTION_FOLLOWUP", "Unsupported follow-up field");
  }
  const requestId = String(value.requestId || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) {
    throw failure(400, "INVALID_RETENTION_FOLLOWUP", "requestId must be a safe idempotency key");
  }
  const channel = String(value.channel || "");
  const outcome = String(value.outcome || "");
  const reasonCode = String(value.reasonCode || "unknown");
  const note = String(value.note || "").trim();
  if (!CHANNELS.includes(channel) || !OUTCOMES.includes(outcome) || !REASONS.includes(reasonCode)
    || note.length > 500) {
    throw failure(400, "INVALID_RETENTION_FOLLOWUP", "Invalid follow-up values");
  }
  if (reasonCode === "other" && note.length < 3) {
    throw failure(400, "INVALID_RETENTION_FOLLOWUP", "Please include a reason in notes");
  }
  return { requestId, channel, outcome, reasonCode, note };
}
function serialize(event) {
  return {
    id: String(event._id), userId: String(event.userId),
    channel: event.channel, outcome: event.outcome,
    reasonCode: event.reasonCode, note: event.note, createdAt: event.createdAt,
  };
}
async function assertCustomer(customerId) {
  const id = validateCustomerId(customerId);
  const customer = await User.findOne({ _id: id, role: "client" })
    .select("_id mergedIntoUserId").lean();
  if (!customer) throw failure(404, "CUSTOMER_NOT_FOUND", "Customer not found");
  if (customer.mergedIntoUserId) throw failure(409, "CUSTOMER_MERGED", "Open the canonical customer account");
  return id;
}
async function getCustomerRetentionFollowups(customerId) {
  const userId = await assertCustomer(customerId);
  const { userIds } = await getRetentionContactPolicy(userId);
  const rows = await Event.find({ userId: { $in: userIds } })
    .sort({ createdAt: -1, _id: -1 }).limit(30).lean();
  return rows.map(serialize);
}
async function createCustomerRetentionFollowup({ customerId, actorId, payload }) {
  const userId = await assertCustomer(customerId);
  if (!mongoose.isValidObjectId(actorId)) throw failure(403, "FORBIDDEN", "Missing authenticated dashboard user");
  const input = normalizeFollowupPayload(payload);
  const expected = { userId, actorId: String(actorId), channel: input.channel,
    outcome: input.outcome, reasonCode: input.reasonCode, note: input.note };
  const identical = (row) => row
    && String(row.userId) === expected.userId
    && String(row.actorId) === expected.actorId
    && row.channel === expected.channel && row.outcome === expected.outcome
    && row.reasonCode === expected.reasonCode && row.note === expected.note;
  const previous = await Event.findById(input.requestId).lean();
  if (previous) {
    if (!identical(previous)) throw failure(409, "FOLLOWUP_IDEMPOTENCY_CONFLICT", "requestId was used for different data");
    return { event: serialize(previous), replayed: true };
  }
  const policy = await getRetentionContactPolicy(userId);
  if (policy.doNotContact) {
    throw failure(409, "CUSTOMER_DO_NOT_CONTACT", "Customer requested no further contact");
  }
  try {
    const created = await Event.create({
      _id: input.requestId, userId, actorId, channel: input.channel,
      outcome: input.outcome, reasonCode: input.reasonCode, note: input.note,
    });
    return { event: serialize(created), replayed: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const replayed = await Event.findById(input.requestId).lean();
    if (!identical(replayed)) throw failure(409, "FOLLOWUP_IDEMPOTENCY_CONFLICT", "requestId was used for different data");
    return { event: serialize(replayed), replayed: true };
  }
}
module.exports = {
  CHANNELS, OUTCOMES, REASONS, normalizeFollowupPayload,
  getCustomerRetentionFollowups, createCustomerRetentionFollowup,
};

"use strict";
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { parseEvent, recordEvent } = require("../src/services/landingAnalyticsService");
const EventModel = require("../src/models/LandingAnalyticsEvent");
const { hasValidIngestSecret } = require("../src/routes/landingAnalytics");

const base = () => ({
  event: "lp_view", eventId: crypto.randomUUID(), sessionId: crypto.randomUUID(),
  path: "/", source: "instagram", campaign: "وجبات_جدة",
  device: "android", referrerHost: "www.instagram.com",
});
async function run() {
  const row = parseEvent(base());
  assert.equal(row.event, "lp_view");
  assert.equal(row.campaign, "وجبات_جدة");
  assert.equal(row.source, "instagram");
  assert.equal(row.device, "android");
  assert.equal(row.referrerHost, "www.instagram.com");
  assert.equal(row.expiresAt.getTime() > Date.now(), true);
  assert.equal("email" in row, false);
  assert.equal("ip" in row, false);
  assert.equal("phone" in row, false);

  assert.equal(parseEvent({ ...base(), event: "unknown" }), null);
  assert.equal(parseEvent({ ...base(), eventId: "not-a-uuid" }), null);
  assert.equal(parseEvent({ ...base(), sessionId: "not-a-uuid" }), null);
  assert.equal(parseEvent({ ...base(), event: "lp_store_click" }), null);
  assert.equal(parseEvent({ ...base(), event: "lp_cta_click", location: "invalid" }), null);
  assert.equal(parseEvent({ ...base(), event: "lp_section_view", section: "other" }), null);

  const plan = parseEvent({ ...base(), event: "lp_cta_click", location: "plans", planDays: 26, store: "invalid" });
  assert.equal(plan.planDays, 26);
  assert.equal(plan.store, "");
  assert.equal(parseEvent({ ...base(), planDays: 999 }).planDays, null);

  const before = process.env.LANDING_ANALYTICS_INGEST_SECRET;
  process.env.LANDING_ANALYTICS_INGEST_SECRET = "test-secret-value";
  const request = (value) => ({ get: () => value });
  assert.equal(hasValidIngestSecret(request("test-secret-value")), true);
  assert.equal(hasValidIngestSecret(request("incorrect")), false);
  assert.equal(hasValidIngestSecret(request("")), false);
  if (before === undefined) delete process.env.LANDING_ANALYTICS_INGEST_SECRET;
  else process.env.LANDING_ANALYTICS_INGEST_SECRET = before;

  const originalCreate = EventModel.create;
  try {
    EventModel.create = async () => ({ id: 1 });
    assert.deepEqual(await recordEvent(base()), { ok: true, created: true });
    EventModel.create = async () => { const error = new Error("duplicate"); error.code = 11000; throw error; };
    assert.deepEqual(await recordEvent(base()), { ok: true, created: false });
  } finally { EventModel.create = originalCreate; }
  console.log("Landing analytics security, validation, and dedupe: PASS");
}
run().catch(err => { console.error(err); process.exitCode = 1; });

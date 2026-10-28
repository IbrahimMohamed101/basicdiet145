"use strict";
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { parseEvent, recordEvent } = require("../src/services/landingAnalyticsService");
const EventModel = require("../src/models/LandingAnalyticsEvent");
const { classifySource, summarizeSources } = require("../src/services/landingAttribution");
const { hasValidIngestSecret } = require("../src/routes/landingAnalytics");

const base = () => ({
  event: "lp_view", eventId: crypto.randomUUID(), sessionId: crypto.randomUUID(),
  path: "/", source: "instagram", campaign: "وجبات_جدة",
  device: "android", referrerHost: "www.instagram.com",
});
async function run() {
  assert.deepEqual(classifySource("ig", ""), { key: "instagram", method: "utm" });
  assert.deepEqual(classifySource("snapchat", "www.google.com"), { key: "snapchat", method: "utm" });
  assert.deepEqual(classifySource("", "l.instagram.com"), { key: "instagram", method: "referrer" });
  assert.deepEqual(classifySource("", "www.google.com"), { key: "google", method: "referrer" });
  assert.deepEqual(classifySource("", "www.google.com.evil.example"), { key: "other_referral", method: "referrer" });
  assert.deepEqual(classifySource("", "basicdietksa.com"), { key: "unattributed", method: "unattributed" });
  assert.deepEqual(classifySource("", ""), { key: "unattributed", method: "unattributed" });
  const summary = summarizeSources([
    { _id: { source: "ig", referrerHost: "" }, count: 49 },
    { _id: { source: "", referrerHost: "www.google.com" }, count: 15 },
    { _id: { source: "", referrerHost: "" }, count: 134 },
  ]);
  assert.equal(summary.rows.find(row => row.key === "instagram").count, 49);
  assert.equal(summary.rows.find(row => row.key === "google").count, 15);
  assert.equal(summary.rows.find(row => row.key === "unattributed").count, 134);
  assert.deepEqual(summary.attribution, { utm: 49, referrer: 15, unattributed: 134, total: 198, knownRate: 32.3 });
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
  const opened = parseEvent({ ...base(), event: "lp_lead_opened", path: "/menu",
    location: "header", placement: "menu_basic15_header", phone: "+966501234567" });
  assert.equal(opened.event, "lp_lead_opened");
  assert.equal(opened.placement, "menu_basic15_header");
  assert.equal("phone" in opened, false);
  assert.equal(parseEvent({ ...base(), event: "lp_lead_submitted",
    placement: "menu_basic15_header" }).placement, "menu_basic15_header");
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

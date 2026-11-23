"use strict";
const assert = require("node:assert/strict");
const { 
  metaConfigured, validFbp, validFbc, safePath,
  queueConsentedMetaLead, buildMetaPayload, sendMetaLead,
  processMetaLandingOutbox,
} = require("../src/services/metaLandingConversionsService");

const env = {
  META_CAPI_ENABLED: "true", META_CAPI_PIXEL_ID: "1234567890",
  META_CAPI_ACCESS_TOKEN: "test_only_012345678901234",
  META_CAPI_GRAPH_VERSION: "v25.0", META_CAPI_TEST_MODE: "true",
  META_CAPI_TEST_EVENT_CODE: "TEST_SAFE",
};

async function main() {
  assert.equal(metaConfigured({}), false);
  assert.equal(metaConfigured(env), true);
  assert.equal(validFbp("fb.1.1761700000000.123456789"), "fb.1.1761700000000.123456789");
  assert.equal(validFbc("fb.1.1761700000000.Abc_123"), "fb.1.1761700000000.Abc_123");
  assert.equal(validFbp("https://malicious/"), "");
  assert.equal(validFbc("x".repeat(300)), "");
  assert.equal(safePath("https://evil.example/"), "/menu");
  let created = [];
  const Model = { create: async doc => { created.push(doc); return doc; } };
  const lead = {
    requestId: "a73c2a37-2f54-4463-a676-5857b42ad67a",
    adsTrackingConsent: true, pagePath: "/menu",
    fbp: "fb.1.1761700000000.123456789",
    fbc: "fb.1.1761700000000.Abc_123",
    phone: "+966500000000", name: "NOT FOR META",
  };
  assert.equal((await queueConsentedMetaLead(lead, { Model, env: { ...env, META_CAPI_ENABLED: "false" } })).queued, false);
  assert.equal((await queueConsentedMetaLead({ ...lead, adsTrackingConsent: false }, { Model, env })).queued, false);
  assert.equal((await queueConsentedMetaLead({ ...lead, fbp: "", fbc: "" }, { Model, env })).queued, false);
  assert.equal(created.length, 0);
  assert.equal((await queueConsentedMetaLead(lead, { Model, env })).queued, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].eventId, lead.requestId);
  assert.equal(JSON.stringify(created[0]).includes(lead.phone), false);
  assert.equal(JSON.stringify(created[0]).includes(lead.name), false);
  assert.equal(created[0].sourcePath, "/menu");
  assert.equal(created[0].expiresAt > created[0].occurredAt, true);
  const payload = buildMetaPayload(created[0], { env });
  assert.equal(payload.data[0].event_name, "Lead");
  assert.equal(payload.data[0].event_id, lead.requestId);
  assert.equal(payload.data[0].event_source_url, "https://basicdietksa.com/menu");
  assert.deepEqual(payload.data[0].user_data,
    { fbp: lead.fbp, fbc: lead.fbc });
  assert.equal(payload.test_event_code, "TEST_SAFE");
  assert.equal(JSON.stringify(payload).includes(lead.phone), false);

  let captured;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return { ok: true };
  };
  assert.equal(await sendMetaLead(created[0], { env, fetchImpl: fakeFetch }), true);
  assert.equal(captured.url, "https://graph.facebook.com/v25.0/1234567890/events");
  assert.equal(captured.options.method, "POST");
  assert.match(captured.options.headers.authorization, /^Bearer test_only_/);
  assert.equal(captured.url.includes(env.META_CAPI_ACCESS_TOKEN), false);
  assert.deepEqual(JSON.parse(captured.options.body), payload);

  const record = { ...created[0], _id: "fake", state: "pending", attempts: 1 };
  const changes = [];
  let read = false;
  const MockOutbox = {
    findOneAndUpdate: async () => {
      if (read) return null;
      read = true;
      return record;
    },
    updateOne: async (...args) => { changes.push(args); },
  };
  const outcome = await processMetaLandingOutbox({ Model: MockOutbox, env, fetchImpl: fakeFetch });
  assert.deepEqual(outcome, { sent: 1, retried: 0, failed: 0 });
  assert.equal(changes[0][1].$set.state, "sent");
  assert.equal(changes[0][1].$set.fbp, "");
  assert.equal(changes[0][1].$set.fbc, "");

  console.log("Meta CAPI consent, outbox and no-PII contract: PASS");
}
main().catch(e => { console.error(e); process.exitCode = 1; });

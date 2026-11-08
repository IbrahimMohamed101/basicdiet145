"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSeedBundle, assertStagingDatabaseEnvironment } = require("../scripts/pos/seedPhaseGStaging");

const safe = {
  plans: [{ _id: "000000000000000000000001", key: "test_plan_7",
    name: { ar: "باقة تجريبية", en: "Synthetic plan" }, daysCount: 7 }],
  zones: [{ _id: "000000000000000000000002", name: { ar: "منطقة تجريبية" },
    deliveryFeeHalala: 0 }],
};

test("G0 seed: allows only known business config and stable IDs", () => {
  const result = validateSeedBundle(safe);
  assert.equal(result.counts.plans, 1);
  assert.equal(result.counts.zones, 1);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
});
test("G0 seed: rejects customer data, fields and PII in settings", () => {
  assert.throws(() => validateSeedBundle({ customers: [] }), /Non-config/);
  assert.throws(() => validateSeedBundle({ plans: [{ ...safe.plans[0], phone: "+966500000001" }] }), /Unapproved field/);
  assert.throws(() => validateSeedBundle({ settings: [{ _id: safe.plans[0]._id,
    key: "public_text", value: { contactPhone: "+966500000001" } }] }), /Sensitive or unsafe field/);
  assert.throws(() => validateSeedBundle({ settings: [{ _id: safe.plans[0]._id,
    key: "public_text", value: "Please contact someone@example.com" }] }), /PII-like string/);
  assert.throws(() => validateSeedBundle({ plans: [{ _id: "notObjectId", key: "x" }] }), /stable 24-digit/);
});
test("G0 seed: refuses Production hostname or environment even with staging switch", () => {
  const env = {
    RAILWAY_ENVIRONMENT_ID: "90700265-e775-4075-a99c-8d04508a7d98",
    RAILWAY_SERVICE_ID: "9a6d629e-c9f4-4687-bf83-613011606018",
    POS_STAGING_ISOLATED: "true",
    NODE_ENV: "staging",
    POS_STAGING_MONGO_URL: "mongodb://tester:secret@mongodb.railway.internal:27017/test",
  };
  assert.throws(() => assertStagingDatabaseEnvironment(env), /non-isolated Mongo/);
  assert.throws(() => assertStagingDatabaseEnvironment({
    ...env, RAILWAY_ENVIRONMENT_ID: "509cc4bf-c2bd-42be-9912-0619bbb94dfd",
  }), /outside dedicated POS Staging/);
  const ok = assertStagingDatabaseEnvironment({
    ...env, POS_STAGING_MONGO_URL: "mongodb://tester:secret@mongodb-qxhu.railway.internal:27017/admin",
  });
  const url = new URL(ok);
  assert.equal(url.pathname, "/basicdiet_pos_staging_test");
  assert.equal(url.searchParams.get("replicaSet"), "rs0");
});

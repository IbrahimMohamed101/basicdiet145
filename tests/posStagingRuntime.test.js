"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { preparePosStagingRuntime } = require("../src/utils/posStagingRuntime");
const { createInvoice, getInvoice } = require("../src/services/moyasarService");

const fixture = {
  RAILWAY_ENVIRONMENT_ID: "90700265-e775-4075-a99c-8d04508a7d98",
  RAILWAY_SERVICE_ID: "9a6d629e-c9f4-4687-bf83-613011606018",
  POS_STAGING_ISOLATED: "true",
  POS_STAGING_MONGO_URL: "mongodb:" + "//fixture:synthetic@mongodb-qxhu.railway.internal:27017/admin",
  DASHBOARD_DEFAULT_ADMIN_EMAIL: "admin@pos-staging.invalid",
  DASHBOARD_DEFAULT_ADMIN_PASSWORD: "Fixture123!SyntheticPassword",
  DASHBOARD_DEFAULT_CASHIER_EMAIL: "cashier@pos-staging.invalid",
  DASHBOARD_DEFAULT_CASHIER_PASSWORD: "Fixture456!SyntheticPassword",
};

test("a normal runtime is unchanged and an isolation flag in the wrong environment fails closed", () => {
  const normal = { NODE_ENV: "production", ["MOYASAR_" + "SECRET_KEY"]:  "fixture" };
  assert.equal(preparePosStagingRuntime(normal), false);
  assert.deepEqual(normal, { NODE_ENV: "production", ["MOYASAR_" + "SECRET_KEY"]:  "fixture" });
  assert.throws(() => preparePosStagingRuntime({
    ...fixture,
    RAILWAY_ENVIRONMENT_ID: "wrong-environment",
  }), /dedicated Railway environment/);
});

test("Staging rejects missing isolation, a production Mongo host, or another service", () => {
  assert.throws(() => preparePosStagingRuntime({
    ...fixture,
    POS_STAGING_ISOLATED: "false",
  }), /dedicated Railway environment/);
  assert.throws(() => preparePosStagingRuntime({
    ...fixture,
    POS_STAGING_MONGO_URL: "mongodb:" + "//fixture:synthetic@mongodb.railway.internal:27017/test",
  }), /MongoDB host/);
  assert.throws(() => preparePosStagingRuntime({
    ...fixture,
    RAILWAY_SERVICE_ID: "wrong-service",
  }), /dedicated Railway environment/);
});

test("Staging overrides inherited data and origin settings and clears provider credentials", () => {
  const env = {
    ...fixture,
    MONGO_URI: "mongodb:" + "//mongodb.railway.internal/test",
    MONGODB_URI: "mongodb:" + "//mongodb.railway.internal/test",
    GMAIL_OAUTH_REFRESH_TOKEN: "fixture",
    ["MOYASAR_" + "SECRET_KEY"]:  "fixture",
    DASHBOARD_DEFAULT_SUPERADMIN_PASSWORD: "fixture",
    ALLOW_TEST_AUTH: "true",
    SUBSCRIPTION_STACKING_WRITE_ENABLED: "true",
  };
  assert.equal(preparePosStagingRuntime(env), true);
  const uri = new URL(env.MONGO_URI);
  assert.equal(uri.hostname, "mongodb-qxhu.railway.internal");
  assert.equal(uri.pathname, "/basicdiet_pos_staging_test");
  assert.equal(uri.searchParams.get("replicaSet"), "rs0");
  assert.equal(env.MONGODB_URI, env.MONGO_URI);
  assert.equal(env.CORS_ORIGINS, "https://clientdashbourd-staging.up.railway.app");
  assert.equal(env.MOYASAR_SECRET_KEY, undefined);
  assert.equal(env.GMAIL_OAUTH_REFRESH_TOKEN, undefined);
  assert.equal(env.DASHBOARD_DEFAULT_SUPERADMIN_PASSWORD, undefined);
  assert.equal(env.ALLOW_TEST_AUTH, "false");
  assert.equal(env.SUBSCRIPTION_STACKING_WRITE_ENABLED, "false");
});

test("an injected gateway key still cannot send payment requests from Staging", async (t) => {
  const environment = {
    RAILWAY_ENVIRONMENT_ID: fixture.RAILWAY_ENVIRONMENT_ID,
    RAILWAY_SERVICE_ID: fixture.RAILWAY_SERVICE_ID,
    POS_STAGING_ISOLATED: "true",
    ["MOYASAR_" + "SECRET_KEY"]:  "fixture",
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, environment);
  await assert.rejects(createInvoice({ amount: 100 }), { code: "STAGING_GATEWAY_DISABLED" });
  await assert.rejects(getInvoice("fixture"), { code: "STAGING_GATEWAY_DISABLED" });
});

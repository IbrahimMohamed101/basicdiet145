"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getPosRuntimeStatus, requireFinancialStagingWrites } =
  require("../src/services/pos/financialRuntime");
function conn(hello) {
  return { name: "test", host: "mongodb.railway.internal", readyState: 1,
    db: { admin: () => ({ command: async () => hello }) } };
}
test("Production without explicit activation is disabled without connecting to Mongo", async () => {
  let commandCalled = false;
  const result = await getPosRuntimeStatus({
    env: { NODE_ENV: "production" },
    connection: { ...conn({}), db: { admin: () => ({ command: async () => {commandCalled = true;} }) } },
  });
  assert.equal(result.reason, "POS_DISABLED");
  assert.equal(result.enabled, false);
  assert.equal(commandCalled, false);
});
test("explicit Production activation without rs0 PRIMARY stays disabled", async () => {
  for (const hello of [{ isWritablePrimary: true }, { setName: "rs0", isWritablePrimary: false },
    { setName: "wrong", isWritablePrimary: true }]) {
    const status = await getPosRuntimeStatus({
      env: { NODE_ENV: "production", POS_PRODUCTION_ENABLED: "true" },
      connection: conn(hello),
    });
    assert.equal(status.reason, "POS_DISABLED");
  }
});
test("explicit Production activation and live PRIMARY rs0 enables tax POS only for correct database/host", async () => {
  const enabled = await getPosRuntimeStatus({
    env: { NODE_ENV: "production", POS_PRODUCTION_ENABLED: "true" },
    connection: conn({ setName: "rs0", isWritablePrimary: true }),
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.documentType, "SIMPLIFIED_TAX_INVOICE");
  assert.equal(enabled.financialWritesEnabled, true);
  const wrongHost = await getPosRuntimeStatus({
    env: { NODE_ENV: "production", POS_PRODUCTION_ENABLED: "true" },
    connection: { ...conn({ setName: "rs0", isWritablePrimary: true }), host: "staging.railway.internal" },
  });
  assert.equal(wrongHost.enabled, false);
});
test("Staging remains exactly isolated; Production flag cannot relax its own write toggle", async () => {
  const env = { POS_STAGING_ISOLATED: "true",
    RAILWAY_ENVIRONMENT_ID: "90700265-e775-4075-a99c-8d04508a7d98",
    RAILWAY_SERVICE_ID: "9a6d629e-c9f4-4687-bf83-613011606018",
    POS_STAGE_F_WRITES_ENABLED: "false", POS_PRODUCTION_ENABLED: "true" };
  const connection = { name: "basicdiet_pos_staging_test", host: "mongodb-qxhu.railway.internal" };
  const disabled = await getPosRuntimeStatus({ env, connection });
  assert.equal(disabled.environment, "staging");
  assert.equal(disabled.financialWritesEnabled, false);
  assert.equal(disabled.documentType, "STAGING_TEST_NON_TAX");
  assert.equal((await getPosRuntimeStatus({
    env: { ...env, POS_STAGE_F_WRITES_ENABLED: "true" }, connection,
  })).financialWritesEnabled, true);
  assert.equal((await getPosRuntimeStatus({
    env: { ...env, POS_STAGE_F_WRITES_ENABLED: "true" },
    connection: { ...connection, host: "mongodb.railway.internal" },
  })).enabled, false);
});
test("Production guard default rejects writes as HTTP 403 POS_DISABLED", async () => {
  const original = process.env.POS_PRODUCTION_ENABLED;
  process.env.POS_PRODUCTION_ENABLED = "false";
  try {
    await assert.rejects(requireFinancialStagingWrites(), (error) =>
      error.status === 403 && error.code === "POS_DISABLED");
  } finally {
    if (original === undefined) delete process.env.POS_PRODUCTION_ENABLED;
    else process.env.POS_PRODUCTION_ENABLED = original;
  }
});

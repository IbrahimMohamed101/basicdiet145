"use strict";

const assert = require("node:assert");
const {
  setTemporaryEnvironment,
  withTemporaryEnvironment,
} = require("./helpers/temporaryEnvironment");

async function run() {
  const existingName = "TEST_TEMPORARY_ENV_EXISTING";
  const missingName = "TEST_TEMPORARY_ENV_MISSING";
  process.env[existingName] = "original";
  delete process.env[missingName];

  const restore = setTemporaryEnvironment({
    [existingName]: "temporary",
    [missingName]: "created",
  });
  assert.strictEqual(process.env[existingName], "temporary");
  assert.strictEqual(process.env[missingName], "created");
  restore();
  restore();
  assert.strictEqual(process.env[existingName], "original");
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(process.env, missingName),
    false
  );

  await assert.rejects(
    withTemporaryEnvironment({ [existingName]: "inside" }, async () => {
      assert.strictEqual(process.env[existingName], "inside");
      throw new Error("expected failure");
    }),
    /expected failure/
  );
  assert.strictEqual(process.env[existingName], "original");
  delete process.env[existingName];

  console.log("temporaryEnvironment.test.js: 8/8 checks passed");
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

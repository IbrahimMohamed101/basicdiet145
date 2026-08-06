"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert");
const {
  normalizeBoolean,
  resolveMongooseIndexRuntimePolicy,
} = require("../src/utils/mongooseIndexRuntimePolicy");

function testProductionAlwaysDisablesAutoIndex() {
  assert.deepStrictEqual(
    resolveMongooseIndexRuntimePolicy({
      NODE_ENV: "production",
      MONGOOSE_AUTO_INDEX: "true",
    }),
    {
      nodeEnv: "production",
      autoIndex: false,
      source: "production_hard_block",
      configured: true,
    }
  );
}

function testNonProductionDefaultsToEnabled() {
  const result = resolveMongooseIndexRuntimePolicy({ NODE_ENV: "test" });
  assert.strictEqual(result.autoIndex, true);
  assert.strictEqual(result.source, "non_production_default");
}

function testNonProductionCanDisableAutoIndex() {
  const result = resolveMongooseIndexRuntimePolicy({
    NODE_ENV: "staging",
    MONGOOSE_AUTO_INDEX: "false",
  });
  assert.strictEqual(result.autoIndex, false);
  assert.strictEqual(result.source, "environment");
}

function testInvalidValueFailsClosed() {
  assert.throws(
    () => normalizeBoolean("sometimes"),
    (err) => Boolean(err && err.code === "INVALID_MONGOOSE_AUTO_INDEX")
  );
}

function run() {
  testProductionAlwaysDisablesAutoIndex();
  testNonProductionDefaultsToEnabled();
  testNonProductionCanDisableAutoIndex();
  testInvalidValueFailsClosed();
  console.log("mongoose production index runtime policy tests passed");
}

run();

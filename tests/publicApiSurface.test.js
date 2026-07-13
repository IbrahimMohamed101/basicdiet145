"use strict";

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret_test";

const assert = require("assert");
const request = require("supertest");
const { createApp } = require("../src/app");

const results = { passed: 0, failed: 0 };

async function test(name, fn) {
  try {
    await fn();
    results.passed += 1;
    console.log(`  OK  ${name}`);
  } catch (err) {
    results.failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err && err.stack ? err.stack : err);
  }
}

(async function run() {
  console.log("\n-- Public API surface --");

  await test("does not expose the legacy debug information endpoint", async () => {
    const app = createApp();
    const res = await request(app).get("/debug/info");

    assert.strictEqual(res.status, 404);
    assert.ok(!String(res.text || "").includes("db_host"));
    assert.ok(!String(res.text || "").includes("addonBalance"));
  });

  await test("root health response contains no database identifiers", async () => {
    const app = createApp();
    const res = await request(app).get("/");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body?.status, true);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(res.body || {}, "db_host"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(res.body || {}, "db_name"), false);
  });

  if (results.failed > 0) {
    process.exitCode = 1;
  }
  console.log(`\nPublic API surface tests: ${results.passed} passed, ${results.failed} failed`);
})();

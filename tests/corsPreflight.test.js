"use strict";

process.env.NODE_ENV = "production";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supersecret_test";
delete process.env.CORS_ORIGINS;
delete process.env.FRONTEND_URL;
delete process.env.DASHBOARD_URL;

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

function includesHeaderValue(headerValue, expectedValue) {
  return String(headerValue || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes(expectedValue.toLowerCase());
}

(async function run() {
  console.log("\n-- CORS preflight --");

  await test("allows localhost dashboard preflight before auth middleware", async () => {
    const app = createApp();
    const res = await request(app)
      .options("/api/dashboard/auth/me")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers["access-control-allow-origin"], "http://localhost:5173");
    assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
    assert.ok(includesHeaderValue(res.headers["access-control-allow-methods"], "GET"));
    assert.ok(includesHeaderValue(res.headers["access-control-allow-methods"], "OPTIONS"));
    assert.ok(includesHeaderValue(res.headers["access-control-allow-headers"], "Authorization"));
    assert.ok(includesHeaderValue(res.headers["access-control-allow-headers"], "Content-Type"));
  });

  await test("allows Railway production dashboard origin by default", async () => {
  const app = createApp();
  const res = await request(app)
    .options("/api/dashboard/auth/me")
    .set("Origin", "https://clientdashbourd-production.up.railway.app")
    .set("Access-Control-Request-Method", "GET")
    .set("Access-Control-Request-Headers", "authorization,content-type");

  assert.strictEqual(res.status, 204);
  assert.strictEqual(
    res.headers["access-control-allow-origin"],
    "https://clientdashbourd-production.up.railway.app"
  );
  assert.strictEqual(res.headers["access-control-allow-credentials"], "true");
});

  await test("allows comma-separated configured dashboard origins", async () => {
    process.env.CORS_ORIGINS = "https://dashboard.example.com, https://admin.example.com";
    const app = createApp();
    const res = await request(app)
      .options("/api/dashboard/auth/me")
      .set("Origin", "https://dashboard.example.com")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers["access-control-allow-origin"], "https://dashboard.example.com");
  });

  await test("rejects an untrusted browser origin", async () => {
    delete process.env.CORS_ORIGINS;
    const app = createApp();
    const res = await request(app)
      .options("/api/subscriptions/checkout")
      .set("Origin", "https://malicious.example.com")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
    assert.strictEqual(res.body?.error?.code, "CORS");
  });

  await test("allows checkout idempotency and correlation headers", async () => {
    const app = createApp();
    const res = await request(app)
      .options("/api/subscriptions/checkout")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "authorization,content-type,idempotency-key,x-idempotency-key,x-request-id,x-correlation-id"
      );

    assert.strictEqual(res.status, 204);
    const allowed = res.headers["access-control-allow-headers"];
    assert.ok(includesHeaderValue(allowed, "Idempotency-Key"));
    assert.ok(includesHeaderValue(allowed, "X-Idempotency-Key"));
    assert.ok(includesHeaderValue(allowed, "X-Request-Id"));
    assert.ok(includesHeaderValue(allowed, "X-Correlation-Id"));
  });

  if (results.failed > 0) {
    process.exitCode = 1;
  }
  console.log(`\nCORS preflight tests: ${results.passed} passed, ${results.failed} failed`);
})();

"use strict";

process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET ||= "g2-maintenance-ci-dashboard-only";
process.env.JWT_SECRET ||= "g2-maintenance-ci-only";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const supertest = require("supertest");
const { createApp } = require("../src/app");
const { startJobs } = require("../src/jobs");

function withMaintenance(t, state) {
  const original = process.env.MAINTENANCE_MODE;
  process.env.MAINTENANCE_MODE = state;
  t.after(() => {
    if (original === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = original;
  });
}

test("G2 maintenance blocks POST/PUT/PATCH/DELETE before all API, dashboard and Moyasar routes", async (t) => {
  withMaintenance(t, "true");
  const app = createApp();
  for (const path of ["/api/webhooks/moyasar", "/api/dashboard/pos/catalog/publish",
    "/api/dashboard/subscriptions", "/api/auth/login", "/api/landing/leads",
    "/api/does-not-exist"]) {
    for (const method of ["post", "put", "patch", "delete"]) {
      const response = await supertest(app)[method](path)
        .send({ synthetic: "g2-ci-only" });
      assert.equal(response.status, 503, method.toUpperCase() + " " + path);
      assert.equal(response.body.error?.code, "MAINTENANCE");
      assert.match(response.body.error?.message, /الصيانة/);
      assert.equal(response.headers["retry-after"], "300");
    }
  }
});

test("G2 maintenance preserves GET, /health, /live and CORS OPTIONS", async (t) => {
  withMaintenance(t, "true");
  const app = createApp();
  assert.equal((await supertest(app).get("/")).status, 200);
  assert.equal((await supertest(app).get("/live")).status, 200);
  const health = await supertest(app).get("/health");
  assert.notEqual(health.body.error?.code, "MAINTENANCE");
  const notFound = await supertest(app).get("/api/does-not-exist");
  assert.equal(notFound.status, 404);
  assert.equal((await supertest(app).options("/api/webhooks/moyasar")).status, 204);
  // Financial "GET" redirects are not read-only: they settle Moyasar payments.
  for (const url of ["/api/payments/verify", "/payments/success", "/payment-success"]) {
    const response = await supertest(app).get(url);
    assert.equal(response.status, 503, url);
    assert.equal(response.body.error?.code, "MAINTENANCE");
  }
});

test("G2 maintenance disabled preserves ordinary mutation routing", async (t) => {
  withMaintenance(t, "false");
  const response = await supertest(createApp()).post("/api/does-not-exist").send({});
  assert.equal(response.status, 404);
  assert.notEqual(response.body.error?.code, "MAINTENANCE");
});

test("G2 maintenance never schedules background jobs", (t) => {
  withMaintenance(t, "true");
  let timers = 0;
  t.mock.method(global, "setInterval", () => { timers += 1; return 1; });
  startJobs();
  assert.equal(timers, 0);
});

test("G2 baseline and initializer reject execution without maintenance before any DB access", () => {
  const result = spawnSync(process.execPath, ["scripts/g2-rs0-init-and-verify.js", "--baseline"], {
    env: { ...process.env, MAINTENANCE_MODE: "false", G2_OWNER_APPROVED: "true" },
    encoding: "utf8",
  });
  assert.equal(result.status, 72);
  assert.match(result.stderr, /G2_MAINTENANCE_REQUIRED/);
  assert.doesNotMatch(result.stdout, /G2_BASELINE=/);
});

test("G2 baseline rejects missing explicit owner approval before any DB access", () => {
  const result = spawnSync(process.execPath, ["scripts/g2-rs0-init-and-verify.js", "--baseline"], {
    env: { ...process.env, MAINTENANCE_MODE: "true", G2_OWNER_APPROVED: "false" },
    encoding: "utf8",
  });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /G2_OWNER_APPROVAL_REQUIRED/);
  assert.doesNotMatch(result.stdout, /G2_BASELINE=/);
});

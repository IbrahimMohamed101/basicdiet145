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
  for (const path of ["/api/webhooks/moyasar",
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
    for (const variant of [url, url.toUpperCase() + "/"]) {
      const response = await supertest(app).get(variant);
      assert.equal(response.status, 503, variant);
      assert.equal(response.body.error?.code, "MAINTENANCE");
      assert.equal((await supertest(app).head(variant)).status, 503, variant);
    }
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

test("G2 maintenance connects without creating collections or reconciling payment indexes", async (t) => {
  withMaintenance(t, "true");
  const mongoose = require("mongoose");
  const resolver = require("../src/utils/mongoUriResolver");
  const paymentIndexes = require("../src/services/paymentIndexService");
  const connection = {};
  const connect = t.mock.method(mongoose, "connect", async () => connection);
  t.mock.method(resolver, "resolveMongoUri", () => "g2-test-placeholder");
  const ensureIndexes = t.mock.method(paymentIndexes, "ensurePaymentIndexes", async () => {});
  const dbModule = require.resolve("../src/db");
  t.after(() => { delete require.cache[dbModule]; });

  const { connectDb } = require(dbModule);
  assert.equal(await connectDb(), connection);
  assert.equal(connect.mock.calls[0].arguments[1].autoIndex, false);
  assert.equal(connect.mock.calls[0].arguments[1].autoCreate, false);
  assert.equal(ensureIndexes.mock.callCount(), 0);

  process.env.MAINTENANCE_MODE = "false";
  assert.equal(await connectDb(), connection);
  assert.equal(Object.hasOwn(connect.mock.calls[1].arguments[1], "autoCreate"), false);
  assert.equal(ensureIndexes.mock.callCount(), 1);
});

test("G2 manifest collects counts and index definitions and skips views", async () => {
  const { collect } = require("../scripts/g2-mongo-manifest");
  const requested = [];
  const database = {
    listCollections: () => ({
      toArray: async () => [
        { name: "reports_view", type: "view" },
        { name: "system.profile", type: "collection" },
        { name: "events", type: "collection" },
      ],
    }),
    collection(name) {
      requested.push(name);
      return {
        countDocuments: async (filter) => {
          assert.deepEqual(filter, {});
          return name === "events" ? 4 : 1;
        },
        indexes: async () => name === "events" ? [
          { name: "ttl", key: { createdAt: 1 }, expireAfterSeconds: 60 },
          { name: "_id_", key: { _id: 1 }, unique: true },
        ] : [],
      };
    },
  };

  assert.deepEqual(await collect(database), {
    events: {
      count: 4,
      indexes: [
        { name: "_id_", key: { _id: 1 }, unique: true, sparse: false },
        { name: "ttl", key: { createdAt: 1 }, unique: false, sparse: false, expireAfterSeconds: 60 },
      ],
    },
    "system.profile": { count: 1, indexes: [] },
  });
  assert.deepEqual(requested, ["events", "system.profile"]);
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

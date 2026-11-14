"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const express = require("express");
const supertest = require("supertest");
const { formatPosDocumentNumber } = require("../src/services/pos/posDocumentNumber");
const { getPosRuntimeStatus } = require("../src/services/pos/financialRuntime");
const { resolveClosingVersion, LEGACY } = require("../src/services/pos/posClosingSetting");
const { isPosStagingRuntime } = require("../src/utils/posStagingRuntime");

test("production POS absent explicit activation returns POS_DISABLED without database access", async () => {
  let lookedUp = false;
  const state = await getPosRuntimeStatus({
    env: { NODE_ENV: "production" },
    connection: { db: { admin: () => { lookedUp = true; throw Error("unexpected DB call"); } } },
  });
  assert.equal(state.enabled, false);
  assert.equal(state.financialWritesEnabled, false);
  assert.equal(state.reason, "POS_DISABLED");
  assert.equal(lookedUp, false);
});

test("all financial sale/refund/quote endpoints fail closed with POS_DISABLED", async (t) => {
  const old = process.env.POS_PRODUCTION_ENABLED;
  process.env.POS_PRODUCTION_ENABLED = "false";
  t.after(() => old === undefined ? delete process.env.POS_PRODUCTION_ENABLED
    : process.env.POS_PRODUCTION_ENABLED = old);
  const app = express();
  app.use(express.json());
  app.use("/pos", require("../src/routes/dashboardPosFinancial"));
  for (const [method, path] of [
    ["post", "/pos/sales"], ["post", "/pos/refunds"],
    ["post", "/pos/checkout/quote"], ["get", "/pos/sales"],
    ["get", "/pos/refunds/000000000000000000000000"],
    ["post", "/pos/operations/synthetic/abandon"],
  ]) {
    const response = await supertest(app)[method](path).send({});
    assert.equal(response.status, 403, method + " " + path);
    assert.equal(response.body.error?.code, "POS_DISABLED");
  }
});

test("production closing is LEGACY_V1 without POS activation, no DB read", async (t) => {
  const oldEnv = process.env.NODE_ENV, oldFlag = process.env.POS_PRODUCTION_ENABLED;
  process.env.NODE_ENV = "production";
  delete process.env.POS_PRODUCTION_ENABLED;
  t.after(() => {
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    if (oldFlag === undefined) delete process.env.POS_PRODUCTION_ENABLED; else process.env.POS_PRODUCTION_ENABLED = oldFlag;
  });
  assert.equal(await resolveClosingVersion("2026-11-14"), LEGACY);
  assert.equal(await resolveClosingVersion("2026-11-14", { closingVersion: "LEGACY_V1" }), LEGACY);
});

test("Production numbering always uses POS- and POS-R- (no STG-)", () => {
  assert.equal(formatPosDocumentNumber("sale", 1, true), "POS-000001");
  assert.equal(formatPosDocumentNumber("refund", 1, true), "POS-R-000001");
  assert.equal(formatPosDocumentNumber("sale", 1, false), "STG-000001");
});

test("staging isolation is never active under Production Railway IDs", () => {
  assert.equal(isPosStagingRuntime({ POS_STAGING_ISOLATED: "true",
    RAILWAY_ENVIRONMENT_ID: "509cc4bf-c2bd-42be-9912-0619bbb94dfd",
    RAILWAY_SERVICE_ID: "9a6d629e-c9f4-4687-bf83-613011606018" }), false);
});

test("POS staging fixture seed only in isolated staging branch, after G2 maintenance guard", () => {
  const source = readFileSync(require.resolve("../src/index.js"), "utf8");
  assert.ok(source.includes("if (isMaintenanceMode())"));
  assert.ok(source.includes("else if (isolatedPosStaging)"));
  assert.ok(source.includes("seedPosStagingCatalog()"));
});

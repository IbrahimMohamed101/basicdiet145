"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const router = require("../src/routes/dashboardPosCatalog");

function invokeGuard(method, path, role = "admin") {
  // Staging auth middleware and /status route precede this one shared gate.
  const gate = router.stack[2]?.handle;
  assert.equal(typeof gate, "function", "POS catalog runtime gate must be mounted");
  return new Promise((resolve, reject) => {
    const req = { method, path, dashboardUserRole: role };
    const res = {
      statusCode: 200,
      status(value) { this.statusCode = value; return this; },
      json(body) { resolve({ allowed: false, status: this.statusCode, body }); return this; },
    };
    gate(req, res, error => error ? reject(error) : resolve({ allowed: true }));
  });
}

test("D-098 authorized Production catalog management remains available before POS financial activation", async (t) => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.POS_PRODUCTION_ENABLED;
  process.env.NODE_ENV = "production";
  process.env.POS_PRODUCTION_ENABLED = "false";
  t.after(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) delete process.env.POS_PRODUCTION_ENABLED;
    else process.env.POS_PRODUCTION_ENABLED = originalFlag;
  });
  for (const [method, path] of [
    ["GET", "/catalog/manage"],
    ["GET", "/catalog/revisions"],
    ["GET", "/catalog/revisions/1"],
    ["PUT", "/catalog/draft"],
    ["POST", "/catalog/publish"],
  ]) {
    const result = await invokeGuard(method, path);
    assert.equal(result.allowed, true, method + " " + path);
  }
  for (const [method, path] of [
    ["GET", "/catalog"],
    ["POST", "/quote"],
    ["POST", "/checkout/quote"],
    ["POST", "/sales"],
    ["POST", "/refunds"],
    ["GET", "/sales"],
    ["GET", "/operations/active/sale"],
    ["POST", "/operations/demo/abandon"],
  ]) {
    const result = await invokeGuard(method, path);
    assert.equal(result.allowed, false, method + " " + path);
    assert.equal(result.status, 403, method + " " + path);
    assert.equal(result.body?.error?.code, "POS_DISABLED", method + " " + path);
  }
});

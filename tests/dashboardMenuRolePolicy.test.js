"use strict";

const assert = require("assert");
const { dashboardMutationRoleMiddleware } = require("../src/middleware/dashboardAuth");

function invoke({ method, role }) {
  let nextCalled = false;
  let statusCode = 200;
  let body = null;
  const req = { method, dashboardUserRole: role };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  dashboardMutationRoleMiddleware(["admin", "superadmin"])(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode, body };
}

for (const method of ["GET", "HEAD", "OPTIONS"]) {
  const result = invoke({ method, role: "kitchen" });
  assert.strictEqual(result.nextCalled, true, `kitchen may use ${method} catalog routes`);
}

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  const result = invoke({ method, role: "kitchen" });
  assert.strictEqual(result.nextCalled, false, `kitchen may not use ${method} catalog routes`);
  assert.strictEqual(result.statusCode, 403);
  assert.strictEqual(result.body.error.code, "FORBIDDEN");
}

for (const role of ["admin", "superadmin"]) {
  const result = invoke({ method: "PATCH", role });
  assert.strictEqual(result.nextCalled, true, `${role} may mutate catalog routes`);
}

console.log("dashboard menu role policy passed");

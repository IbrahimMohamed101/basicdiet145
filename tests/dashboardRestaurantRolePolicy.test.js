"use strict";

const assert = require("assert");
const {
  DASHBOARD_ROLES,
  dashboardRoleHasPermission,
  getEffectiveDashboardRoles,
} = require("../src/constants/dashboardRoles");
const { dashboardRoleMiddleware } = require("../src/middleware/dashboardAuth");
const opsActionPolicy = require("../src/services/dashboard/opsActionPolicy");

function invokeRoleMiddleware(allowedRoles) {
  let nextCalled = false;
  let statusCode = 200;
  let body = null;
  const req = { dashboardUserRole: "restaurant" };
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

  dashboardRoleMiddleware(allowedRoles)(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, statusCode, body };
}

function actionIds(input) {
  return opsActionPolicy.getAllowedActions(input).map((action) => action.id);
}

function run() {
  assert(DASHBOARD_ROLES.includes("restaurant"), "restaurant must be a persisted dashboard role");
  assert.deepStrictEqual(
    getEffectiveDashboardRoles("restaurant"),
    ["restaurant", "kitchen", "cashier"],
    "restaurant inherits kitchen and cashier capabilities"
  );

  assert.strictEqual(dashboardRoleHasPermission("restaurant", ["kitchen"]), true);
  assert.strictEqual(dashboardRoleHasPermission("restaurant", ["cashier"]), true);
  assert.strictEqual(dashboardRoleHasPermission("restaurant", ["restaurant"]), true);
  assert.strictEqual(dashboardRoleHasPermission("restaurant", ["admin"]), false);
  assert.strictEqual(dashboardRoleHasPermission("restaurant", ["courier"]), false);

  for (const allowedRoles of [["kitchen"], ["cashier"], ["restaurant"]]) {
    assert.strictEqual(invokeRoleMiddleware(allowedRoles).nextCalled, true);
  }

  for (const allowedRoles of [["admin"], ["courier"]]) {
    const result = invokeRoleMiddleware(allowedRoles);
    assert.strictEqual(result.nextCalled, false);
    assert.strictEqual(result.statusCode, 403);
    assert.strictEqual(result.body.error.code, "FORBIDDEN");
  }

  assert(
    actionIds({ entityType: "order", status: "confirmed", mode: "pickup", role: "restaurant" })
      .includes("prepare"),
    "restaurant can start kitchen preparation"
  );
  assert(
    actionIds({ entityType: "order", status: "in_preparation", mode: "pickup", role: "restaurant" })
      .includes("ready_for_pickup"),
    "restaurant can mark pickup orders ready"
  );
  assert(
    actionIds({ entityType: "order", status: "ready_for_pickup", mode: "pickup", role: "restaurant" })
      .includes("fulfill"),
    "restaurant can complete branch pickup"
  );
  assert(
    !actionIds({ entityType: "order", status: "out_for_delivery", mode: "delivery", role: "restaurant" })
      .includes("fulfill"),
    "restaurant does not inherit courier delivery completion"
  );
  assert(
    !actionIds({ entityType: "order", status: "confirmed", mode: "pickup", role: "cashier" })
      .includes("prepare"),
    "legacy cashier behavior remains unchanged"
  );

  console.log("dashboard restaurant role policy checks passed");
}

run();

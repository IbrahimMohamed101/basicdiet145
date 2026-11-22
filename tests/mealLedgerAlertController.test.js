"use strict";

process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const service = require("../src/services/subscription/mealLedgerAlertService");
const controller = require("../src/controllers/dashboard/mealLedgerAlertController");
const router = require("../src/routes/dashboardMealLedgerAlerts");
const { dashboardRoleHasPermission } = require("../src/constants/dashboardRoles");

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    req: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

async function main() {
  // Roles: everyone who opens the dashboard on a branch/kitchen/admin role sees
  // alerts; couriers do not. Verifying needs a branch operator or admin.
  const { READ_ROLES, VERIFY_ROLES, SCAN_ROLES } = router.ROLE_POLICY;
  for (const role of ["admin", "restaurant", "cashier", "kitchen"]) {
    assert.equal(dashboardRoleHasPermission(role, READ_ROLES), true, `${role} reads`);
  }
  assert.equal(dashboardRoleHasPermission("courier", READ_ROLES), false);
  for (const role of ["admin", "restaurant", "cashier"]) {
    assert.equal(dashboardRoleHasPermission(role, VERIFY_ROLES), true, `${role} verifies`);
  }
  assert.equal(dashboardRoleHasPermission("kitchen", VERIFY_ROLES), false);
  assert.equal(dashboardRoleHasPermission("courier", VERIFY_ROLES), false);
  assert.equal(dashboardRoleHasPermission("cashier", SCAN_ROLES), false);
  assert.equal(dashboardRoleHasPermission("admin", SCAN_ROLES), true);

  // Routes exist with the expected shape.
  const routes = router.stack.filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`).sort();
  assert.deepEqual(routes, ["GET /", "GET /summary", "POST /:id/acknowledge", "POST /scan"]);

  // Acknowledge: bad id is rejected before the service; actor comes from the token.
  {
    let called = null;
    const original = service.acknowledgeAlert;
    service.acknowledgeAlert = async (args) => { called = args; return { id: args.id, status: "acknowledged" }; };
    const bad = fakeRes();
    await controller.acknowledge({ params: { id: "nope" }, body: { note: "ok ok" } }, bad);
    assert.equal(bad.statusCode, 400);
    assert.equal(called, null);

    const ok = fakeRes();
    await controller.acknowledge({
      params: { id: "0000000000000000000000a1" }, body: { note: "تم التأكد" },
      dashboardUserId: "u1", dashboardUserRole: "cashier",
    }, ok);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual([called.actorId, called.actorRole, called.note], ["u1", "cashier", "تم التأكد"]);
    service.acknowledgeAlert = original;
  }

  // Service errors map to their own status; unknown errors are not swallowed.
  {
    const original = service.acknowledgeAlert;
    service.acknowledgeAlert = async () => { throw new service.MealLedgerAlertError("ALERT_NOT_OPEN", "Alert is not open", 409); };
    const res = fakeRes();
    await controller.acknowledge({ params: { id: "0000000000000000000000a1" }, body: { note: "تم التأكد" } }, res);
    assert.equal(res.statusCode, 409);
    service.acknowledgeAlert = async () => { throw new Error("boom"); };
    await assert.rejects(() => controller.acknowledge({ params: { id: "0000000000000000000000a1" }, body: { note: "تم التأكد" } }, fakeRes()), /boom/);
    service.acknowledgeAlert = original;
  }

  // List defaults to pending alerts and validates the subscription filter.
  {
    const original = service.listAlerts;
    let args = null;
    service.listAlerts = async (a) => { args = a; return { alerts: [], total: 0 }; };
    const res = fakeRes();
    await controller.listAlerts({ query: {} }, res);
    assert.equal(args.status, "pending");
    assert.equal(res.statusCode, 200);
    const bad = fakeRes();
    await controller.listAlerts({ query: { subscriptionId: "x" } }, bad);
    assert.equal(bad.statusCode, 400);
    service.listAlerts = original;
  }

  console.log("mealLedgerAlertController tests passed");
}

main().catch((err) => { console.error(err); process.exit(1); });

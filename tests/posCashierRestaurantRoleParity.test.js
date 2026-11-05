"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const posRouter = require("../src/routes/dashboardPosCatalog");
const { dashboardRoleHasPermission } = require("../src/constants/dashboardRoles");
const { getAllowedActions } = require("../src/services/dashboard/opsActionPolicy");

function testRoleHandler(layer, role) {
  let status = 200;
  let payload = null;
  let authorized = false;
  const req = { dashboardUserRole: role };
  const res = {
    status(code) { status = code; return this; },
    json(body) { payload = body; return this; },
  };
  layer.handle(req, res, () => { authorized = true; });
  return { status, payload, authorized };
}

test("all POS catalog management endpoints accept cashier and restaurant but deny kitchen/courier", () => {
  const paths = [
    ["/catalog/manage", "get"],
    ["/catalog/revisions", "get"],
    ["/catalog/revisions/:revision", "get"],
    ["/catalog/draft", "put"],
    ["/catalog/publish", "post"],
  ];
  for (const [path, method] of paths) {
    const route = posRouter.stack
      .find((layer) => layer.route?.path === path && layer.route?.methods?.[method])
      ?.route;
    assert.ok(route, "route exists: " + method + " " + path);
    // Route's first handler is the real permission middleware. The auth
    // middleware (which verifies live DB identity) is mounted on the router.
    const auth = route.stack[0];
    for (const role of ["cashier", "restaurant", "admin", "superadmin"]) {
      assert.equal(testRoleHandler(auth, role).authorized, true, role + " must access " + path);
    }
    for (const role of ["kitchen", "courier"]) {
      const result = testRoleHandler(auth, role);
      assert.equal(result.authorized, false, role + " must not manage " + path);
      assert.equal(result.status, 403);
      assert.equal(result.payload?.error?.code, "FORBIDDEN");
    }
  }
});

test("cashier equals restaurant for operational authorization but never gains admin privileges", () => {
  for (const allowedRoles of [
    ["restaurant"], ["cashier"], ["kitchen"],
    ["admin", "restaurant"], ["courier", "restaurant"],
    ["admin"], ["superadmin"], ["courier"],
  ]) {
    assert.equal(
      dashboardRoleHasPermission("cashier", allowedRoles),
      dashboardRoleHasPermission("restaurant", allowedRoles),
      "role parity for allowed list " + allowedRoles.join(",")
    );
  }
  assert.equal(dashboardRoleHasPermission("cashier", ["admin"]), false);
  assert.equal(dashboardRoleHasPermission("cashier", ["superadmin"]), false);

  for (const status of ["confirmed", "in_preparation", "ready_for_pickup", "out_for_delivery"]) {
    for (const mode of ["pickup", "delivery"]) {
      assert.deepEqual(
        getAllowedActions({ entityType: "order", status, mode, role: "cashier" }).map((action) => action.id),
        getAllowedActions({ entityType: "order", status, mode, role: "restaurant" }).map((action) => action.id),
      );
    }
  }
});

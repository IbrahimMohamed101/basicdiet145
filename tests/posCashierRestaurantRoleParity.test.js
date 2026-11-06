"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const posRouter = require("../src/routes/dashboardPosCatalog");
const PosCatalog = require("../src/models/PosCatalog");
const fixture = require("../src/services/pos/stagingCatalog.json");
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


test("restaurant and cashier may read the published POS menu and request server quotes", async (t) => {
  // Exercise the actual reader route handlers without connecting to a DB.
  // Dashboard JWT and user-record verification are covered by auth tests.
  const catalog = { publishedRevision: 1, published: fixture };
  const findMock = t.mock.method(PosCatalog, "findById", () => ({
    lean: async () => catalog,
  }));

  async function invoke(path, method, role) {
    const route = posRouter.stack.find((layer) =>
      layer.route?.path === path && layer.route?.methods?.[method])?.route;
    assert.ok(route, "POS route exists: " + method + " " + path);
    const body = { revision: 1, channel: "restaurant",
      items: [{ productId: "water", variantId: "bottle", quantity: 1, addonIds: [] }] };
    const req = { dashboardUserRole: role, body };
    let status = 200;
    let payload = null;
    const res = {
      status(code) { status = code; return this; },
      json(data) { payload = data; return this; },
    };
    await route.stack[0].handle(req, res, (error) => {
      if (error) throw error;
    });
    return { status, payload };
  }

  for (const role of ["cashier", "restaurant", "admin", "superadmin"]) {
    const catalogResponse = await invoke("/catalog", "get", role);
    assert.equal(catalogResponse.status, 200, role + " reads POS catalog");
    assert.equal(catalogResponse.payload?.data?.revision, 1);
    const quoteResponse = await invoke("/quote", "post", role);
    assert.equal(quoteResponse.status, 200, role + " reads POS price quote");
    assert.equal(quoteResponse.payload?.data?.canCommit, false);
    assert.equal(quoteResponse.payload?.data?.provisionalSubtotalHalalas, 300);
  }
  const readCount = findMock.mock.callCount();
  assert.equal(readCount, 8, "only authorized readers reach database");
  for (const role of ["kitchen", "courier"]) {
    for (const [path, method] of [["/catalog", "get"], ["/quote", "post"]]) {
      const denied = await invoke(path, method, role);
      assert.equal(denied.status, 403, role + " cannot read POS " + path);
      assert.equal(denied.payload?.error?.code, "FORBIDDEN");
    }
  }
  assert.equal(findMock.mock.callCount(), readCount, "denied roles do not query catalog");
});

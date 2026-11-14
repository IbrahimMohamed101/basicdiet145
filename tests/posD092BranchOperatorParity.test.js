"use strict";
process.env.NODE_ENV = "test";
process.env.DASHBOARD_JWT_SECRET ||= "isolated-d092-dashboard-jwt";
process.env.JWT_SECRET ||= "isolated-d092-jwt";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createApp } = require("../src/app");
const {
  BRANCH_OPERATOR_ROLES, DASHBOARD_ROLE_INHERITANCE,
  isBranchOperator, dashboardRoleHasPermission,
} = require("../src/constants/dashboardRoles");
const { dashboardRoleMiddleware } = require("../src/middleware/dashboardAuth");
const { getAllowedActions, ACTION_REGISTRY, validateAction } =
  require("../src/services/dashboard/opsActionPolicy");
const { hasPosCapability } = require("../src/services/pos/financialRuntime");

/**
 * D-092: Enumerate the ACTUAL Express Router stack (including all nested
 * routers and mounted /api/dashboard/** and /api/admin/** routes).
 * Retain earlier router.use role guards in route registration order. Evaluate
 * every role-middleware function, not a hand-maintained endpoint allowlist.
 * CI must fail if any registered route authorizes restaurant and cashier
 * differently, including HEAD/GET exemptions on mutation role guards.
 */
function routeTable(stack, parents = [], segments = []) {
  const rows = [];
  const inherited = [...parents];
  for (const layer of stack || []) {
    const guard = layer.handle && layer.handle.d092AllowedRoles ? layer.handle : null;
    const tag = layer.regexp ? String(layer.regexp.source) : "";
    if (layer.route) {
      const routeGuards = (layer.route.stack || [])
        .map(item => item.handle)
        .filter(fn => fn && fn.d092AllowedRoles);
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const entry of routePaths) {
        for (const method of Object.keys(layer.route.methods || {})) {
          rows.push({
            method: method.toUpperCase(), location: [...segments, String(entry)].join(" | "),
            guards: [...inherited, ...routeGuards],
          });
        }
      }
    } else if (layer.handle && Array.isArray(layer.handle.stack)) {
      rows.push(...routeTable(layer.handle.stack,
        [...inherited, ...(guard ? [guard] : [])],
        [...segments, tag]));
    } else if (guard) {
      inherited.push(guard);
    }
  }
  return rows;
}
function roleCanPassGuard(guard, role, method) {
  const req = { dashboardUserRole: role, method };
  let status = null, allowed = false;
  const res = {
    status(code) { status = code; return this; },
    json() { return this; },
    send() { return this; },
  };
  guard(req, res, () => { allowed = true; });
  assert(allowed || status === 403, "unexpected role guard result " + String(status));
  return allowed;
}
function roleCanPass(row, role) {
  return row.guards.every(fn => roleCanPassGuard(fn, role, row.method));
}
test("D-092: identical branch operator inheritance and action/refund permissions", () => {
  assert.deepEqual(BRANCH_OPERATOR_ROLES, ["restaurant", "cashier"]);
  assert.equal(isBranchOperator("restaurant"), true);
  assert.equal(isBranchOperator("cashier"), true);
  assert.equal(isBranchOperator("kitchen"), false);
  assert.deepEqual(DASHBOARD_ROLE_INHERITANCE.cashier, DASHBOARD_ROLE_INHERITANCE.restaurant);
  const rolesToTry = ["superadmin", "admin", "restaurant", "kitchen", "courier", "cashier", "unknown"];
  for (const allowed of rolesToTry) {
    assert.equal(
      dashboardRoleHasPermission("cashier", [allowed]),
      dashboardRoleHasPermission("restaurant", [allowed]), allowed
    );
  }
  for (const capability of ["pos.refund"]) {
    assert.equal(hasPosCapability("cashier", capability), hasPosCapability("restaurant", capability));
  }
  for (const action of Object.keys(ACTION_REGISTRY)) {
    for (const mode of ["pickup", "delivery"]) {
      for (const status of ["open", "confirmed", "ready_for_pickup", "ready_for_delivery", "in_preparation"]) {
        const input = { entityType: "order", status, mode, actionId: action };
        assert.deepEqual(
          validateAction({ ...input, role: "cashier" }),
          validateAction({ ...input, role: "restaurant" }),
          action + "/" + mode + "/" + status
        );
        assert.deepEqual(
          getAllowedActions({ entityType: "order", status, mode, role: "cashier" }),
          getAllowedActions({ entityType: "order", status, mode, role: "restaurant" }),
          action + "/" + mode + "/" + status
        );
      }
    }
  }
});
test("D-092: all Express registered routes have cashier == restaurant authorization", () => {
  const app = createApp();
  const root = app._router || app.router;
  assert(root && Array.isArray(root.stack), "must inspect the real Express router");
  const routes = routeTable(root.stack);
  // POS is intentionally staged only; in CI attach the same actual router
  // manually, instead of enabling POS_STAGING_ISOLATED or any remote database.
  const posRouter = require("../src/routes/dashboardPosCatalog");
  const posRoutes = routeTable(posRouter.stack, [], ["/api/dashboard/pos"]);
  const complete = [...routes, ...posRoutes];
  assert(complete.length > 100, "unexpectedly few registered dashboard routes");
  const dashboardRoutes = complete.filter(r =>
    /dashboard|admin|\/api\/dashboard\/pos/.test(r.location));
  assert(dashboardRoutes.length > 40, "missing dashboard/admin route coverage");
  const protectedRoutes = dashboardRoutes.filter(r => r.guards.length);
  assert(protectedRoutes.length > 20, "missing route-level authorization metadata");
  for (const family of ["dashboard", "admin", "pos", "subscriptions", "daily", "ops", "users"]) {
    assert(dashboardRoutes.some(r => r.location.includes(family)),
      "missing route family: " + family);
  }
  for (const row of dashboardRoutes) {
    assert.equal(roleCanPass(row, "cashier"), roleCanPass(row, "restaurant"),
      row.method + " " + row.location + " diverges for branch operators");
  }
  // Also ensure no route silently ignores a restricted guard. This is the
  // independent policy sanity check, not a substitution for route enumeration.
  const guard = dashboardRoleMiddleware(["cashier"]);
  assert.equal(roleCanPassGuard(guard, "cashier", "POST"), true);
  assert.equal(roleCanPassGuard(guard, "restaurant", "POST"), true);
  assert.equal(roleCanPassGuard(guard, "courier", "POST"), false);
});
test("D-092: unsafe direct role-name permission forks are not reintroduced", () => {
  const roots = [
    "../src/services/dashboard/opsActionPolicy.js",
    "../src/routes/dashboardPosCatalog.js",
    "../src/routes/dashboardPosFinancial.js",
    "../src/controllers/adminController.js",
  ];
  for (const file of roots) {
    const source = fs.readFileSync(path.resolve(__dirname, file), "utf8");
    assert(!/\brole\s*(?:===|!==)\s*["'](?:cashier|restaurant)["']/.test(source),
      file + " must use isBranchOperator");
    assert(!/\breq\.dashboardUserRole\s*(?:===|!==)\s*["'](?:cashier|restaurant)["']/.test(source),
      file + " must use isBranchOperator");
  }
  const controller = fs.readFileSync(
    path.resolve(__dirname, "../src/controllers/adminController.js"), "utf8");
  assert(controller.includes("isBranchOperator(req.dashboardUserRole)"));
  assert(controller.includes('"PAYMENT_REQUIRED"'));
});

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { DASHBOARD_ROLES } = require("../src/constants/dashboardRoles");
const {
  ASSIGNABLE_ROLES,
  LEGACY_STAFF_ROLES,
  STAFF_FILTER_ROLES,
} = require("../src/controllers/dashboardStaffUserController");
require("../src/services/dashboard/installRestaurantOpsPolicy");
const opsActionPolicy = require("../src/services/dashboard/opsActionPolicy");
const {
  assertExecutionAllowed,
  LEGACY_ROLES,
  TARGET_ROLE,
} = require("../scripts/migrate-dashboard-restaurant-role");

function actionIds(input) {
  return opsActionPolicy.getAllowedActions(input).map((action) => action.id);
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function assertContains(source, value, message) {
  assert(source.includes(value), message || `Expected source to contain ${value}`);
}

function run() {
  assert(DASHBOARD_ROLES.includes("restaurant"), "restaurant must be a persisted dashboard role");
  assert(ASSIGNABLE_ROLES.includes("restaurant"), "new operational accounts must use restaurant");
  assert(!ASSIGNABLE_ROLES.includes("kitchen"), "new kitchen accounts must be deprecated");
  assert(!ASSIGNABLE_ROLES.includes("cashier"), "new cashier accounts must be deprecated");
  assert.deepStrictEqual(LEGACY_STAFF_ROLES, ["kitchen", "cashier"]);
  assert(STAFF_FILTER_ROLES.includes("kitchen") && STAFF_FILTER_ROLES.includes("cashier"));

  assert.deepStrictEqual(LEGACY_ROLES, ["kitchen", "cashier"]);
  assert.strictEqual(TARGET_ROLE, "restaurant");
  const previousNodeEnv = process.env.NODE_ENV;
  const previousGuard = process.env.ALLOW_DASHBOARD_ROLE_MIGRATION;
  process.env.NODE_ENV = "production";
  delete process.env.ALLOW_DASHBOARD_ROLE_MIGRATION;
  assert.throws(() => assertExecutionAllowed(true), /Refusing production migration/);
  process.env.ALLOW_DASHBOARD_ROLE_MIGRATION = "true";
  assert.doesNotThrow(() => assertExecutionAllowed(true));
  process.env.NODE_ENV = previousNodeEnv;
  if (previousGuard === undefined) delete process.env.ALLOW_DASHBOARD_ROLE_MIGRATION;
  else process.env.ALLOW_DASHBOARD_ROLE_MIGRATION = previousGuard;

  assert(actionIds({ entityType: "order", status: "confirmed", mode: "pickup", role: "restaurant" }).includes("prepare"));
  assert(actionIds({ entityType: "order", status: "in_preparation", mode: "pickup", role: "restaurant" }).includes("ready_for_pickup"));
  assert(actionIds({ entityType: "order", status: "ready_for_pickup", mode: "pickup", role: "restaurant" }).includes("fulfill"));
  assert(!actionIds({ entityType: "order", status: "out_for_delivery", mode: "delivery", role: "restaurant" }).includes("fulfill"));

  const subscriptionsRoute = read("src/routes/dashboardSubscriptions.js");
  assertContains(
    subscriptionsRoute,
    'dashboardRoleMiddleware(["admin", "restaurant", "cashier"]),\n  asyncHandler(controller.manualDeduction)',
    "restaurant must be allowed to perform manual deduction"
  );
  assertContains(
    subscriptionsRoute,
    'dashboardRoleMiddleware(["admin", "cashier"]),\n  asyncHandler(subscriptionCreationController.createSubscriptionAdmin)',
    "restaurant must not be allowed to create subscriptions"
  );
  assertContains(
    subscriptionsRoute,
    'dashboardRoleMiddleware(["admin", "cashier"]),\n  asyncHandler(subscriptionCreationController.quoteSubscriptionAdmin)',
    "restaurant must not be allowed to quote subscriptions"
  );

  const restaurantReadRoute = read("src/routes/dashboardRestaurantRead.js");
  assertContains(restaurantReadRoute, 'router.get("/users"');
  assertContains(restaurantReadRoute, 'router.get("/addons"');
  assert(!/router\.(post|put|patch|delete)\(/.test(restaurantReadRoute), "restaurant compatibility router must remain read-only");

  const menuRoute = read("src/routes/dashboardMenu.js");
  assertContains(menuRoute, 'dashboardMutationRoleMiddleware(["admin", "superadmin"])');
  const mealBuilderRoute = read("src/routes/dashboardMealBuilder.js");
  assertContains(mealBuilderRoute, 'const authorRoles = dashboardRoleMiddleware(["admin", "superadmin"])');

  console.log("dashboard restaurant role policy checks passed");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}

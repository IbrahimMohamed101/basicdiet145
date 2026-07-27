"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ignoreDashboardCustomerEmail = require("../src/middleware/ignoreDashboardCustomerEmail");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function assertIncludes(source, expected, label) {
  assert(
    source.includes(expected),
    `${label}: expected source to include ${JSON.stringify(expected)}`
  );
}

function assertNotIncludes(source, expected, label) {
  assert(
    !source.includes(expected),
    `${label}: expected source not to include ${JSON.stringify(expected)}`
  );
}

function run() {
  const routeIndex = read("src/routes/index.js");
  const capabilities = read("src/routes/dashboardRestaurantCapabilities.js");
  const dashboardMenu = read("src/routes/dashboardMenu.js");
  const mealPlanner = read("src/routes/adminMealPlannerMenu.routes.js");
  const mealBuilder = read("src/routes/dashboardMealBuilder.js");
  const catalogItems = read("src/routes/dashboardCatalogItems.js");
  const premiumUpgrades = read("src/routes/dashboardPremiumUpgrades.js");
  const menuIdentity = read("src/routes/dashboardMenuIdentity.js");
  const courier = read("src/routes/courier.js");
  const boards = read("src/routes/dashboardBoards.js");
  const dashboardSubscriptions = read("src/routes/dashboardSubscriptions.js");
  const manualDeductionError = read(
    "src/services/dashboard/manualDeduction/ManualDeductionError.js"
  );

  assertIncludes(
    capabilities,
    'dashboardRoleMiddleware(["admin", "restaurant", "kitchen"])',
    "restaurant and kitchen customer creation authorization"
  );
  assertIncludes(
    capabilities,
    'router.post(\n  "/users",',
    "restaurant customer creation endpoint"
  );
  assertIncludes(
    capabilities,
    'const ignoreDashboardCustomerEmail = require("../middleware/ignoreDashboardCustomerEmail")',
    "dashboard customer email optionality middleware import"
  );
  assertIncludes(
    capabilities,
    "ignoreDashboardCustomerEmail,\n  asyncHandler(adminController.createAppUserAdmin)",
    "dashboard customer email must be ignored before creation"
  );
  assertIncludes(
    capabilities,
    "asyncHandler(adminController.createAppUserAdmin)",
    "restaurant customer creation handler"
  );
  assertIncludes(
    capabilities,
    '"cashier",\n  "restaurant",\n  "kitchen",',
    "subscription staff read roles"
  );
  for (const [pathFragment, label] of [
    ['"/settings"', "subscription settings read"],
    ['"/zones"', "subscription zones read"],
    ['"/builder-premium-meals"', "subscription premium meals read"],
    ['"/users/:id"', "subscription customer detail read"],
  ]) {
    assertIncludes(capabilities, pathFragment, label);
  }
  assertNotIncludes(
    capabilities,
    "router.use(\n  dashboardAuthMiddleware",
    "scoped capability router must not block unrelated dashboard routes"
  );

  const originalCreateBody = {
    fullName: "Mohamed Mahmoud",
    phone: "+966501234533",
    email: "test@gmail.com",
    emailAddress: "default@example.com",
    temporaryPassword: "Test12345",
    isActive: true,
  };
  const request = { body: originalCreateBody };
  let nextCalled = false;
  ignoreDashboardCustomerEmail(request, {}, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true, "customer email middleware must continue the request");
  assert.strictEqual(request.body.phone, originalCreateBody.phone, "phone must remain authoritative");
  assert.strictEqual(
    request.body.temporaryPassword,
    originalCreateBody.temporaryPassword,
    "temporary password must be preserved"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(request.body, "email"),
    false,
    "email must not reach the create-user controller"
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(request.body, "emailAddress"),
    false,
    "email aliases must not reach the create-user controller"
  );
  assert.strictEqual(
    originalCreateBody.email,
    "test@gmail.com",
    "middleware must not mutate the caller's original object"
  );

  const scopedMount = routeIndex.indexOf('router.use("/dashboard", dashboardRestaurantCapabilitiesRoutes)');
  const broadAdminMount = routeIndex.indexOf('router.use("/dashboard", adminRoutes)');
  assert(scopedMount >= 0, "scoped restaurant capability router must be mounted");
  assert(broadAdminMount >= 0, "admin router must remain mounted");
  assert(
    scopedMount < broadAdminMount,
    "scoped restaurant capability router must run before the broad admin-only router"
  );

  for (const [label, source] of [
    ["dashboard menu", dashboardMenu],
    ["meal builder", mealBuilder],
    ["catalog items", catalogItems],
    ["premium upgrades", premiumUpgrades],
  ]) {
    assertIncludes(source, '"restaurant"', `${label} restaurant permission`);
  }
  assertIncludes(
    mealPlanner,
    'dashboardRoleMiddleware(["admin", "restaurant"])',
    "meal planner restaurant permission"
  );
  assertIncludes(
    menuIdentity,
    'dashboardRoleMiddleware(["admin", "restaurant"])',
    "menu identity restaurant permission"
  );

  assertIncludes(
    courier,
    'const courierReadAccess = dashboardRoleMiddleware(["courier", "admin", "restaurant"])',
    "courier read access"
  );
  assertIncludes(
    courier,
    'const courierMutationAccess = dashboardRoleMiddleware(["courier", "admin"])',
    "courier mutation access"
  );
  assertNotIncludes(
    courier,
    'const courierMutationAccess = dashboardRoleMiddleware(["courier", "admin", "restaurant"])',
    "restaurant must not mutate courier state"
  );
  assertIncludes(
    courier,
    "function restaurantCourierReadOnlyResponse",
    "restaurant courier response sanitizer"
  );
  assertIncludes(courier, "allowedActions: []", "restaurant courier actions must be hidden");
  assertIncludes(
    courier,
    "allowedActionIds: []",
    "restaurant courier action ids must be hidden"
  );
  assertIncludes(
    courier,
    "restaurantCourierReadOnlyResponse,\n  asyncHandler(controller.listTodayDeliveries)",
    "subscription delivery list must be read-only for restaurant"
  );
  assertIncludes(
    courier,
    "restaurantCourierReadOnlyResponse,\n  asyncHandler(orderController.listTodayOrders)",
    "one-time delivery list must be read-only for restaurant"
  );
  assertIncludes(
    boards,
    'dashboardRoleMiddleware(["admin", "courier", "restaurant"])',
    "delivery schedule restaurant read access"
  );

  assertIncludes(
    dashboardSubscriptions,
    'const subscriptionStaffAccess = dashboardRoleMiddleware([',
    "shared subscription staff authorization"
  );
  assertIncludes(
    dashboardSubscriptions,
    '"restaurant",\n  "kitchen",',
    "restaurant and legacy kitchen subscription access"
  );
  assertIncludes(
    dashboardSubscriptions,
    '"/:subscriptionId/manual-deduction"',
    "manual deduction endpoint must remain mounted"
  );
  assertIncludes(
    manualDeductionError,
    '["admin", "superadmin", "cashier", "restaurant", "kitchen"]',
    "manual deduction service must authorize restaurant and kitchen"
  );

  console.log("dashboard restaurant expanded capability policy checks passed");
}

run();

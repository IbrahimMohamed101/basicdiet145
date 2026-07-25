"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

  assertIncludes(
    capabilities,
    'dashboardRoleMiddleware(["admin", "restaurant"])',
    "restaurant customer creation authorization"
  );
  assertIncludes(
    capabilities,
    'router.post("/users", asyncHandler(adminController.createAppUserAdmin))',
    "restaurant customer creation endpoint"
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
    boards,
    'dashboardRoleMiddleware(["admin", "courier", "restaurant"])',
    "delivery schedule restaurant read access"
  );

  console.log("dashboard restaurant expanded capability policy checks passed");
}

run();

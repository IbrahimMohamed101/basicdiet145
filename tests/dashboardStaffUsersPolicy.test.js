process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const {
  ASSIGNABLE_ROLES,
  LEGACY_STAFF_ROLES,
  STAFF_FILTER_ROLES,
} = require("../src/controllers/dashboardStaffUserController");
const { DASHBOARD_ROLES } = require("../src/constants/dashboardRoles");

function run() {
  assert.deepStrictEqual(
    ASSIGNABLE_ROLES,
    ["admin", "restaurant", "courier"],
    "new operational accounts use the unified restaurant role"
  );
  assert.deepStrictEqual(
    LEGACY_STAFF_ROLES,
    ["kitchen", "cashier"],
    "legacy roles remain readable during migration"
  );
  assert(STAFF_FILTER_ROLES.includes("kitchen"), "legacy kitchen accounts remain filterable");
  assert(STAFF_FILTER_ROLES.includes("cashier"), "legacy cashier accounts remain filterable");
  assert(DASHBOARD_ROLES.includes("restaurant"), "restaurant is a valid authentication role");
  assert(DASHBOARD_ROLES.includes("superadmin"), "superadmin remains a valid authentication role");
  assert(!ASSIGNABLE_ROLES.includes("superadmin"), "API cannot create another superadmin");
  assert(!ASSIGNABLE_ROLES.includes("kitchen"), "new kitchen-only accounts are deprecated");
  assert(!ASSIGNABLE_ROLES.includes("cashier"), "new cashier-only accounts are deprecated");
  assert(!ASSIGNABLE_ROLES.includes("client"), "dashboard API cannot create mobile clients");
  console.log("dashboard staff user role policy checks passed");
}

run();

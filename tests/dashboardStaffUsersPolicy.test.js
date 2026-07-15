process.env.NODE_ENV = process.env.NODE_ENV || "test";

const assert = require("assert");
const {
  ASSIGNABLE_ROLES,
} = require("../src/controllers/dashboardStaffUserController");
const { DASHBOARD_ROLES } = require("../src/constants/dashboardRoles");

function run() {
  assert.deepStrictEqual(
    ASSIGNABLE_ROLES,
    ["admin", "kitchen", "courier", "cashier"],
    "only operational dashboard roles are assignable"
  );
  assert(DASHBOARD_ROLES.includes("superadmin"), "superadmin remains a valid authentication role");
  assert(!ASSIGNABLE_ROLES.includes("superadmin"), "API cannot create another superadmin");
  assert(!ASSIGNABLE_ROLES.includes("client"), "dashboard API cannot create mobile clients");
  console.log("dashboard staff user role policy checks passed");
}

run();

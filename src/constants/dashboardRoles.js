const DASHBOARD_ROLES = Object.freeze([
  "superadmin",
  "admin",
  "restaurant",
  "kitchen",
  "courier",
  "cashier",
]);

const DASHBOARD_ROLE_LABEL = DASHBOARD_ROLES.join(", ");

function normalizeDashboardRole(role) {
  return String(role || "").trim().toLowerCase();
}

module.exports = {
  DASHBOARD_ROLES,
  DASHBOARD_ROLE_LABEL,
  normalizeDashboardRole,
};

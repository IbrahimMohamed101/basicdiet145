const DASHBOARD_ROLES = Object.freeze([
  "superadmin",
  "admin",
  "restaurant",
  "kitchen",
  "courier",
  "cashier",
]);

// D-092: branch operators are one operational principal, but their original
// role remains unchanged in JWT, dashboard state and audit events.
const BRANCH_OPERATOR_ROLES = Object.freeze(["restaurant", "cashier"]);
const BRANCH_OPERATOR_INHERITANCE = Object.freeze(["restaurant", "kitchen", "cashier"]);
const DASHBOARD_ROLE_INHERITANCE = Object.freeze(
  Object.fromEntries(BRANCH_OPERATOR_ROLES.map((role) => [role, BRANCH_OPERATOR_INHERITANCE]))
);
function isBranchOperator(role) {
  return BRANCH_OPERATOR_ROLES.includes(normalizeDashboardRole(role));
}

function normalizeDashboardRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getEffectiveDashboardRoles(role) {
  const normalized = normalizeDashboardRole(role);
  if (!normalized) return [];
  return DASHBOARD_ROLE_INHERITANCE[normalized] || [normalized];
}

function dashboardRoleHasPermission(role, allowedRoles = []) {
  const allowed = new Set(
    (Array.isArray(allowedRoles) ? allowedRoles : [])
      .map(normalizeDashboardRole)
      .filter(Boolean)
  );

  return getEffectiveDashboardRoles(role).some((effectiveRole) => allowed.has(effectiveRole));
}

const DASHBOARD_ROLE_LABEL = DASHBOARD_ROLES.join(", ");

module.exports = {
  DASHBOARD_ROLES,
  BRANCH_OPERATOR_ROLES,
  isBranchOperator,
  DASHBOARD_ROLE_INHERITANCE,
  DASHBOARD_ROLE_LABEL,
  dashboardRoleHasPermission,
  getEffectiveDashboardRoles,
  normalizeDashboardRole,
};

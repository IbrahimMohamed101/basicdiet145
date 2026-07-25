const DASHBOARD_ROLES = Object.freeze([
  "superadmin",
  "admin",
  "restaurant",
  "kitchen",
  "courier",
  "cashier",
]);

const DASHBOARD_ROLE_INHERITANCE = Object.freeze({
  restaurant: Object.freeze(["restaurant", "kitchen", "cashier"]),
});

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
  DASHBOARD_ROLE_INHERITANCE,
  DASHBOARD_ROLE_LABEL,
  dashboardRoleHasPermission,
  getEffectiveDashboardRoles,
  normalizeDashboardRole,
};

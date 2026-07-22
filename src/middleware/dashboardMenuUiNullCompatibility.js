"use strict";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDashboardMenuUiNullBody(body) {
  if (!isPlainObject(body) || body.ui !== null) return body;
  const normalized = { ...body };
  delete normalized.ui;
  return normalized;
}

function dashboardMenuUiNullCompatibility(req, _res, next) {
  if (["POST", "PUT", "PATCH"].includes(String(req.method || "").toUpperCase())) {
    req.body = normalizeDashboardMenuUiNullBody(req.body);
  }
  next();
}

module.exports = {
  dashboardMenuUiNullCompatibility,
  normalizeDashboardMenuUiNullBody,
};

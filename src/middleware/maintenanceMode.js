"use strict";

const errorResponse = require("../utils/errorResponse");

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MESSAGE_AR = "الخدمة تحت الصيانة مؤقتًا. يرجى إعادة المحاولة لاحقًا.";

function isMaintenanceMode(env = process.env) {
  return env.MAINTENANCE_MODE === "true";
}

// Deliberately global: Moyasar webhooks and any write routes mounted outside
// /api must also fail with 503 so they are not accidentally acknowledged.
function maintenanceWriteGuard(req, res, next) {
  if (!isMaintenanceMode() || !MUTATION_METHODS.has(req.method)) return next();
  // Moyasar should retry a failed delivery. Never send 2xx during maintenance.
  res.set("Retry-After", "300");
  return errorResponse(res, 503, "MAINTENANCE", MESSAGE_AR);
}

module.exports = { isMaintenanceMode, maintenanceWriteGuard, MUTATION_METHODS };

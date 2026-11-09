"use strict";

const errorResponse = require("../utils/errorResponse");

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// These GET routes call synchronizePaymentForRedirect and can settle payments.
// They cannot remain writable during a true database freeze.
const SETTLEMENT_GETS = new Set(["/api/payments/verify", "/payments/success", "/payment-success"]);
const MESSAGE_AR = "الخدمة تحت الصيانة مؤقتًا. يرجى إعادة المحاولة لاحقًا.";

function isMaintenanceMode(env = process.env) {
  return env.MAINTENANCE_MODE === "true";
}

// Deliberately global: Moyasar webhooks and any write routes mounted outside
// /api must also fail with 503 so they are not accidentally acknowledged.
function maintenanceWriteGuard(req, res, next) {
  const isSettlementGet = req.method === "GET" && SETTLEMENT_GETS.has(req.path);
  if (!isMaintenanceMode() || (!MUTATION_METHODS.has(req.method) && !isSettlementGet)) return next();
  // Moyasar should retry a failed delivery. Never send 2xx during maintenance.
  res.set("Retry-After", "300");
  return errorResponse(res, 503, "MAINTENANCE", MESSAGE_AR);
}

module.exports = { isMaintenanceMode, maintenanceWriteGuard, MUTATION_METHODS, SETTLEMENT_GETS };

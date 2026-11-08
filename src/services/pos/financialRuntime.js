"use strict";
const mongoose = require("mongoose");
const { isPosStagingRuntime } = require("../../utils/posStagingRuntime");
const { PosFinancialError } = require("./financialQuoteService");
const { dashboardRoleHasPermission } = require("../../constants/dashboardRoles");
const STAGING_DB = "basicdiet_pos_staging_test";
function requireFinancialStagingWrites(options = {}) {
  if (options.testOnly === true && process.env.NODE_ENV === "test"
    && process.env.MONGO_URI_TEST?.includes("127.0.0.1")
    && mongoose.connection.name?.endsWith("_ci_test")) return;
  if (!isPosStagingRuntime() || process.env.POS_STAGE_F_WRITES_ENABLED !== "true"
    || mongoose.connection.name !== STAGING_DB
    || !mongoose.connection.host?.includes("mongodb-qxhu.railway.internal")) {
    throw new PosFinancialError("POS_STAGING_ONLY",
      "دورة البيع والمرتجع متاحة على Staging المعزول فقط بعد تفعيل اختبارات الأمان.", 403);
  }
}
const DEFAULT_REFUND_ROLES = ["cashier", "restaurant", "admin", "superadmin"];
function hasPosCapability(role, capability, env = process.env) {
  if (capability !== "pos.refund") return false;
  // An explicit empty value revokes every role without changing code.
  const roles = env.POS_REFUND_ROLES === undefined ? DEFAULT_REFUND_ROLES
    : String(env.POS_REFUND_ROLES).split(",").map(s => s.trim()).filter(Boolean);
  return roles.some(allowed => dashboardRoleHasPermission(role, [allowed]));
}
module.exports = { requireFinancialStagingWrites, hasPosCapability };

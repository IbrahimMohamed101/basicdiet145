"use strict";
const mongoose = require("mongoose");
const { isPosStagingRuntime } = require("../../utils/posStagingRuntime");
const { PosFinancialError } = require("./financialQuoteService");
const { dashboardRoleHasPermission } = require("../../constants/dashboardRoles");
const STAGING_DB = "basicdiet_pos_staging_test";
const PROD_DB = "test";
const PROD_HOST = "mongodb.railway.internal";

// D-097: server-side switch only. The UI cannot authorize POS by a VITE variable.
async function getPosRuntimeStatus() {
  if (isPosStagingRuntime()) {
    const isolated = mongoose.connection.name === STAGING_DB &&
      mongoose.connection.host === "mongodb-qxhu.railway.internal";
    return { enabled: isolated, environment: "staging", financialWritesEnabled:
      isolated && process.env.POS_STAGE_F_WRITES_ENABLED === "true", documentType: "STAGING_TEST_NON_TAX" };
  }
  if (process.env.POS_PRODUCTION_ENABLED !== "true") {
    return { enabled: false, environment: "production", financialWritesEnabled: false, reason: "POS_DISABLED" };
  }
  if (process.env.NODE_ENV !== "production" || mongoose.connection.readyState !== 1 ||
      mongoose.connection.name !== PROD_DB || mongoose.connection.host !== PROD_HOST) {
    return { enabled: false, environment: "production", financialWritesEnabled: false, reason: "POS_DISABLED" };
  }
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (hello.setName !== "rs0" || hello.isWritablePrimary !== true) {
      return { enabled: false, environment: "production", financialWritesEnabled: false, reason: "POS_DISABLED" };
    }
  } catch {
    return { enabled: false, environment: "production", financialWritesEnabled: false, reason: "POS_DISABLED" };
  }
  return { enabled: true, environment: "production", financialWritesEnabled: true,
    documentType: "SIMPLIFIED_TAX_INVOICE" };
}

async function requireFinancialStagingWrites(options = {}) {
  if (options.testOnly === true && process.env.NODE_ENV === "test"
    && process.env.MONGO_URI_TEST?.includes("127.0.0.1")
    && mongoose.connection.name?.endsWith("_ci_test")) return;
  const state = await getPosRuntimeStatus();
  if (state.financialWritesEnabled) return;
  if (state.environment === "staging") {
    throw new PosFinancialError("POS_STAGING_ONLY",
      "دورة البيع والمرتجع متاحة على Staging المعزول بعد تفعيل اختبارات الأمان.", 403);
  }
  throw new PosFinancialError("POS_DISABLED", "نقطة البيع على Production غير مفعلة أو قاعدة البيانات ليست PRIMARY rs0.", 403);
}
const DEFAULT_REFUND_ROLES = ["cashier", "restaurant", "admin", "superadmin"];
function hasPosCapability(role, capability, env = process.env) {
  if (capability !== "pos.refund") return false;
  const roles = env.POS_REFUND_ROLES === undefined ? DEFAULT_REFUND_ROLES
    : String(env.POS_REFUND_ROLES).split(",").map(s => s.trim()).filter(Boolean);
  return roles.some(allowed => dashboardRoleHasPermission(role, [allowed]));
}
module.exports = { getPosRuntimeStatus, requireFinancialStagingWrites, hasPosCapability };

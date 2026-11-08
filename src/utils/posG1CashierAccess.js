"use strict";
const { isPosStagingRuntime } = require("./posStagingRuntime");

// Only the isolated POS Stage G test database grants cashier creation of
// synthetic app accounts through the already existing /admin/users controller.
function canPosStagingCashierCreateUser(env = process.env, dbName = "") {
  return isPosStagingRuntime(env) && dbName === "basicdiet_pos_staging_test";
}
module.exports = { canPosStagingCashierCreateUser };

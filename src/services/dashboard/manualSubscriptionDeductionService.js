"use strict";

const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { MANUAL_DEDUCTION_ACTION } = require("./manualDeduction/constants");
const { ManualDeductionError, assertCashierOrAdminRole } = require("./manualDeduction/ManualDeductionError");
const { resolveBalances } = require("./manualDeduction/manualDeductionPolicy");
const { serializeManualDeductionLog } = require("./manualDeduction/manualDeductionPresenter");
const manualDeductionRepository = require("./manualDeduction/manualDeductionRepository");
const { createManualDeductionSearchService } = require("./manualDeduction/manualDeductionSearchService");
const { createManualDeductionCommandService } = require("./manualDeduction/manualDeductionCommandService");

const { searchByPhone } = createManualDeductionSearchService({
  repository: manualDeductionRepository,
  getBusinessDate: getRestaurantBusinessDate,
});
const { manualDeduction } = createManualDeductionCommandService({
  repository: manualDeductionRepository,
  getBusinessDate: getRestaurantBusinessDate,
  runTransactionWithRetry: runMongoTransactionWithRetry,
});

async function listManualDeductions({ subscriptionId, role, limit = 50 }) {
  assertCashierOrAdminRole(role);
  if (!manualDeductionRepository.isValidObjectId(subscriptionId)) {
    throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
  }

  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const logs = await manualDeductionRepository.listManualDeductionLogs(subscriptionId, cappedLimit);

  return {
    contractVersion: "dashboard_manual_deductions.v1",
    subscriptionId: String(subscriptionId),
    count: logs.length,
    items: logs.map(serializeManualDeductionLog),
  };
}

module.exports = {
  MANUAL_DEDUCTION_ACTION,
  ManualDeductionError,
  listManualDeductions,
  resolveBalances,
  searchByPhone,
  manualDeduction,
  serializeManualDeductionLog,
};

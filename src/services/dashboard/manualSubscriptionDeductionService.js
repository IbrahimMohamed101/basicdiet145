"use strict";

const { getRestaurantBusinessDate } = require("../restaurantHoursService");
const { runMongoTransactionWithRetry } = require("../mongoTransactionRetryService");
const { MANUAL_DEDUCTION_ACTION } = require("./manualDeduction/constants");
const { ManualDeductionError } = require("./manualDeduction/ManualDeductionError");
const { resolveBalances } = require("./manualDeduction/manualDeductionPolicy");
const { serializeManualDeductionLog } = require("./manualDeduction/manualDeductionPresenter");
const manualDeductionRepository = require("./manualDeduction/manualDeductionRepository");
const { createManualDeductionSearchService } = require("./manualDeduction/manualDeductionSearchService");
const { createManualDeductionCommandService } = require("./manualDeduction/manualDeductionCommandService");
const { createManualDeductionHistoryService } = require("./manualDeduction/manualDeductionHistoryService");

const { searchByPhone } = createManualDeductionSearchService({
  repository: manualDeductionRepository,
  getBusinessDate: getRestaurantBusinessDate,
});
const { manualDeduction } = createManualDeductionCommandService({
  repository: manualDeductionRepository,
  getBusinessDate: getRestaurantBusinessDate,
  runTransactionWithRetry: runMongoTransactionWithRetry,
});
const { listManualDeductions } = createManualDeductionHistoryService({
  repository: manualDeductionRepository,
});

module.exports = {
  MANUAL_DEDUCTION_ACTION,
  ManualDeductionError,
  listManualDeductions,
  resolveBalances,
  searchByPhone,
  manualDeduction,
  serializeManualDeductionLog,
};

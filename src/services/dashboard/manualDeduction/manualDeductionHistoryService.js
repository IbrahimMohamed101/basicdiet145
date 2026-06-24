"use strict";

const { ManualDeductionError, assertCashierOrAdminRole } = require("./ManualDeductionError");
const { serializeManualDeductionLog } = require("./manualDeductionPresenter");

function createManualDeductionHistoryService({ repository }) {
  async function listManualDeductions({ subscriptionId, role, limit = 50 }) {
    assertCashierOrAdminRole(role);
    if (!repository.isValidObjectId(subscriptionId)) {
      throw new ManualDeductionError("SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
    }

    const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const logs = await repository.listManualDeductionLogs(subscriptionId, cappedLimit);

    return {
      contractVersion: "dashboard_manual_deductions.v1",
      subscriptionId: String(subscriptionId),
      count: logs.length,
      items: logs.map(serializeManualDeductionLog),
    };
  }

  return { listManualDeductions };
}

module.exports = { createManualDeductionHistoryService };

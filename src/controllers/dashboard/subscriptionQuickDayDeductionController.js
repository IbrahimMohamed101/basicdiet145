"use strict";

const errorResponse = require("../../utils/errorResponse");
const quickDayDeductionService = require("../../services/dashboard/subscriptionQuickDayDeductionService");

function handleError(res, error) {
  if (error instanceof quickDayDeductionService.QuickDayDeductionError) {
    return errorResponse(res, error.status, error.code, error.message, error.details);
  }
  throw error;
}

async function listOptions(req, res) {
  try {
    const data = await quickDayDeductionService.listOptions({
      subscriptionId: req.params.subscriptionId,
      role: req.dashboardUserRole || req.userRole,
    });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deduct(req, res) {
  try {
    const data = await quickDayDeductionService.deduct({
      subscriptionId: req.params.subscriptionId,
      batchId: req.body && req.body.batchId,
      days: req.body && req.body.days,
      idempotencyKey: req.get("Idempotency-Key"),
      actorId: req.dashboardUserId || req.userId,
      actorRole: req.dashboardUserRole || req.userRole,
    });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  deduct,
  listOptions,
};

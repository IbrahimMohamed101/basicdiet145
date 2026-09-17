"use strict";

const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");
const manualDeductionService = require("../../services/dashboard/manualSubscriptionDeductionService");

function handleManualDeductionError(res, err) {
  if (err instanceof manualDeductionService.ManualDeductionError) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  throw err;
}

async function searchByPhone(req, res) {
  try {
    const data = await manualDeductionService.searchByPhone({
      phone: req.query.phone,
      role: req.dashboardUserRole,
      lang: getRequestLang(req),
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return handleManualDeductionError(res, err);
  }
}

async function manualDeduction(req, res) {
  try {
    const data = await manualDeductionService.manualDeduction({
      subscriptionId: req.params.subscriptionId,
      body: req.body || {},
      actorId: req.dashboardUserId || req.userId,
      actorRole: req.dashboardUserRole || req.userRole,
      idempotencyKey: req.get("Idempotency-Key") || "",
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return handleManualDeductionError(res, err);
  }
}

async function listManualDeductions(req, res) {
  try {
    const data = await manualDeductionService.listManualDeductions({
      subscriptionId: req.params.subscriptionId,
      role: req.dashboardUserRole || req.userRole,
      limit: req.query.limit,
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return handleManualDeductionError(res, err);
  }
}

module.exports = {
  listManualDeductions,
  searchByPhone,
  manualDeduction,
};

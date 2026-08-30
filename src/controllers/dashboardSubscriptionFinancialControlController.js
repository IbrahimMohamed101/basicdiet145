"use strict";

const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const {
  executeFinancialControl,
  getFinancialControlPreview,
  settleRecordedRefund,
} = require("../services/dashboard/subscriptionFinancialControlNoTxnService");

function respondWithError(res, error, context) {
  if (error && Number.isInteger(error.status) && error.code) {
    return errorResponse(res, error.status, error.code, error.message);
  }
  logger.error("dashboard subscription financial control failed", {
    error: error && error.message,
    stack: error && error.stack,
    ...context,
  });
  return errorResponse(res, 500, "INTERNAL", "Subscription financial control failed");
}

function requestContext(req) {
  return {
    customerId: req.params.id || null,
    subscriptionId: req.params.subscriptionId,
  };
}

async function preview(req, res) {
  const context = requestContext(req);
  try {
    const data = await getFinancialControlPreview(context);
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return respondWithError(res, error, {
      ...context,
      action: "financial_control_preview",
    });
  }
}

async function execute(req, res) {
  const context = requestContext(req);
  try {
    const result = await executeFinancialControl({
      ...context,
      payload: req.body || {},
      actorId: req.dashboardUserId,
      actorRole: req.dashboardUserRole,
      requestMeta: {
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
      lang: req.lang || "ar",
    });
    return res.status(result.replayed ? 200 : 201).json({
      status: true,
      message: result.replayed ? "Operation already processed" : "Operation completed successfully",
      messageAr: result.replayed ? "تم تنفيذ العملية مسبقًا" : "تم تنفيذ العملية بنجاح",
      data: result.operation,
      meta: { replayed: result.replayed, accountingOnly: true, moneyMovementPerformed: false },
    });
  } catch (error) {
    logger.warn("dashboard subscription financial control request failed", {
      code: error && error.code,
      message: error && error.message,
      operationKey: error && error.extra && error.extra.operationKey,
      ...context,
    });
    return respondWithError(res, error, {
      ...context,
      action: "financial_control_execute",
    });
  }
}

async function settle(req, res) {
  try {
    const result = await settleRecordedRefund({
      subscriptionId: req.params.subscriptionId,
      refundId: req.params.refundId,
      payload: req.body || {},
      actorId: req.dashboardUserId,
      actorRole: req.dashboardUserRole,
    });
    return res.status(200).json({
      status: true,
      message: result.replayed ? "Refund was already settled" : "Refund settlement confirmed",
      messageAr: result.replayed ? "تم تأكيد تسوية الاسترجاع مسبقًا" : "تم تأكيد تسوية الاسترجاع",
      data: result.refund,
      meta: { replayed: result.replayed, moneyMovementPerformed: false },
    });
  } catch (error) {
    return respondWithError(res, error, {
      subscriptionId: req.params.subscriptionId,
      refundId: req.params.refundId,
      action: "refund_settlement_confirm",
    });
  }
}

module.exports = { execute, preview, settle };

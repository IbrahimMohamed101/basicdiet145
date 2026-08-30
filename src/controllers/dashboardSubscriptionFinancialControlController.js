"use strict";

const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const {
  executeFinancialControl,
  getFinancialControlPreview,
} = require("../services/dashboard/subscriptionFinancialControlService");

function respondWithError(res, error, context) {
  if (error && Number.isInteger(error.status) && error.code) {
    const response = errorResponse(res, error.status, error.code, error.message);
    return response;
  }
  logger.error("dashboard subscription financial control failed", {
    error: error && error.message,
    stack: error && error.stack,
    ...context,
  });
  return errorResponse(res, 500, "INTERNAL", "Subscription financial control failed");
}

async function preview(req, res) {
  try {
    const data = await getFinancialControlPreview({
      customerId: req.params.id,
      subscriptionId: req.params.subscriptionId,
    });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return respondWithError(res, error, {
      customerId: req.params.id,
      subscriptionId: req.params.subscriptionId,
      action: "financial_control_preview",
    });
  }
}

async function execute(req, res) {
  try {
    const result = await executeFinancialControl({
      customerId: req.params.id,
      subscriptionId: req.params.subscriptionId,
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
      meta: { replayed: result.replayed },
    });
  } catch (error) {
    logger.warn("dashboard subscription financial control request failed", {
      code: error && error.code,
      message: error && error.message,
      operationKey: error && error.extra && error.extra.operationKey,
      customerId: req.params.id,
      subscriptionId: req.params.subscriptionId,
    });
    return respondWithError(res, error, {
      customerId: req.params.id,
      subscriptionId: req.params.subscriptionId,
      action: "financial_control_execute",
    });
  }
}

module.exports = { execute, preview };

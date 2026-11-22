"use strict";

const mongoose = require("mongoose");
const errorResponse = require("../../utils/errorResponse");
const service = require("../../services/subscription/mealLedgerAlertService");

function handleError(res, error) {
  if (error instanceof service.MealLedgerAlertError) {
    return errorResponse(res, error.status, error.code, error.message);
  }
  throw error;
}

async function getSummary(req, res) {
  try {
    return res.status(200).json({ status: true, data: await service.getAlertSummary() });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listAlerts(req, res) {
  try {
    const { status, severity, subscriptionId, page, limit } = req.query;
    if (subscriptionId && !mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return errorResponse(res, 400, "INVALID_SUBSCRIPTION_ID", "Invalid subscription id");
    }
    const data = await service.listAlerts({ status: status || "pending", severity, subscriptionId, page, limit });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return handleError(res, error);
  }
}

async function acknowledge(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return errorResponse(res, 400, "INVALID_ALERT_ID", "Invalid alert id");
    }
    const data = await service.acknowledgeAlert({
      id: req.params.id,
      actorId: req.dashboardUserId,
      actorRole: req.dashboardUserRole,
      note: req.body && req.body.note,
    });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return handleError(res, error);
  }
}

async function scanNow(req, res) {
  try {
    return res.status(200).json({ status: true, data: await service.runMealLedgerAlertScan() });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = { acknowledge, getSummary, listAlerts, scanNow };

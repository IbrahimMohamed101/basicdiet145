"use strict";

const errorResponse = require("../../utils/errorResponse");
const {
  SubscriptionOperationsAuditError,
  buildSubscriptionOperationsAudit,
} = require("../../services/dashboard/subscriptionOperationsAuditService");

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

async function getSubscriptionOperationsAudit(req, res) {
  try {
    const data = await buildSubscriptionOperationsAudit({
      from: req.query.from,
      to: req.query.to,
      includeDetails: parseBoolean(req.query.includeDetails, true),
    });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    if (error instanceof SubscriptionOperationsAuditError) {
      return errorResponse(
        res,
        error.status,
        error.code,
        error.message,
        error.details
      );
    }
    throw error;
  }
}

module.exports = {
  getSubscriptionOperationsAudit,
};

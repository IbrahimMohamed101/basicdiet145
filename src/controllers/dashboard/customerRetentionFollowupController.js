"use strict";
const errorResponse = require("../../utils/errorResponse");
const { logger } = require("../../utils/logger");
const {
  getCustomerRetentionFollowups, createCustomerRetentionFollowup,
} = require("../../services/dashboard/customerRetentionFollowupService");
function sendError(res, error) {
  if (error?.status && error?.code) {
    return errorResponse(res, error.status, error.code, error.message);
  }
  logger.error("customer retention follow-up failed", { errorClass: error?.name || "Error" });
  return errorResponse(res, 500, "RETENTION_FOLLOWUP_ERROR", "Unable to process retention follow-up");
}
async function listFollowups(req, res) {
  try {
    const data = await getCustomerRetentionFollowups(req.params.id);
    res.set("Cache-Control", "private, no-store");
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}
async function addFollowup(req, res) {
  try {
    const result = await createCustomerRetentionFollowup({
      customerId: req.params.id, actorId: req.dashboardUserId, payload: req.body,
    });
    res.set("Cache-Control", "private, no-store");
    return res.status(result.replayed ? 200 : 201).json({
      status: true, data: result.event, meta: { replayed: result.replayed },
    });
  } catch (error) {
    return sendError(res, error);
  }
}
module.exports = { listFollowups, addFollowup };

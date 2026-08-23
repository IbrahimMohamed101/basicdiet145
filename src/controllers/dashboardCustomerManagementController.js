"use strict";

const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const {
  getCustomerManagementProfile,
  updateCustomerManagementProfile,
} = require("../services/dashboard/customerManagementService");

function respondWithError(res, error, context) {
  if (error && Number.isInteger(error.status) && error.code) {
    return errorResponse(res, error.status, error.code, error.message);
  }
  logger.error("dashboard customer management failed", {
    error: error && error.message,
    stack: error && error.stack,
    ...context,
  });
  return errorResponse(res, 500, "INTERNAL", "Customer management request failed");
}

async function getCustomer(req, res) {
  try {
    const data = await getCustomerManagementProfile(req.params.id);
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return respondWithError(res, error, { customerId: req.params.id, action: "read" });
  }
}

async function updateCustomer(req, res) {
  try {
    const result = await updateCustomerManagementProfile({
      id: req.params.id,
      payload: req.body || {},
      actorId: req.dashboardUserId,
      actorRole: req.dashboardUserRole,
    });
    return res.status(200).json({
      status: true,
      message: "Customer data updated successfully",
      messageAr: "تم تحديث بيانات العميل بنجاح",
      data: result.customer,
      meta: {
        changedFields: result.changedFields,
        sessionsRevoked: result.sessionsRevoked,
      },
    });
  } catch (error) {
    return respondWithError(res, error, { customerId: req.params.id, action: "update" });
  }
}

module.exports = { getCustomer, updateCustomer };

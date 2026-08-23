"use strict";

const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const {
  grantCustomerMealCompensation,
  getCustomerManagementProfile,
  updateCustomerManagementProfile,
} = require("../services/dashboard/customerManagementService");
const {
  executeCustomerAccountMerge,
  previewCustomerAccountMerge,
} = require("../services/dashboard/customerAccountMergeService");

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

async function grantMealCompensation(req, res) {
  try {
    const result = await grantCustomerMealCompensation({
      id: req.params.id,
      payload: req.body || {},
      actorId: req.dashboardUserId,
      actorRole: req.dashboardUserRole,
    });
    return res.status(result.replayed ? 200 : 201).json({
      status: true,
      message: result.replayed ? "Meal compensation already applied" : "Meal compensation applied successfully",
      messageAr: result.replayed ? "تم تطبيق التعويض مسبقًا" : "تمت إضافة الوجبات التعويضية بنجاح",
      data: result.customer,
      meta: {
        compensation: result.compensation,
        replayed: result.replayed,
      },
    });
  } catch (error) {
    return respondWithError(res, error, { customerId: req.params.id, action: "meal_compensation" });
  }
}

async function previewAccountMerge(req, res) {
  try {
    const data = await previewCustomerAccountMerge({
      sourceId: req.params.id,
      targetPhone: (req.body || {}).targetPhone,
      actorRole: req.dashboardUserRole,
    });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return respondWithError(res, error, { customerId: req.params.id, action: "account_merge_preview" });
  }
}

async function mergeAccounts(req, res) {
  try {
    const result = await executeCustomerAccountMerge({
      sourceId: req.params.id,
      payload: req.body || {},
      actorId: req.dashboardUserId,
      actorRole: req.dashboardUserRole,
    });
    return res.status(result.replayed ? 200 : 201).json({
      status: true,
      message: result.replayed ? "Account merge already completed" : "Customer accounts merged successfully",
      messageAr: result.replayed ? "تم دمج الحسابين مسبقًا" : "تم دمج حسابي العميل بنجاح",
      data: {
        operationId: String(result.operation._id),
        state: result.operation.state,
        source: result.preview.source,
        target: result.preview.target,
        movedCounts: result.operation.previewCounts || result.preview.sourceCounts,
      },
      meta: { replayed: result.replayed },
    });
  } catch (error) {
    return respondWithError(res, error, { customerId: req.params.id, action: "account_merge" });
  }
}

module.exports = {
  getCustomer,
  grantMealCompensation,
  mergeAccounts,
  previewAccountMerge,
  updateCustomer,
};

"use strict";

// Install the standalone-Mongo fallback before this controller captures the
// quick deduction service export.
require("../../services/installStandaloneQuickDayDeductionFlow");

const errorResponse = require("../../utils/errorResponse");
const quickDayDeductionService = require("../../services/dashboard/subscriptionQuickDayDeductionService");
const quickDayDeductionLegacyService = require("../../services/dashboard/subscriptionQuickDayDeductionLegacyService");
const quickDayDeductionSearchService = require("../../services/dashboard/subscriptionQuickDayDeductionSearchService");
const quickDayDeductionPickupPolicy = require("../../services/dashboard/subscriptionQuickDayDeductionPickupPolicy");

function handleError(res, error) {
  if (
    error instanceof quickDayDeductionService.QuickDayDeductionError
    || error instanceof quickDayDeductionSearchService.QuickDayDeductionSearchError
  ) {
    return errorResponse(res, error.status, error.code, error.message, error.details);
  }
  throw error;
}

async function search(req, res) {
  try {
    const data = await quickDayDeductionSearchService.search({
      q: req.query.q,
      limit: req.query.limit,
      role: req.dashboardUserRole || req.userRole,
    });
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listOptions(req, res) {
  try {
    const role = req.dashboardUserRole || req.userRole;
    const data = await quickDayDeductionService.listOptions({
      subscriptionId: req.params.subscriptionId,
      role,
    });
    data.batches = await quickDayDeductionPickupPolicy.filterPickupOptions(
      req.params.subscriptionId,
      data.batches
    );
    if (data.batches.length === 0) {
      const legacyOption = await quickDayDeductionLegacyService.listOption({
        subscriptionId: req.params.subscriptionId,
        role,
      });
      if (legacyOption) data.batches = [legacyOption];
    }
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deduct(req, res) {
  try {
    const batchId = req.body && req.body.batchId;
    const actorRole = req.dashboardUserRole || req.userRole;
    const common = {
      subscriptionId: req.params.subscriptionId,
      batchId,
      days: req.body && req.body.days,
      idempotencyKey: req.get("Idempotency-Key"),
      actorId: req.dashboardUserId || req.userId,
      actorRole,
    };

    let data;
    if (String(batchId || "") === quickDayDeductionLegacyService.LEGACY_TARGET_ID) {
      await quickDayDeductionPickupPolicy.assertPickupSubscription(req.params.subscriptionId);
      data = await quickDayDeductionLegacyService.deduct(common);
    } else {
      await quickDayDeductionPickupPolicy.assertPickupTarget({
        subscriptionId: req.params.subscriptionId,
        batchId,
      });
      data = await quickDayDeductionService.deduct(common);
    }
    return res.status(200).json({ status: true, data });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  deduct,
  listOptions,
  search,
};

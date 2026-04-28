const opsTransitionService = require("../../services/dashboard/opsTransitionService");
const opsActionPolicy = require("../../services/dashboard/opsActionPolicy");
const opsReadService = require("../../services/dashboard/opsReadService");
const SubscriptionDay = require("../../models/SubscriptionDay");
const Subscription = require("../../models/Subscription");
const Order = require("../../models/Order");
const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");

/**
 * Controller for the Unified Actions API.
 * POST /api/dashboard/ops/actions/:action
 */

async function handleAction(req, res) {
  const lang = getRequestLang(req);
  const role = req.userRole;

  try {
    const { action } = req.params;
    const { entityId, entityType, payload = {} } = req.body;

    if (!entityId || !entityType) {
      return errorResponse(res, 400, "INVALID_REQUEST", "entityId and entityType are required");
    }

    // 1. Fetch current state for validation
    const Model = entityType === "subscription" ? SubscriptionDay : Order;
    const doc = await Model.findById(entityId).lean();
    if (!doc) {
      return errorResponse(res, 404, "NOT_FOUND", "Entity not found");
    }

    // 2. Validate action using Policy Engine
    let mode = doc.deliveryMode;
    if (entityType === "subscription") {
      const sub = await Subscription.findById(doc.subscriptionId).select("deliveryMode").lean();
      mode = sub && sub.deliveryMode === "pickup" ? "pickup" : "delivery";
    }
    const validation = opsActionPolicy.validateAction({
      entityType,
      status: doc.status,
      mode,
      role,
      actionId: action,
    });

    if (!validation.allowed) {
      return errorResponse(res, 409, validation.reason, `Action ${action} is not allowed in current state`);
    }

    // 3. Execute Transition
    await opsTransitionService.executeAction(action, {
      entityId,
      entityType,
      userId: req.dashboardUserId || req.userId,
      role,
      payload,
    });

    // 4. Return Updated Unified DTO
    const updatedDTO = await opsReadService.getEnrichedDTO({
      entityId,
      entityType,
      role,
      lang,
    });

    return res.status(200).json({
      status: true,
      data: updatedDTO,
    });
  } catch (err) {
    if (err.message === "INVALID_PICKUP_CODE") {
      return errorResponse(res, 400, "INVALID_PICKUP_CODE", "The provided pickup code is incorrect");
    }
    if (err.message === "INVALID_STATE_TRANSITION") {
      return errorResponse(res, 409, "INVALID_STATE_TRANSITION", "This transition is not allowed");
    }
    if (err.message === "PICKUP_PREPARE_REQUIRED") {
      return errorResponse(res, 409, "PICKUP_PREPARE_REQUIRED", "Pickup preparation requires an explicit client request");
    }
    
    console.error("Dashboard Action Error:", err);
    return errorResponse(res, 500, "INTERNAL_ERROR", "Action execution failed", { detail: err.message });
  }
}

module.exports = {
  handleAction,
};

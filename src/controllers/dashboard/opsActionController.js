const opsTransitionService = require("../../services/dashboard/opsTransitionService");
const opsActionPolicy = require("../../services/dashboard/opsActionPolicy");
const opsReadService = require("../../services/dashboard/opsReadService");
const mongoose = require("mongoose");
const SubscriptionDay = require("../../models/SubscriptionDay");
const SubscriptionPickupRequest = require("../../models/SubscriptionPickupRequest");
const Subscription = require("../../models/Subscription");
const { executeDashboardOrderAction } = require("../../services/orders/orderDashboardService");
const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");
// Settlement on read is DISABLED — see pastSubscriptionDaySettlementService.js

/**
 * Controller for the Unified Actions API.
 * POST /api/dashboard/ops/actions/:action
 */

async function handleAction(req, res) {
  const lang = getRequestLang(req);
  const role = req.userRole;

  try {
    const action = opsActionPolicy.normalizeActionId(req.params.action);
    const { entityId } = req.body;
    const payload = { ...(req.body.payload || {}) };
    if (req.body.code !== undefined) payload.code = req.body.code;
    if (req.body.pickupCode !== undefined) payload.pickupCode = req.body.pickupCode;
    let rawEntityType = req.body.entityType;
    if (req.body.source === "one_time_order") {
      rawEntityType = "order";
    }
    const entityType = rawEntityType === "subscription_day" || rawEntityType === "pickup_day"
      ? "subscription"
      : rawEntityType;

    if (!rawEntityType) {
      return errorResponse(res, 400, "INVALID_REQUEST", "entityType is required");
    }
    if (!entityId) {
      return errorResponse(res, 400, "INVALID_REQUEST", "entityId is required");
    }
    if (!["subscription", "subscription_day", "pickup_day", "subscription_pickup_request", "order"].includes(rawEntityType)) {
      return errorResponse(res, 400, "INVALID_ENTITY_TYPE", "Unsupported entityType");
    }
    if (!mongoose.Types.ObjectId.isValid(entityId)) {
      return errorResponse(res, 400, "INVALID_ENTITY_ID", "Invalid entityId");
    }

    if (entityType === "order") {
      try {
        const orderAction = action === "start_preparation" ? "prepare" : action;
        const data = await executeDashboardOrderAction({
          orderId: entityId,
          action: orderAction,
          actor: { userId: req.dashboardUserId || req.userId, role },
          payload,
        });
        return res.status(200).json({ status: true, data });
      } catch (err) {
        if (err.code === "PAYMENT_NOT_PAID" || err.code === "ORDER_PAYMENT_REQUIRED" || err.message === "ORDER_PAYMENT_REQUIRED") {
          return errorResponse(res, 409, "ORDER_PAYMENT_REQUIRED", "Paid orders are required for operational fulfillment");
        }
        if (err.status || err.code) {
          return errorResponse(res, err.status || 500, err.code || "INTERNAL", err.message, err.details);
        }
        throw err;
      }
    } else if (entityType === "subscription_pickup_request") {
      const doc = await SubscriptionPickupRequest.findById(entityId).lean();
      if (!doc) {
        return errorResponse(res, 404, "NOT_FOUND", "Entity not found");
      }
      const validation = opsActionPolicy.validateAction({
        entityType,
        status: doc.status,
        mode: "pickup",
        role,
        actionId: action,
      });

      if (!validation.allowed) {
        const code = validation.reason === "INVALID_STATE_TRANSITION" ? "INVALID_TRANSITION" : validation.reason;
        return errorResponse(res, 409, code, `Action ${action} is not allowed in current state`);
      }

      await opsTransitionService.executeAction(action, {
        entityId,
        entityType,
        userId: req.dashboardUserId || req.userId,
        role,
        payload,
      });
    } else {
      // 1. Fetch current state for validation
      const Model = SubscriptionDay;
      // Settlement on read intentionally removed — meals are not consumed by date passage.
      const doc = await Model.findById(entityId).lean();
      if (!doc) {
        return errorResponse(res, 404, "NOT_FOUND", "Entity not found");
      }

      // 2. Validate action using Policy Engine
      const sub = await Subscription.findById(doc.subscriptionId).select("deliveryMode").lean();
      const mode = sub && sub.deliveryMode === "pickup" ? "pickup" : "delivery";

      if (mode === "pickup" && !doc.pickupRequested && ["prepare", "start_preparation", "ready_for_pickup", "ready-for-pickup", "fulfill", "no_show"].includes(action)) {
        return errorResponse(res, 422, "PICKUP_REQUEST_REQUIRED", "Pickup preparation requires an explicit client request");
      }
      
      const validation = opsActionPolicy.validateAction({
        entityType,
        status: doc.status,
        mode,
        role,
        actionId: action,
      });

      if (!validation.allowed) {
        const code = validation.reason === "INVALID_STATE_TRANSITION" ? "INVALID_TRANSITION" : validation.reason;
        return errorResponse(res, 409, code, `Action ${action} is not allowed in current state`);
      }

      // 3. Execute Transition
      await opsTransitionService.executeAction(action, {
        entityId,
        entityType,
        userId: req.dashboardUserId || req.userId,
        role,
        payload,
      });
    }

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
      return errorResponse(res, 409, "INVALID_TRANSITION", "This transition is not allowed");
    }
    if (err.message && err.message.startsWith("Invalid state transition")) {
      return errorResponse(res, 409, "INVALID_STATE_TRANSITION", "This transition is not allowed");
    }
    if (err.code === "PAYMENT_NOT_PAID" || err.code === "ORDER_PAYMENT_REQUIRED" || err.message === "ORDER_PAYMENT_REQUIRED") {
      return errorResponse(res, 409, "ORDER_PAYMENT_REQUIRED", "Paid orders are required for operational fulfillment");
    }
    if (err.message === "PICKUP_REQUEST_REQUIRED" || err.code === "PICKUP_REQUEST_REQUIRED") {
      return errorResponse(res, 422, "PICKUP_REQUEST_REQUIRED", "Pickup preparation requires an explicit client request");
    }
    if (err.status || err.code) {
      return errorResponse(res, err.status || 500, err.code || "INTERNAL", err.message, err.details);
    }
    
    console.error("Dashboard Action Error:", err);
    return errorResponse(res, 500, "INTERNAL_ERROR", "Action execution failed", { detail: err.message });
  }
}

module.exports = {
  handleAction,
};

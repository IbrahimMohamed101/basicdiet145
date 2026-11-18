"use strict";

const { prepareDeliveryAddon } = require("../../services/dashboard/deliveryAddonPreparationService");
const errorResponse = require("../../utils/errorResponse");

async function prepareAddon(req, res) {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return errorResponse(res, 400, "INVALID_REQUEST", "A JSON body is required");
    }
    const result = await prepareDeliveryAddon({
      dayId: req.params.id,
      balanceBucketId: req.body.balanceBucketId,
      productId: req.body.productId,
      role: req.userRole,
      actorId: req.dashboardUserId || req.userId,
    });
    return res.status(200).json({ status: true, data: result });
  } catch (e) {
    if (e.status && e.code) {
      return errorResponse(res, e.status, e.code, e.message);
    }
    throw e;
  }
}

module.exports = { prepareAddon };

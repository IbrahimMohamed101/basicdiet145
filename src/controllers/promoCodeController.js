const PromoCode = require("../models/PromoCode");
const PromoUsage = require("../models/PromoUsage");
const errorResponse = require("../utils/errorResponse");
const validateObjectId = require("../utils/validateObjectId");
const { writeLog } = require("../utils/log");
const {
  serializePromoCodeForAdmin,
  normalizePromoPayload,
  applyPromoCodeToSubscriptionQuote,
} = require("../services/promoCodeService");

async function writePromoActivityLog(req, promo, action) {
  try {
    await writeLog({
      entityType: "promo_code",
      entityId: promo._id || promo.id,
      action,
      byUserId: req.dashboardUserId || req.userId,
      byRole: req.dashboardUserRole || req.userRole,
      meta: { code: promo.code },
    });
  } catch (_err) {
    // Activity logging must never make catalog administration fail.
  }
}

function buildPromoQuery(includeDeleted = false) {
  return includeDeleted ? {} : { deletedAt: null };
}

async function listPromoCodesAdmin(req, res) {
  const includeDeleted = String(req.query.includeDeleted || "").trim().toLowerCase() === "true";
  const promos = await PromoCode.find(buildPromoQuery(includeDeleted))
    .sort({ createdAt: -1 })
    .lean();

  return res.status(200).json({
    status: true,
    data: promos.map((promo) => serializePromoCodeForAdmin(promo)),
  });
}

async function getPromoCodeAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "promoCodeId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const promo = await PromoCode.findById(id).lean();
  if (!promo || promo.deletedAt) {
    return errorResponse(res, 404, "NOT_FOUND", "Promo code not found");
  }

  const recentUsages = await PromoUsage.find({ promoCodeId: promo._id })
    .sort({ createdAt: -1 })
    .limit(25)
    .lean();

  return res.status(200).json({
    status: true,
    data: {
      ...serializePromoCodeForAdmin(promo),
      recentUsage: recentUsages.map((usage) => ({
        id: String(usage._id),
        userId: usage.userId ? String(usage.userId) : null,
        checkoutDraftId: usage.checkoutDraftId ? String(usage.checkoutDraftId) : null,
        subscriptionId: usage.subscriptionId ? String(usage.subscriptionId) : null,
        paymentId: usage.paymentId ? String(usage.paymentId) : null,
        discountAmountHalala: Number(usage.discountAmountHalala || 0),
        status: usage.status,
        reservedAt: usage.reservedAt || null,
        consumedAt: usage.consumedAt || null,
        cancelledAt: usage.cancelledAt || null,
        createdAt: usage.createdAt || null,
      })),
    },
  });
}

async function createPromoCodeAdmin(req, res) {
  try {
    const normalized = normalizePromoPayload(req.body || {});
    const promo = await PromoCode.create(normalized);
    await writePromoActivityLog(req, promo, "promo_code_created_by_admin");
    return res.status(201).json({
      status: true,
      data: serializePromoCodeForAdmin(promo.toObject ? promo.toObject() : promo),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return errorResponse(res, 409, "CONFLICT", "Promo code already exists");
    }
    if (String(err.code || "").startsWith("PROMO_")) {
      return errorResponse(res, 422, err.code, err.message);
    }
    throw err;
  }
}

async function updatePromoCodeAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "promoCodeId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const existing = await PromoCode.findById(id);
  if (!existing || existing.deletedAt) {
    return errorResponse(res, 404, "NOT_FOUND", "Promo code not found");
  }

  try {
    const normalized = normalizePromoPayload({
      ...existing.toObject(),
      ...req.body,
      code: req.body && req.body.code !== undefined ? req.body.code : existing.code,
    });
    Object.assign(existing, normalized);
    await existing.save();
    await writePromoActivityLog(req, existing, "promo_code_updated_by_admin");
    return res.status(200).json({
      status: true,
      data: serializePromoCodeForAdmin(existing.toObject ? existing.toObject() : existing),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return errorResponse(res, 409, "CONFLICT", "Promo code already exists");
    }
    if (String(err.code || "").startsWith("PROMO_")) {
      return errorResponse(res, 422, err.code, err.message);
    }
    throw err;
  }
}

async function togglePromoCodeActive(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "promoCodeId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const promo = await PromoCode.findById(id);
  if (!promo || promo.deletedAt) {
    return errorResponse(res, 404, "NOT_FOUND", "Promo code not found");
  }

  promo.isActive = !promo.isActive;
  await promo.save();
  await writePromoActivityLog(req, promo, "promo_code_toggled_by_admin");

  return res.status(200).json({
    status: true,
    data: serializePromoCodeForAdmin(promo.toObject ? promo.toObject() : promo),
  });
}

async function deletePromoCodeAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "promoCodeId");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  const promo = await PromoCode.findById(id);
  if (!promo || promo.deletedAt) {
    return errorResponse(res, 404, "NOT_FOUND", "Promo code not found");
  }

  if (Number(promo.currentUsageCount || 0) > 0) {
    return errorResponse(
      res,
      409,
      "PROMO_IN_USE",
      "Promo code has active or consumed usages and cannot be hard removed"
    );
  }

  promo.deletedAt = new Date();
  promo.isActive = false;
  await promo.save();
  await writePromoActivityLog(req, promo, "promo_code_deleted_by_admin");

  return res.status(200).json({
    status: true,
    data: serializePromoCodeForAdmin(promo.toObject ? promo.toObject() : promo),
  });
}

async function validatePromoCodeAdmin(req, res) {
  const body = req.body || {};
  try {
    const quote = {
      plan: {
        _id: body.planId || (body.quote && body.quote.planId) || undefined,
        daysCount: body.daysCount || (body.quote && body.quote.daysCount) || 0,
      },
      breakdown: body.breakdown || (body.quote && body.quote.breakdown) || {
        basePlanPriceHalala: Number(body.subtotalHalala || body.totalHalala || 0),
        premiumTotalHalala: 0,
        addonsTotalHalala: 0,
        deliveryFeeHalala: 0,
        vatPercentage: Number(body.vatPercentage || 0),
      },
    };
    const result = await applyPromoCodeToSubscriptionQuote({
      promoCode: body.promoCode || body.code,
      userId: body.userId || req.dashboardUserId,
      quote,
    });
    return res.status(200).json({
      status: true,
      data: {
        valid: true,
        promo: result.appliedPromo,
        breakdown: result.quote.breakdown,
      },
    });
  } catch (err) {
    if (String(err.code || "").startsWith("PROMO_")) {
      return errorResponse(res, err.status || 400, err.code, err.message);
    }
    throw err;
  }
}

module.exports = {
  listPromoCodesAdmin,
  getPromoCodeAdmin,
  createPromoCodeAdmin,
  updatePromoCodeAdmin,
  togglePromoCodeActive,
  deletePromoCodeAdmin,
  validatePromoCodeAdmin,
};

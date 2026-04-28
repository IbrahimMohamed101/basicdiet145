const PromoCode = require("../models/PromoCode");
const PromoUsage = require("../models/PromoUsage");
const errorResponse = require("../utils/errorResponse");
const validateObjectId = require("../utils/validateObjectId");
const {
  serializePromoCodeForAdmin,
  normalizePromoPayload,
} = require("../services/promoCodeService");

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

  return res.status(200).json({
    status: true,
    data: serializePromoCodeForAdmin(promo.toObject ? promo.toObject() : promo),
  });
}

module.exports = {
  listPromoCodesAdmin,
  getPromoCodeAdmin,
  createPromoCodeAdmin,
  updatePromoCodeAdmin,
  togglePromoCodeActive,
  deletePromoCodeAdmin,
};

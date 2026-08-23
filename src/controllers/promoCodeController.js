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
const {
  serializePublicSubscriptionPromoOffer,
  resolveAdminSubscriptionPromoSelection,
  setSelectedAppPromoCode,
  clearSelectedAppPromoCodeIfMatches,
} = require("../services/subscriptionPromoDisplayService");

async function writePromoActivityLog(req, promo, action, extraMeta = {}) {
  try {
    await writeLog({
      entityType: "promo_code",
      entityId: promo._id || promo.id,
      action,
      byUserId: req.dashboardUserId || req.userId,
      byRole: req.dashboardUserRole || req.userRole,
      meta: { code: promo.code, ...extraMeta },
    });
  } catch (_err) {
    // Activity logging must never make catalog administration fail.
  }
}

function serializeAppPromoSelection(selection) {
  const promo = selection && selection.promo ? selection.promo : null;
  return {
    promoCodeId: selection && selection.promoCodeId ? selection.promoCodeId : null,
    promoCode: promo ? serializePromoCodeForAdmin(promo) : null,
    promoOffer: promo ? serializePublicSubscriptionPromoOffer(promo) : null,
    isPubliclyDisplayable: Boolean(selection && selection.isPubliclyDisplayable),
    issues: Array.isArray(selection && selection.issues) ? selection.issues : [],
  };
}

function buildPromoQuery(includeDeleted = false) {
  return includeDeleted ? {} : { deletedAt: null };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPositiveInteger(value, fallback, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}

async function listPromoCodesAdmin(req, res) {
  const includeDeleted = String(req.query.includeDeleted || "").trim().toLowerCase() === "true";
  const paginationRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const page = readPositiveInteger(req.query.page, 1);
  const limit = readPositiveInteger(req.query.limit, 20, { max: 100 });
  if (page === null || limit === null) {
    return errorResponse(res, 400, "INVALID", "page must be >= 1 and limit must be between 1 and 100");
  }

  const query = buildPromoQuery(includeDeleted);
  const q = String(req.query.q || "").trim();
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    query.$or = [
      { code: pattern },
      { codeNormalized: pattern },
      { title: pattern },
      { description: pattern },
      { "metadata.name.ar": pattern },
      { "metadata.name.en": pattern },
    ];
  }

  const total = await PromoCode.countDocuments(query);
  let promoQuery = PromoCode.find(query).sort({ createdAt: -1 });
  if (paginationRequested) {
    promoQuery = promoQuery.skip((page - 1) * limit).limit(limit);
  }
  const promos = await promoQuery.lean();
  const effectiveLimit = paginationRequested ? limit : Math.max(total, 1);
  const totalPages = paginationRequested ? Math.max(1, Math.ceil(total / limit)) : 1;

  return res.status(200).json({
    status: true,
    data: promos.map((promo) => serializePromoCodeForAdmin(promo)),
    meta: {
      total,
      page: paginationRequested ? page : 1,
      currentPage: paginationRequested ? page : 1,
      limit: effectiveLimit,
      totalPages,
      lastPage: totalPages,
    },
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

async function getAppPromoSelectionAdmin(_req, res) {
  const selection = await resolveAdminSubscriptionPromoSelection();
  return res.status(200).json({
    status: true,
    data: serializeAppPromoSelection(selection),
  });
}

async function updateAppPromoSelectionAdmin(req, res) {
  const body = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(body, "promoCodeId")) {
    return errorResponse(res, 400, "INVALID", "promoCodeId is required; use null to clear the selection");
  }
  if (
    body.promoCodeId !== null
    && (typeof body.promoCodeId !== "string" || !body.promoCodeId.trim())
  ) {
    return errorResponse(res, 400, "INVALID", "promoCodeId must be a non-empty string or null");
  }

  const previous = await resolveAdminSubscriptionPromoSelection();
  try {
    const selection = await setSelectedAppPromoCode(body.promoCodeId);
    const logPromo = selection.promo || previous.promo;
    if (logPromo) {
      await writePromoActivityLog(
        req,
        logPromo,
        selection.promoCodeId
          ? "app_promo_selected_by_admin"
          : "app_promo_selection_cleared_by_admin",
        {
          previousPromoCodeId: previous.promoCodeId,
          selectedPromoCodeId: selection.promoCodeId,
        }
      );
    }
    return res.status(200).json({
      status: true,
      data: serializeAppPromoSelection(selection),
    });
  } catch (err) {
    if (["INVALID_ID", "PROMO_NOT_FOUND", "PROMO_NOT_APPLICABLE_TO_SUBSCRIPTIONS"].includes(err.code)) {
      return errorResponse(res, err.status || 422, err.code, err.message);
    }
    throw err;
  }
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
  await clearSelectedAppPromoCodeIfMatches(promo._id);
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
  getAppPromoSelectionAdmin,
  updateAppPromoSelectionAdmin,
  createPromoCodeAdmin,
  updatePromoCodeAdmin,
  togglePromoCodeActive,
  deletePromoCodeAdmin,
  validatePromoCodeAdmin,
};

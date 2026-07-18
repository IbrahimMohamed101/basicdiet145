const mongoose = require("mongoose");

const MenuProduct = require("../../models/MenuProduct");
const MenuAuditLog = require("../../models/MenuAuditLog");
const errorResponse = require("../../utils/errorResponse");
const {
  assertValidWeightPricingConfiguration,
  buildWeightPricingDescriptor,
} = require("../../services/orders/weightPricingService");

const INTEGER_FIELDS = [
  "priceHalala",
  "baseUnitGrams",
  "defaultWeightGrams",
  "minWeightGrams",
  "maxWeightGrams",
  "weightStepGrams",
  "weightStepPriceHalala",
];
const ALLOWED_FIELDS = new Set(INTEGER_FIELDS);

function normalizeInteger(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value === null || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    const err = new Error(`${fieldName} must be an integer >= 0`);
    err.code = "INVALID_WEIGHT_PRICING_CONFIGURATION";
    err.status = 400;
    err.details = { field: fieldName, value };
    throw err;
  }
  return parsed;
}

function serializeProduct(product) {
  const row = product && typeof product.toObject === "function"
    ? product.toObject()
    : { ...product };
  return {
    id: String(row._id),
    ...row,
    _id: row._id,
  };
}

async function updateProductWeightPricing(req, res) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const invalidFields = Object.keys(body).filter((field) => !ALLOWED_FIELDS.has(field));
    if (invalidFields.length) {
      return errorResponse(
        res,
        400,
        "INVALID_WEIGHT_PRICING_CONFIGURATION",
        "Unsupported weight pricing fields",
        { invalidFields }
      );
    }

    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ""))) {
      return errorResponse(res, 400, "INVALID_OBJECT_ID", "Product id is invalid");
    }

    const product = await MenuProduct.findById(req.params.id);
    if (!product) {
      return errorResponse(res, 404, "MENU_ENTITY_NOT_FOUND", "Product not found");
    }

    const before = product.toObject();
    for (const field of INTEGER_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
      product[field] = normalizeInteger(body[field], field, {
        nullable: field === "weightStepPriceHalala",
      });
    }

    product.pricingModel = "per_100g";
    product.isCustomizable = true;

    assertValidWeightPricingConfiguration(product.toObject());
    await product.save();

    await MenuAuditLog.create({
      entityType: "product",
      entityId: product._id,
      action: "update_weight_pricing",
      before,
      after: product.toObject(),
      actorId: req.dashboardUserId && mongoose.Types.ObjectId.isValid(req.dashboardUserId)
        ? req.dashboardUserId
        : null,
      actorRole: req.dashboardUserRole || "",
      meta: {
        contractVersion: "dashboard_weight_pricing.v1",
      },
    }).catch(() => null);

    return res.status(200).json({
      status: true,
      data: {
        contractVersion: "dashboard_weight_pricing.v1",
        product: serializeProduct(product),
        weightPricing: buildWeightPricingDescriptor(product.toObject()),
      },
    });
  } catch (err) {
    if (err && err.code && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    if (err && err.name === "ValidationError") {
      return errorResponse(
        res,
        400,
        "MENU_VALIDATION_ERROR",
        "Validation failed",
        Object.values(err.errors || {}).map((item) => item.message)
      );
    }
    return errorResponse(res, 500, "MENU_INTERNAL_ERROR", "Unexpected weight pricing error");
  }
}

module.exports = {
  updateProductWeightPricing,
};

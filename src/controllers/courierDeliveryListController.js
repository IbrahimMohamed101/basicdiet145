"use strict";

const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const { resolveOptionalPagination, buildPaginationMeta } = require("../utils/optionalPagination");
const { listCourierDeliveryQueue } = require("../services/courierDeliveryQueueService");

async function listDeliveries(req, res) {
  if (!req.userRole) {
    return res.status(403).json({
      ok: false,
      status: false,
      message: "Forbidden",
      messageAr: "غير مصرح بتنفيذ هذا الإجراء",
      error: { code: "FORBIDDEN", message: "Forbidden" },
    });
  }

  try {
    const result = await listCourierDeliveryQueue({ date: req.query.date });
    const pagination = resolveOptionalPagination(req.query, 500, 100);

    if (!pagination) {
      return res.status(200).json({
        status: true,
        data: result.items,
        meta: {
          date: result.date,
          total: result.items.length,
        },
      });
    }

    const skip = (pagination.page - 1) * pagination.limit;
    const data = result.items.slice(skip, skip + pagination.limit);

    return res.status(200).json({
      status: true,
      data,
      meta: {
        date: result.date,
        ...buildPaginationMeta(pagination.page, pagination.limit, result.items.length),
      },
    });
  } catch (err) {
    if (err && (err.status || err.code)) {
      return errorResponse(
        res,
        err.status || 500,
        err.code || "INTERNAL",
        err.message || "Failed to list deliveries"
      );
    }

    logger.error("courierDeliveryListController.listDeliveries failed", {
      error: err && err.message,
      stack: err && err.stack,
    });
    return errorResponse(res, 500, "INTERNAL", "Failed to list deliveries");
  }
}

module.exports = {
  listDeliveries,
};

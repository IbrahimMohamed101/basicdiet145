"use strict";

const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");
const { buildPaginationMeta } = require("../../utils/optionalPagination");
const {
  listSubscriptionsByFulfillment,
} = require("../../services/dashboard/subscriptionFulfillmentListService");

async function list(req, res) {
  try {
    const payload = await listSubscriptionsByFulfillment({
      ...(req.query || {}),
      lang: getRequestLang(req),
    });

    return res.status(200).json({
      status: true,
      data: payload.data,
      meta: buildPaginationMeta(
        payload.pagination.page,
        payload.pagination.limit,
        payload.total
      ),
      filters: {
        q: payload.filters.q,
        status: payload.filters.normalizedStatus,
        fulfillmentMethod: payload.filters.fulfillmentMethod,
        from: payload.filters.from,
        to: payload.filters.to,
      },
    });
  } catch (error) {
    if (error && Number.isInteger(error.status) && error.code) {
      return errorResponse(
        res,
        error.status,
        error.code,
        error.message,
        error.details
      );
    }
    throw error;
  }
}

module.exports = {
  list,
};

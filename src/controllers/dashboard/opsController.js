"use strict";

const opsReadService = require("../../services/dashboard/opsReadService");
const opsSearchService = require("../../services/dashboard/opsSearchService");
const errorResponse = require("../../utils/errorResponse");
const { getRequestLang } = require("../../utils/i18n");

async function listOperations(req, res) {
  try {
    const date = req.query.date;
    if (!date) {
      return errorResponse(res, 400, "INVALID", "date query parameter is required (YYYY-MM-DD)");
    }

    // Basic regex for YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return errorResponse(res, 400, "INVALID", "date must be in YYYY-MM-DD format");
    }

    const lang = getRequestLang(req);
    const role = req.userRole;
    const data = await opsReadService.listOperations({ date, role, lang });

    return res.status(200).json({
      status: true,
      data,
    });
  } catch (err) {
    console.error("Error in listOperations:", err);
    return errorResponse(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}

async function searchOperations(req, res) {
  try {
    const q = req.query.q;
    if (!q || q.length < 3) {
      return res.status(200).json({ status: true, data: [] });
    }

    const lang = getRequestLang(req);
    const role = req.userRole;
    const data = await opsSearchService.search({ q, role, lang });

    return res.status(200).json({
      status: true,
      data,
    });
  } catch (err) {
    console.error("Error in searchOperations:", err);
    return errorResponse(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
}

module.exports = {
  listOperations,
  searchOperations,
};

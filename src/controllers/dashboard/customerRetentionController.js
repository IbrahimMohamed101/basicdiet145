"use strict";

const errorResponse = require("../utils/errorResponse");
const { logger } = require("../utils/logger");
const { getLiveRetentionReport } = require("../services/dashboard/customerRetentionReadService");

async function getRetention(req, res) {
  try {
    const data = await getLiveRetentionReport({
      page: req.query.page,
      pageSize: req.query.pageSize,
      status: req.query.status,
      search: req.query.search,
    });
    res.set("Cache-Control", "private, no-store");
    return res.status(200).json({ status: true, data });
  } catch (error) {
    if (error?.status && error?.code) {
      return errorResponse(res, error.status, error.code, error.message);
    }
    logger.error("dashboard retention read failed", { errorClass: error?.name || "Error" });
    return errorResponse(res, 500, "RETENTION_READ_FAILED", "Unable to read retention report");
  }
}

module.exports = { getRetention };

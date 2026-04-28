"use strict";

const errorResponse = require("../utils/errorResponse");
const { getKitchenOperationsSummary } = require("../services/kitchenOperations/KitchenOperationsSummaryService");
const { listKitchenOperations } = require("../services/kitchenOperations/KitchenOperationsListService");

async function getSummary(req, res) {
  try {
    const data = await getKitchenOperationsSummary(req.query);
    return res.status(200).json({ status: true, data });
  } catch (err) {
    if (err && err.status && err.code) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function getList(req, res) {
  try {
    const data = await listKitchenOperations(req.query);
    return res.status(200).json({ status: true, data });
  } catch (err) {
    if (err && err.status && err.code) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

module.exports = {
  getSummary,
  getList,
};

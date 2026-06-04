const service = require("../../services/catalog/catalogItemService");
const errorResponse = require("../../utils/errorResponse");

function send(res, data, statusCode = 200) {
  return res.status(statusCode).json({ status: true, data });
}

function handleError(err, res) {
  if (err && err.status && err.code) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  if (err && err.name === "ValidationError") {
    return errorResponse(res, 400, "CATALOG_ITEM_VALIDATION_ERROR", "Validation failed", Object.values(err.errors || {}).map((item) => item.message));
  }
  if (err && err.code === 11000) {
    return errorResponse(res, 409, "CATALOG_ITEM_KEY_EXISTS", "CatalogItem key already exists");
  }
  return errorResponse(res, 500, "CATALOG_ITEM_INTERNAL_ERROR", "Unexpected catalog item error");
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (err) {
      try {
        return handleError(err, res);
      } catch (unhandled) {
        return next(unhandled);
      }
    }
  };
}

const listCatalogItems = wrap(async (req, res) => send(res, await service.listCatalogItems(req.query || {})));
const getCatalogItem = wrap(async (req, res) => send(res, await service.getCatalogItem(req.params.id)));
const createCatalogItem = wrap(async (req, res) => send(res, await service.createCatalogItem(req.body), 201));
const updateCatalogItem = wrap(async (req, res) => send(res, await service.updateCatalogItem(req.params.id, req.body)));

module.exports = {
  listCatalogItems,
  getCatalogItem,
  createCatalogItem,
  updateCatalogItem,
};

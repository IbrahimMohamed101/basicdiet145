const service = require("../../services/orders/menuCatalogService");
const errorResponse = require("../../utils/errorResponse");

function actorFromRequest(req) {
  return {
    userId: req.dashboardUserId,
    role: req.dashboardUserRole,
  };
}

function listOptions(req) {
  return {
    includeInactive: String(req.query.includeInactive || "").toLowerCase() === "true",
    isActive: req.query.isActive,
    q: req.query.q,
    published: req.query.published,
    groupId: req.query.groupId,
    limit: req.query.limit,
  };
}

function send(res, data, statusCode = 200) {
  return res.status(statusCode).json({ status: true, data });
}

function handleMenuError(err, res) {
  if (err && err.status && err.code) {
    return errorResponse(res, err.status, err.code, err.message, err.details);
  }
  if (err && err.name === "ValidationError") {
    return errorResponse(res, 400, "VALIDATION_ERROR", "Validation failed", Object.values(err.errors || {}).map((item) => item.message));
  }
  if (err && err.code === 11000) {
    return errorResponse(res, 409, "DUPLICATE_MENU_KEY", "Duplicate menu key");
  }
  throw err;
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (err) {
      try {
        return handleMenuError(err, res);
      } catch (unhandled) {
        return next(unhandled);
      }
    }
  };
}

const listCategories = wrap(async (req, res) => send(res, await service.listCategories(listOptions(req))));
const createCategory = wrap(async (req, res) => send(res, await service.createCategory(req.body, actorFromRequest(req)), 201));
const getCategory = wrap(async (req, res) => send(res, await service.getCategory(req.params.id)));
const updateCategory = wrap(async (req, res) => send(res, await service.updateCategory(req.params.id, req.body, actorFromRequest(req))));
const deleteCategory = wrap(async (req, res) => send(res, await service.deleteCategory(req.params.id, actorFromRequest(req))));
const reorderCategories = wrap(async (req, res) => send(res, await service.reorderCategories(req.body.items || req.body, actorFromRequest(req))));

const listProducts = wrap(async (req, res) => send(res, await service.listProducts(listOptions(req))));
const createProduct = wrap(async (req, res) => send(res, await service.createProduct(req.body, actorFromRequest(req)), 201));
const getProduct = wrap(async (req, res) => send(res, await service.getProduct(req.params.id)));
const updateProduct = wrap(async (req, res) => send(res, await service.updateProduct(req.params.id, req.body, actorFromRequest(req))));
const deleteProduct = wrap(async (req, res) => send(res, await service.deleteProduct(req.params.id, actorFromRequest(req))));
const reorderProducts = wrap(async (req, res) => send(res, await service.reorderProducts(req.body.items || req.body, actorFromRequest(req))));
const updateProductAvailability = wrap(async (req, res) => {
  const body = { branchAvailability: req.body.branchAvailability || req.body.branchIds || [] };
  return send(res, await service.updateProduct(req.params.productId, body, actorFromRequest(req)));
});

const listOptionGroups = wrap(async (req, res) => send(res, await service.listOptionGroups(listOptions(req))));
const createOptionGroup = wrap(async (req, res) => send(res, await service.createOptionGroup(req.body, actorFromRequest(req)), 201));
const getOptionGroup = wrap(async (req, res) => send(res, await service.getOptionGroup(req.params.id)));
const updateOptionGroup = wrap(async (req, res) => send(res, await service.updateOptionGroup(req.params.id, req.body, actorFromRequest(req))));
const deleteOptionGroup = wrap(async (req, res) => send(res, await service.deleteOptionGroup(req.params.id, actorFromRequest(req))));

const listOptionsEndpoint = wrap(async (req, res) => send(res, await service.listOptions(listOptions(req))));
const createOption = wrap(async (req, res) => send(res, await service.createOption(req.body, actorFromRequest(req)), 201));
const getOption = wrap(async (req, res) => send(res, await service.getOption(req.params.id)));
const updateOption = wrap(async (req, res) => send(res, await service.updateOption(req.params.id, req.body, actorFromRequest(req))));
const deleteOption = wrap(async (req, res) => send(res, await service.deleteOption(req.params.id, actorFromRequest(req))));

const setProductGroups = wrap(async (req, res) => send(res, await service.setProductGroups(req.params.productId, req.body.groups || req.body, actorFromRequest(req))));
const setProductGroupOptions = wrap(async (req, res) => send(res, await service.setProductGroupOptions(req.params.productId, req.params.groupId, req.body.options || req.body, actorFromRequest(req))));
const publishMenu = wrap(async (req, res) => send(res, await service.publishMenu({ actor: actorFromRequest(req), notes: req.body.notes })));
const listAuditLogs = wrap(async (req, res) => send(res, await service.listAuditLogs(listOptions(req))));

module.exports = {
  listCategories,
  createCategory,
  getCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  listProducts,
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  reorderProducts,
  updateProductAvailability,
  listOptionGroups,
  createOptionGroup,
  getOptionGroup,
  updateOptionGroup,
  deleteOptionGroup,
  listOptions: listOptionsEndpoint,
  createOption,
  getOption,
  updateOption,
  deleteOption,
  setProductGroups,
  setProductGroupOptions,
  publishMenu,
  listAuditLogs,
};

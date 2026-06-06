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
    isVisible: req.query.isVisible,
    isAvailable: req.query.isAvailable,
    q: req.query.q,
    published: req.query.published,
    groupId: req.query.groupId,
    search: req.query.search,
    suggestedGroupId: req.query.suggestedGroupId,
    onlySuggested: req.query.onlySuggested,
    includeDisabled: req.query.includeDisabled,
    page: req.query.page,
    limit: req.query.limit,
    contractVersion: req.query.contractVersion,
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
    return errorResponse(res, 400, "MENU_VALIDATION_ERROR", "Validation failed", Object.values(err.errors || {}).map((item) => item.message));
  }
  if (err && err.code === 11000) {
    return errorResponse(res, 409, "MENU_CONFLICT", "Duplicate menu key", err.keyValue || undefined);
  }
  return errorResponse(res, 500, "MENU_INTERNAL_ERROR", "Unexpected menu error");
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
const getCategory = wrap(async (req, res) => send(res, await service.getCategory(req.params.id, listOptions(req))));
const updateCategory = wrap(async (req, res) => send(res, await service.updateCategory(req.params.id, req.body, actorFromRequest(req))));
const updateCategoryVisibility = wrap(async (req, res) => send(res, await service.updateCategoryVisibility(req.params.id, req.body, actorFromRequest(req))));
const updateCategoryAvailability = wrap(async (req, res) => send(res, await service.updateCategoryAvailability(req.params.id, req.body, actorFromRequest(req))));
const deleteCategory = wrap(async (req, res) => send(res, await service.deleteCategory(req.params.id, actorFromRequest(req))));
const reorderCategories = wrap(async (req, res) => send(res, await service.reorderCategories(req.body.items || req.body, actorFromRequest(req))));
const bulkAssignProductsToCategory = wrap(async (req, res) => send(res, await service.bulkAssignProductsToCategory(
  req.params.id,
  req.body,
  actorFromRequest(req)
)));

const listProducts = wrap(async (req, res) => send(res, await service.listProducts(listOptions(req))));
const createProduct = wrap(async (req, res) => send(res, await service.createProduct(req.body, actorFromRequest(req)), 201));
const getProduct = wrap(async (req, res) => send(res, await service.getProduct(req.params.id)));
const getProductComposer = wrap(async (req, res) => send(res, await service.getProductComposer(req.params.productId || req.params.id, listOptions(req))));
const getCustomizationLibrary = wrap(async (req, res) => send(res, await service.getCustomizationLibrary(listOptions(req))));
const updateProductCustomization = wrap(async (req, res) => send(res, await service.updateProductCustomization(req.params.productId || req.params.id, req.body, actorFromRequest(req))));
const updateProduct = wrap(async (req, res) => send(res, await service.updateProduct(req.params.id, req.body, actorFromRequest(req))));
const bulkUpdateProducts = wrap(async (req, res) => send(res, await service.bulkUpdateProducts(req.body, actorFromRequest(req))));
const updateProductVisibility = wrap(async (req, res) => send(res, await service.updateProductVisibility(req.params.id || req.params.productId, req.body, actorFromRequest(req))));
const deleteProduct = wrap(async (req, res) => send(res, await service.deleteProduct(req.params.id, actorFromRequest(req))));
const reorderProducts = wrap(async (req, res) => send(res, await service.reorderProducts(req.body.items || req.body, actorFromRequest(req))));
const updateProductAvailability = wrap(async (req, res) => {
  if (req.body.branchAvailability !== undefined || req.body.branchIds !== undefined) {
    const body = { branchAvailability: req.body.branchAvailability || req.body.branchIds || [] };
    return send(res, await service.updateProduct(req.params.productId || req.params.id, body, actorFromRequest(req)));
  }
  return send(res, await service.updateProductAvailabilityState(req.params.productId || req.params.id, req.body, actorFromRequest(req)));
});
const listProductGroups = wrap(async (req, res) => send(res, await service.listProductGroups(req.params.productId, listOptions(req))));
const createProductGroup = wrap(async (req, res) => send(res, await service.createProductGroup(req.params.productId, req.body, actorFromRequest(req)), 201));
const updateProductGroup = wrap(async (req, res) => send(res, await service.updateProductGroup(req.params.productId, req.params.groupId, req.body, actorFromRequest(req))));
const updateProductGroupSelectionRules = wrap(async (req, res) => send(res, await service.updateProductGroupSelectionRules(req.params.productId, req.params.groupId, req.body, actorFromRequest(req))));
const updateProductGroupVisibility = wrap(async (req, res) => send(res, await service.updateProductGroupVisibility(req.params.productId, req.params.groupId, req.body, actorFromRequest(req))));
const updateProductGroupAvailability = wrap(async (req, res) => send(res, await service.updateProductGroupAvailability(req.params.productId, req.params.groupId, req.body, actorFromRequest(req))));

const listOptionGroups = wrap(async (req, res) => send(res, await service.listOptionGroups(listOptions(req))));
const createOptionGroup = wrap(async (req, res) => send(res, await service.createOptionGroup(req.body, actorFromRequest(req)), 201));
const getOptionGroup = wrap(async (req, res) => send(res, await service.getOptionGroup(req.params.id, listOptions(req))));
const updateOptionGroup = wrap(async (req, res) => send(res, await service.updateOptionGroup(req.params.id, req.body, actorFromRequest(req))));
const updateOptionGroupVisibility = wrap(async (req, res) => send(res, await service.updateOptionGroupVisibility(req.params.id, req.body, actorFromRequest(req))));
const updateOptionGroupAvailability = wrap(async (req, res) => send(res, await service.updateOptionGroupAvailability(req.params.id, req.body, actorFromRequest(req))));
const deleteOptionGroup = wrap(async (req, res) => send(res, await service.deleteOptionGroup(req.params.id, actorFromRequest(req))));
const reorderOptionGroups = wrap(async (req, res) => send(res, await service.reorderOptionGroups(req.body.items || req.body, actorFromRequest(req))));
const listOptionsByGroup = wrap(async (req, res) => send(res, await service.listOptions({ ...listOptions(req), groupId: req.params.groupId })));
const createOptionForGroup = wrap(async (req, res) => send(res, await service.createOption({ ...req.body, groupId: req.params.groupId }, actorFromRequest(req)), 201));

const listOptionsEndpoint = wrap(async (req, res) => send(res, await service.listOptions(listOptions(req))));
const createOption = wrap(async (req, res) => send(res, await service.createOption(req.body, actorFromRequest(req)), 201));
const getOption = wrap(async (req, res) => send(res, await service.getOption(req.params.id, listOptions(req))));
const updateOption = wrap(async (req, res) => send(res, await service.updateOption(req.params.id, req.body, actorFromRequest(req))));
const updateOptionVisibility = wrap(async (req, res) => send(res, await service.updateOptionVisibility(req.params.id, req.body, actorFromRequest(req))));
const updateOptionAvailability = wrap(async (req, res) => send(res, await service.updateOptionAvailability(req.params.id, req.body, actorFromRequest(req))));
const deleteOption = wrap(async (req, res) => send(res, await service.deleteOption(req.params.id, actorFromRequest(req))));
const reorderOptions = wrap(async (req, res) => send(res, await service.reorderOptions(req.body.items || req.body, actorFromRequest(req))));

const listProductGroupOptions = wrap(async (req, res) => send(res, await service.listProductGroupOptions(req.params.productId, req.params.groupId, listOptions(req))));
const getProductGroupOptionPool = wrap(async (req, res) => send(res, await service.getProductGroupOptionPool(req.params.productId, req.params.groupId, listOptions(req))));
const replaceProductGroupOptions = wrap(async (req, res) => send(res, await service.replaceProductGroupOptions(req.params.productId, req.params.groupId, req.body, actorFromRequest(req))));
const createProductGroupOption = wrap(async (req, res) => send(res, await service.createProductGroupOption(req.params.productId, req.params.groupId, req.body, actorFromRequest(req)), 201));
const updateProductGroupOption = wrap(async (req, res) => {
  const { productId, groupId, optionId } = req.params;
  const allowlist = ["extraPriceHalala", "extraWeightPriceHalala", "extraWeightUnitGrams", "sortOrder", "isActive", "isVisible", "isAvailable"];
  const passed = Object.keys(req.body);
  const invalid = passed.filter(k => !allowlist.includes(k));
  
  if (invalid.length > 0) {
    return errorResponse(
      res,
      400,
      "MENU_VALIDATION_ERROR",
      `الحقول [${invalid.join(", ")}] غير مسموح بتعديلها هنا. استخدمPATCH /menu/options/:optionId للقيم العامة.`,
      { invalidFields: invalid }
    );
  }
  
  send(res, await service.updateProductGroupOption(productId, groupId, optionId, req.body, actorFromRequest(req)));
});
const updateProductGroupOptionVisibility = wrap(async (req, res) => send(res, await service.updateProductGroupOptionVisibility(req.params.productId, req.params.groupId, req.params.optionId, req.body, actorFromRequest(req))));
const updateProductGroupOptionAvailability = wrap(async (req, res) => send(res, await service.updateProductGroupOptionAvailability(req.params.productId, req.params.groupId, req.params.optionId, req.body, actorFromRequest(req))));
const duplicateProduct = wrap(async (req, res) => send(res, await service.duplicateProduct(req.params.id || req.params.productId, actorFromRequest(req)), 201));
const deleteProductGroup = wrap(async (req, res) => send(res, await service.deleteProductGroup(req.params.id || req.params.productId, req.params.groupId, actorFromRequest(req))));
const deleteProductGroupOption = wrap(async (req, res) => send(res, await service.deleteProductGroupOption(req.params.productId, req.params.groupId, req.params.optionId, actorFromRequest(req))));
const toggleOption = wrap(async (req, res) => send(res, await service.toggleOption(req.params.id, actorFromRequest(req))));

const listVersions = wrap(async (req, res) => send(res, await service.listVersions(req.query)));
const rollbackMenu = wrap(async (req, res) => {
  const { versionId } = req.params;
  const actor = actorFromRequest(req);
  
  if (req.body.confirm !== true) {
    return errorResponse(res, 400, "ROLLBACK_CONFIRMATION_REQUIRED", "أرسل confirm: true في الـ body");
  }

  const backupVersion = await service.publishMenu({
    actor,
    notes: `Auto-snapshot before rollback to ${versionId}`,
  });

  const rollback = await service.rollbackMenu(versionId, { confirm: true, actor });

  const restoredVersion = await service.publishMenu({
    actor,
    notes: `Rollback to version ${versionId}`,
  });

  const data = {
    success: true,
    restoredVersion: restoredVersion.id,
    backupVersion: backupVersion.id,
    rollback,
  };

  return res.status(200).json({
    status: true,
    success: true,
    restoredVersion: restoredVersion.id,
    backupVersion: backupVersion.id,
    data,
  });
});
const getDiff = wrap(async (req, res) => send(res, await service.diffMenu()));

const publishMenu = wrap(async (req, res) => send(res, await service.publishMenu({ actor: actorFromRequest(req), notes: req.body.notes })));
const listAuditLogs = wrap(async (req, res) => send(res, await service.listAuditLogs(listOptions(req))));

const validateMenu = wrap(async (req, res) => send(res, await service.validateMenu()));

module.exports = {
  listCategories,
  createCategory,
  getCategory,
  updateCategory,
  updateCategoryVisibility,
  updateCategoryAvailability,
  deleteCategory,
  reorderCategories,
  bulkAssignProductsToCategory,
  listProducts,
  createProduct,
  getProduct,
  getProductComposer,
  getCustomizationLibrary,
  updateProductCustomization,
  updateProduct,
  bulkUpdateProducts,
  updateProductVisibility,
  deleteProduct,
  reorderProducts,
  updateProductAvailability,
  listProductGroups,
  createProductGroup,
  updateProductGroup,
  updateProductGroupSelectionRules,
  updateProductGroupVisibility,
  updateProductGroupAvailability,
  listOptionGroups,
  createOptionGroup,
  getOptionGroup,
  updateOptionGroup,
  updateOptionGroupVisibility,
  updateOptionGroupAvailability,
  deleteOptionGroup,
  reorderOptionGroups,
  listOptionsByGroup,
  createOptionForGroup,
  listOptions: listOptionsEndpoint,
  createOption,
  getOption,
  updateOption,
  updateOptionVisibility,
  updateOptionAvailability,
  deleteOption,
  reorderOptions,
  listProductGroupOptions,
  getProductGroupOptionPool,
  replaceProductGroupOptions,
  createProductGroupOption,
  updateProductGroupOption,
  updateProductGroupOptionVisibility,
  updateProductGroupOptionAvailability,
  duplicateProduct,
  deleteProductGroup,
  deleteProductGroupOption,
  toggleOption,
  listVersions,
  rollbackMenu,
  getDiff,
  publishMenu,
  validateMenu,
  listAuditLogs,
};

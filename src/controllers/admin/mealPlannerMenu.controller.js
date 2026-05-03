const service = require("../../services/admin/mealPlannerMenu.service");
const { writeLog } = require("../../utils/log");

function includeInactive(req) {
  return String(req.query?.includeInactive || "").toLowerCase() === "true";
}

function listOptions(req) {
  return {
    includeInactive: includeInactive(req),
    isActive: req.query?.isActive,
    q: req.query?.q,
  };
}

function sendList(res, data) {
  return res.status(200).json({
    status: true,
    data,
    totalCount: data.length,
  });
}

function sendSingle(res, data, statusCode = 200) {
  return res.status(statusCode).json({
    status: true,
    data,
  });
}

function handleCatalogError(err, res) {
  if (err instanceof service.ValidationError) {
    return res.status(400).json({
      status: false,
      error: "Validation failed",
      details: err.details,
    });
  }

  if (err instanceof service.NotFoundError) {
    return res.status(404).json({
      status: false,
      error: "Item not found",
    });
  }

  if (err && err.code === 11000) {
    return res.status(400).json({
      status: false,
      error: "Validation failed",
      details: ["duplicate key value is not allowed"],
    });
  }

  if (err && err.name === "ValidationError") {
    return res.status(400).json({
      status: false,
      error: "Validation failed",
      details: Object.values(err.errors || {}).map((item) => item.message),
    });
  }

  throw err;
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res);
    } catch (err) {
      try {
        return handleCatalogError(err, res);
      } catch (unhandled) {
        return next(unhandled);
      }
    }
  };
}

async function writeCatalogActivityLog(req, entityType, data, action, meta = {}) {
  const entityId = data && (data._id || data.id);
  if (!entityId || !req.dashboardUserId) return;
  try {
    await writeLog({
      entityType,
      entityId,
      action,
      byUserId: req.dashboardUserId,
      byRole: req.dashboardUserRole,
      meta,
    });
  } catch (_err) {
    // Catalog writes should not fail because audit persistence failed.
  }
}

async function sendLoggedSingle(req, res, { data, statusCode = 200, entityType, action }) {
  await writeCatalogActivityLog(req, entityType, data, action, {
    isActive: data && data.isActive,
    key: data && data.key,
  });
  return sendSingle(res, data, statusCode);
}

const listCategories = wrap(async (req, res) => sendList(res, await service.listCategories(listOptions(req))));
const getCategory = wrap(async (req, res) => sendSingle(res, await service.getCategory(req.params.id)));
const createCategory = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.createCategory(req.body),
  statusCode: 201,
  entityType: "meal_planner_category",
  action: "meal_planner_category_created_by_admin",
}));
const updateCategory = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.updateCategory(req.params.id, req.body),
  entityType: "meal_planner_category",
  action: "meal_planner_category_updated_by_admin",
}));
const toggleCategory = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.toggleCategory(req.params.id),
  entityType: "meal_planner_category",
  action: "meal_planner_category_toggled_by_admin",
}));
const deleteCategory = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.deleteCategory(req.params.id),
  entityType: "meal_planner_category",
  action: "meal_planner_category_soft_deleted_by_admin",
}));

const listProteins = wrap(async (req, res) => sendList(res, await service.listStandardProteins(listOptions(req))));
const getProtein = wrap(async (req, res) => sendSingle(res, await service.getStandardProtein(req.params.id)));
const createProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.createStandardProtein(req.body),
  statusCode: 201,
  entityType: "meal_planner_protein",
  action: "meal_planner_protein_created_by_admin",
}));
const updateProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.updateStandardProtein(req.params.id, req.body),
  entityType: "meal_planner_protein",
  action: "meal_planner_protein_updated_by_admin",
}));
const toggleProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.toggleStandardProtein(req.params.id),
  entityType: "meal_planner_protein",
  action: "meal_planner_protein_toggled_by_admin",
}));
const deleteProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.deleteStandardProtein(req.params.id),
  entityType: "meal_planner_protein",
  action: "meal_planner_protein_soft_deleted_by_admin",
}));

const listPremiumProteins = wrap(async (req, res) => sendList(res, await service.listPremiumProteins(listOptions(req))));
const getPremiumProtein = wrap(async (req, res) => sendSingle(res, await service.getPremiumProtein(req.params.id)));
const createPremiumProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.createPremiumProtein(req.body),
  statusCode: 201,
  entityType: "meal_planner_premium_protein",
  action: "meal_planner_premium_protein_created_by_admin",
}));
const updatePremiumProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.updatePremiumProtein(req.params.id, req.body),
  entityType: "meal_planner_premium_protein",
  action: "meal_planner_premium_protein_updated_by_admin",
}));
const togglePremiumProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.togglePremiumProtein(req.params.id),
  entityType: "meal_planner_premium_protein",
  action: "meal_planner_premium_protein_toggled_by_admin",
}));
const deletePremiumProtein = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.deletePremiumProtein(req.params.id),
  entityType: "meal_planner_premium_protein",
  action: "meal_planner_premium_protein_soft_deleted_by_admin",
}));

const listSandwiches = wrap(async (req, res) => sendList(res, await service.listSandwiches(listOptions(req))));
const getSandwich = wrap(async (req, res) => sendSingle(res, await service.getSandwich(req.params.id)));
const createSandwich = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.createSandwich(req.body),
  statusCode: 201,
  entityType: "meal_planner_sandwich",
  action: "meal_planner_sandwich_created_by_admin",
}));
const updateSandwich = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.updateSandwich(req.params.id, req.body),
  entityType: "meal_planner_sandwich",
  action: "meal_planner_sandwich_updated_by_admin",
}));
const toggleSandwich = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.toggleSandwich(req.params.id),
  entityType: "meal_planner_sandwich",
  action: "meal_planner_sandwich_toggled_by_admin",
}));
const deleteSandwich = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.deleteSandwich(req.params.id),
  entityType: "meal_planner_sandwich",
  action: "meal_planner_sandwich_soft_deleted_by_admin",
}));

const listCarbs = wrap(async (req, res) => sendList(res, await service.listCarbs(listOptions(req))));
const getCarb = wrap(async (req, res) => sendSingle(res, await service.getCarb(req.params.id)));
const createCarb = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.createCarb(req.body),
  statusCode: 201,
  entityType: "meal_planner_carb",
  action: "meal_planner_carb_created_by_admin",
}));
const updateCarb = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.updateCarb(req.params.id, req.body),
  entityType: "meal_planner_carb",
  action: "meal_planner_carb_updated_by_admin",
}));
const toggleCarb = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.toggleCarb(req.params.id),
  entityType: "meal_planner_carb",
  action: "meal_planner_carb_toggled_by_admin",
}));
const deleteCarb = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.deleteCarb(req.params.id),
  entityType: "meal_planner_carb",
  action: "meal_planner_carb_soft_deleted_by_admin",
}));

const listAddons = wrap(async (req, res) => sendList(res, await service.listAddons(listOptions(req))));
const getAddon = wrap(async (req, res) => sendSingle(res, await service.getAddon(req.params.id)));
const createAddon = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.createAddon(req.body),
  statusCode: 201,
  entityType: "meal_planner_addon_item",
  action: "meal_planner_addon_item_created_by_admin",
}));
const updateAddon = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.updateAddon(req.params.id, req.body),
  entityType: "meal_planner_addon_item",
  action: "meal_planner_addon_item_updated_by_admin",
}));
const toggleAddon = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.toggleAddon(req.params.id),
  entityType: "meal_planner_addon_item",
  action: "meal_planner_addon_item_toggled_by_admin",
}));
const deleteAddon = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.deleteAddon(req.params.id),
  entityType: "meal_planner_addon_item",
  action: "meal_planner_addon_item_soft_deleted_by_admin",
}));

const listSaladIngredients = wrap(async (req, res) => sendList(res, await service.listSaladIngredients(listOptions(req))));
const getSaladIngredient = wrap(async (req, res) => sendSingle(res, await service.getSaladIngredient(req.params.id)));
const createSaladIngredient = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.createSaladIngredient(req.body),
  statusCode: 201,
  entityType: "meal_planner_salad_ingredient",
  action: "meal_planner_salad_ingredient_created_by_admin",
}));
const updateSaladIngredient = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.updateSaladIngredient(req.params.id, req.body),
  entityType: "meal_planner_salad_ingredient",
  action: "meal_planner_salad_ingredient_updated_by_admin",
}));
const toggleSaladIngredient = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.toggleSaladIngredient(req.params.id),
  entityType: "meal_planner_salad_ingredient",
  action: "meal_planner_salad_ingredient_toggled_by_admin",
}));
const deleteSaladIngredient = wrap(async (req, res) => sendLoggedSingle(req, res, {
  data: await service.deleteSaladIngredient(req.params.id),
  entityType: "meal_planner_salad_ingredient",
  action: "meal_planner_salad_ingredient_soft_deleted_by_admin",
}));

module.exports = {
  listCategories,
  createCategory,
  getCategory,
  updateCategory,
  toggleCategory,
  deleteCategory,
  listProteins,
  createProtein,
  getProtein,
  updateProtein,
  toggleProtein,
  deleteProtein,
  listPremiumProteins,
  createPremiumProtein,
  getPremiumProtein,
  updatePremiumProtein,
  togglePremiumProtein,
  deletePremiumProtein,
  listSandwiches,
  createSandwich,
  getSandwich,
  updateSandwich,
  toggleSandwich,
  deleteSandwich,
  listCarbs,
  createCarb,
  getCarb,
  updateCarb,
  toggleCarb,
  deleteCarb,
  listAddons,
  createAddon,
  getAddon,
  updateAddon,
  toggleAddon,
  deleteAddon,
  listSaladIngredients,
  createSaladIngredient,
  getSaladIngredient,
  updateSaladIngredient,
  toggleSaladIngredient,
  deleteSaladIngredient,
};

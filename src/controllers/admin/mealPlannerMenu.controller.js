const service = require("../../services/admin/mealPlannerMenu.service");

function includeInactive(req) {
  return String(req.query?.includeInactive || "").toLowerCase() === "true";
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

const listProteins = wrap(async (req, res) => sendList(res, await service.listStandardProteins({ includeInactive: includeInactive(req) })));
const createProtein = wrap(async (req, res) => sendSingle(res, await service.createStandardProtein(req.body), 201));
const updateProtein = wrap(async (req, res) => sendSingle(res, await service.updateStandardProtein(req.params.id, req.body)));
const deleteProtein = wrap(async (req, res) => sendSingle(res, await service.deleteStandardProtein(req.params.id)));

const listPremiumProteins = wrap(async (req, res) => sendList(res, await service.listPremiumProteins({ includeInactive: includeInactive(req) })));
const createPremiumProtein = wrap(async (req, res) => sendSingle(res, await service.createPremiumProtein(req.body), 201));
const updatePremiumProtein = wrap(async (req, res) => sendSingle(res, await service.updatePremiumProtein(req.params.id, req.body)));
const deletePremiumProtein = wrap(async (req, res) => sendSingle(res, await service.deletePremiumProtein(req.params.id)));

const listSandwiches = wrap(async (req, res) => sendList(res, await service.listSandwiches({ includeInactive: includeInactive(req) })));
const createSandwich = wrap(async (req, res) => sendSingle(res, await service.createSandwich(req.body), 201));
const updateSandwich = wrap(async (req, res) => sendSingle(res, await service.updateSandwich(req.params.id, req.body)));
const deleteSandwich = wrap(async (req, res) => sendSingle(res, await service.deleteSandwich(req.params.id)));

const listCarbs = wrap(async (req, res) => sendList(res, await service.listCarbs({ includeInactive: includeInactive(req) })));
const createCarb = wrap(async (req, res) => sendSingle(res, await service.createCarb(req.body), 201));
const updateCarb = wrap(async (req, res) => sendSingle(res, await service.updateCarb(req.params.id, req.body)));
const deleteCarb = wrap(async (req, res) => sendSingle(res, await service.deleteCarb(req.params.id)));

const listAddons = wrap(async (req, res) => sendList(res, await service.listAddons({ includeInactive: includeInactive(req) })));
const createAddon = wrap(async (req, res) => sendSingle(res, await service.createAddon(req.body), 201));
const updateAddon = wrap(async (req, res) => sendSingle(res, await service.updateAddon(req.params.id, req.body)));
const deleteAddon = wrap(async (req, res) => sendSingle(res, await service.deleteAddon(req.params.id)));

const listSaladIngredients = wrap(async (req, res) => sendList(res, await service.listSaladIngredients({ includeInactive: includeInactive(req) })));
const createSaladIngredient = wrap(async (req, res) => sendSingle(res, await service.createSaladIngredient(req.body), 201));
const updateSaladIngredient = wrap(async (req, res) => sendSingle(res, await service.updateSaladIngredient(req.params.id, req.body)));
const deleteSaladIngredient = wrap(async (req, res) => sendSingle(res, await service.deleteSaladIngredient(req.params.id)));

module.exports = {
  listProteins,
  createProtein,
  updateProtein,
  deleteProtein,
  listPremiumProteins,
  createPremiumProtein,
  updatePremiumProtein,
  deletePremiumProtein,
  listSandwiches,
  createSandwich,
  updateSandwich,
  deleteSandwich,
  listCarbs,
  createCarb,
  updateCarb,
  deleteCarb,
  listAddons,
  createAddon,
  updateAddon,
  deleteAddon,
  listSaladIngredients,
  createSaladIngredient,
  updateSaladIngredient,
  deleteSaladIngredient,
};

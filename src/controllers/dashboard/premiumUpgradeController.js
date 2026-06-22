const premiumUpgradeConfigService = require("../../services/subscription/premiumUpgradeConfigService");
const errorResponse = require("../../utils/errorResponse");

function handlePremiumUpgradeError(res, error, next) {
  if (error && error.status && error.code) {
    return errorResponse(res, error.status, error.code, error.message, error.details);
  }
  return next(error);
}

/**
 * @route GET /api/dashboard/premium-upgrades
 * @description Get all premium upgrades with filters
 * @access Admin/Superadmin
 */
async function getConfigs(req, res, next) {
  try {
    const result = await premiumUpgradeConfigService.getConfigs(req.query);
    res.json(result);
  } catch (error) {
    return handlePremiumUpgradeError(res, error, next);
  }
}

/**
 * @route GET /api/dashboard/premium-upgrades/candidates
 * @description Get eligible candidates for premium upgrades
 * @access Admin/Superadmin
 */
async function getCandidates(req, res, next) {
  try {
    const result = await premiumUpgradeConfigService.getCandidates(req.query);
    res.json(result);
  } catch (error) {
    return handlePremiumUpgradeError(res, error, next);
  }
}

/**
 * @route GET /api/dashboard/premium-upgrades/readiness
 * @description Check system readiness for phase 1 migration
 * @access Admin/Superadmin
 */
async function getReadiness(req, res, next) {
  try {
    const result = await premiumUpgradeConfigService.getReadiness();
    res.json(result);
  } catch (error) {
    return handlePremiumUpgradeError(res, error, next);
  }
}

/**
 * @route POST /api/dashboard/premium-upgrades
 * @description Create a premium upgrade config
 * @access Admin/Superadmin
 */
async function createConfig(req, res, next) {
  try {
    const adminId = req.user ? req.user._id : null;
    const result = await premiumUpgradeConfigService.createConfig(req.body, adminId);
    res.status(201).json({ data: result });
  } catch (error) {
    return handlePremiumUpgradeError(res, error, next);
  }
}

/**
 * @route PATCH /api/dashboard/premium-upgrades/:id
 * @description Update a premium upgrade config safe fields
 * @access Admin/Superadmin
 */
async function updateConfig(req, res, next) {
  try {
    const adminId = req.user ? req.user._id : null;
    const result = await premiumUpgradeConfigService.updateConfig(req.params.id, req.body, adminId);
    res.json({ data: result });
  } catch (error) {
    return handlePremiumUpgradeError(res, error, next);
  }
}

/**
 * @route PATCH /api/dashboard/premium-upgrades/:id/state
 * @description Update a premium upgrade config state
 * @access Admin/Superadmin
 */
async function updateConfigState(req, res, next) {
  try {
    const adminId = req.user ? req.user._id : null;
    const result = await premiumUpgradeConfigService.updateConfigState(req.params.id, req.body, adminId);
    res.json({ data: result });
  } catch (error) {
    return handlePremiumUpgradeError(res, error, next);
  }
}

/**
 * @route POST /api/dashboard/premium-upgrades/:id/archive
 * @description Archive a premium upgrade config
 * @access Admin/Superadmin
 */
async function archiveConfig(req, res, next) {
  try {
    const adminId = req.user ? req.user._id : null;
    const result = await premiumUpgradeConfigService.archiveConfig(req.params.id, req.body, adminId);
    res.json({ data: result });
  } catch (error) {
    return handlePremiumUpgradeError(res, error, next);
  }
}

module.exports = {
  getConfigs,
  getCandidates,
  getReadiness,
  createConfig,
  updateConfig,
  updateConfigState,
  archiveConfig
};

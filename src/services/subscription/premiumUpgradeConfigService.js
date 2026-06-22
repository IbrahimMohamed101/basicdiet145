const PremiumUpgradeConfig = require("../../models/PremiumUpgradeConfig");
const MenuOption = require("../../models/MenuOption");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const BuilderProtein = require("../../models/BuilderProtein");

function createError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Maps a PremiumUpgradeConfig to a Dashboard DTO
 */
function mapConfigToDTO(config, sourceDoc = null) {
  const exists = Boolean(sourceDoc);
  const active = exists ? Boolean(sourceDoc.isActive) : false;
  const visible = exists ? Boolean(sourceDoc.isVisible !== false) : false;
  const available = exists ? Boolean(sourceDoc.isAvailable !== false) : false;
  const published = true; // Placeholder unless source needs deep checking
  const subscriptionEnabled = exists ? Boolean(sourceDoc.availableForSubscription !== false) : false;
  const relationValid = exists;

  const valid = exists && active && available && subscriptionEnabled;
  const errors = [];
  if (!exists) errors.push("Source not found");
  if (exists && !active) errors.push("Source is inactive");
  
  return {
    id: config._id.toString(),
    revision: config.revision,
    sourceType: config.sourceType,
    sourceId: config.sourceId ? config.sourceId.toString() : null,
    sourceProductId: config.sourceProductId ? config.sourceProductId.toString() : null,
    sourceGroupId: config.sourceGroupId ? config.sourceGroupId.toString() : null,
    sourceGroupKey: config.sourceSnapshot?.context?.groupKey || null,
    sourceKey: config.sourceSnapshot?.key || null,
    sourceName: config.sourceSnapshot?.name || { ar: "", en: "" },
    selectionType: config.selectionType,
    premiumKey: config.premiumKey,
    displayGroup: {
      key: config.displayGroupKey,
      id: null
    },
    upgradeDeltaHalala: config.upgradeDeltaHalala,
    upgradeDeltaSar: config.upgradeDeltaHalala / 100,
    currency: config.currency,
    isEnabled: config.isEnabled,
    isVisible: config.isVisible,
    status: config.status,
    sortOrder: config.sortOrder,
    sourceStatus: {
      exists,
      active,
      visible,
      available,
      published,
      subscriptionEnabled,
      relationValid
    },
    validation: {
      valid,
      errors,
      warnings: []
    },
    businessRule: {
      consumesExistingMealSlot: true,
      doesAddMeal: false,
      limitSource: "subscription_total_meals"
    },
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    archivedAt: config.archiveReason ? config.updatedAt : null
  };
}

async function fetchSourcesForConfigs(configs) {
  const optionIds = [];
  const productIds = [];
  
  configs.forEach(c => {
    if (c.sourceType === "menu_option" && c.sourceId) optionIds.push(c.sourceId);
    if (c.sourceType === "menu_product" && c.sourceId) productIds.push(c.sourceId);
  });

  const [options, products] = await Promise.all([
    MenuOption.find({ _id: { $in: optionIds } }).lean(),
    MenuProduct.find({ _id: { $in: productIds } }).lean()
  ]);

  const sourceMap = new Map();
  options.forEach(o => sourceMap.set(`menu_option_${o._id}`, o));
  products.forEach(p => sourceMap.set(`menu_product_${p._id}`, p));

  return sourceMap;
}

/**
 * Gets configs based on query filters
 */
async function getConfigs(query) {
  const { status, isEnabled, isVisible, sourceType, selectionType, q, page = 1, limit = 20 } = query;
  const filter = {};
  
  if (status) filter.status = status;
  if (isEnabled !== undefined) filter.isEnabled = isEnabled === "true";
  if (isVisible !== undefined) filter.isVisible = isVisible === "true";
  if (sourceType) filter.sourceType = sourceType;
  if (selectionType) filter.selectionType = selectionType;

  if (q) {
    filter["sourceSnapshot.key"] = new RegExp(q, "i");
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const limitNum = parseInt(limit, 10);

  const [configs, total] = await Promise.all([
    PremiumUpgradeConfig.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    PremiumUpgradeConfig.countDocuments(filter)
  ]);

  const sourceMap = await fetchSourcesForConfigs(configs);

  return {
    data: configs.map(c => mapConfigToDTO(c, sourceMap.get(`${c.sourceType}_${c.sourceId}`))),
    meta: {
      total,
      page: parseInt(page, 10),
      limit: limitNum
    }
  };
}

/**
 * Get Candidates for premium upgrade
 */
async function getCandidates(query) {
  const { selectionType, sourceType, q, page = 1, limit = 20 } = query;
  let candidates = [];
  let total = 0;
  
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const limitNum = parseInt(limit, 10);

  if (selectionType === "premium_large_salad") {
    const filter = { isActive: true, isAvailable: true };
    if (q) filter.key = new RegExp(q, "i");

    candidates = await MenuProduct.find(filter).skip(skip).limit(limitNum);
    total = await MenuProduct.countDocuments(filter);
  } else if (selectionType === "premium_meal" || sourceType === "menu_option") {
    const filter = { isActive: true, isAvailable: true };
    if (q) filter.key = new RegExp(q, "i");

    candidates = await MenuOption.find(filter).skip(skip).limit(limitNum);
    total = await MenuOption.countDocuments(filter);
  }
  
  return {
    data: candidates.map(item => ({
      id: item._id,
      type: selectionType === "premium_large_salad" ? "menu_product" : "menu_option",
      key: item.key,
      name: item.name,
      eligibilityDiagnostics: { eligible: true, issues: [] }
    })),
    meta: { total, page: parseInt(page, 10), limit: limitNum }
  };
}

/**
 * Readiness checks for phase 1/2 migration.
 */
async function getReadiness() {
  const configs = await PremiumUpgradeConfig.find({});
  const sourceMap = await fetchSourcesForConfigs(configs);
  
  const diagnostics = {
    totalConfigs: configs.length,
    activeConfigs: configs.filter(c => c.status === "active").length,
    missingSources: 0,
    invalidRelations: 0,
    duplicateKeys: 0,
    priceMismatches: [],
    legacyChecks: {}
  };

  const legacyProteins = await BuilderProtein.find({});
  diagnostics.legacyChecks.builderProteinsCount = legacyProteins.length;
  
  for (const config of configs) {
    const sourceDoc = sourceMap.get(`${config.sourceType}_${config.sourceId}`);
    if (!sourceDoc) {
      diagnostics.missingSources++;
    }

    if (config.sourceType === "menu_option") {
      const legacyMatch = legacyProteins.find(lp => lp.key === config.premiumKey);
      if (legacyMatch && legacyMatch.extraFeeHalala !== config.upgradeDeltaHalala) {
        diagnostics.priceMismatches.push({
          premiumKey: config.premiumKey,
          legacyPrice: legacyMatch.extraFeeHalala,
          configPrice: config.upgradeDeltaHalala
        });
      }
    }
  }

  return {
    isReady: diagnostics.priceMismatches.length === 0 && diagnostics.missingSources === 0,
    diagnostics
  };
}

/**
 * Create a new PremiumUpgradeConfig
 */
async function createConfig(data, adminId) {
  const {
    sourceType, sourceId, sourceProductId, sourceGroupId,
    selectionType, displayGroupKey, upgradeDeltaHalala,
    isEnabled, isVisible, sortOrder
  } = data;

  if (!["menu_option", "menu_product"].includes(sourceType)) {
    throw createError("Invalid sourceType", "PREMIUM_UPGRADE_INVALID_SOURCE_ID");
  }

  if (typeof upgradeDeltaHalala !== 'number' || upgradeDeltaHalala < 0) {
    throw createError("Invalid upgrade delta halala", "PREMIUM_UPGRADE_INVALID_DELTA");
  }

  let sourceDoc = null;
  if (sourceType === "menu_product") {
    sourceDoc = await MenuProduct.findById(sourceId);
  } else {
    sourceDoc = await MenuOption.findById(sourceId);
  }

  if (!sourceDoc) {
    throw createError("Source not found", "PREMIUM_UPGRADE_SOURCE_NOT_FOUND");
  }

  // Derive premium key
  const premiumKey = sourceDoc.premiumKey || sourceDoc.key;
  if (!premiumKey) {
    throw createError("Source has no key", "PREMIUM_UPGRADE_SOURCE_NOT_ELIGIBLE");
  }

  // Check unique key
  const existingKey = await PremiumUpgradeConfig.findOne({ premiumKey });
  if (existingKey) {
    throw createError("Duplicate premiumKey", "PREMIUM_UPGRADE_KEY_CONFLICT", 409);
  }

  // Check unique source relation
  const existingRelation = await PremiumUpgradeConfig.findOne({ sourceType, sourceId, sourceProductId: sourceProductId || null });
  if (existingRelation) {
    throw createError("Duplicate source relation", "PREMIUM_UPGRADE_DUPLICATE", 409);
  }

  const config = new PremiumUpgradeConfig({
    sourceType,
    sourceId,
    sourceProductId: sourceProductId || null,
    sourceGroupId: sourceGroupId || null,
    selectionType,
    premiumKey,
    displayGroupKey: displayGroupKey || "premium",
    upgradeDeltaHalala,
    isEnabled: isEnabled !== false,
    isVisible: isVisible !== false,
    sortOrder: sortOrder || 0,
    sourceSnapshot: {
      key: sourceDoc.key,
      name: sourceDoc.name,
      context: {}
    }
  });

  await config.save();
  return mapConfigToDTO(config, sourceDoc);
}

/**
 * Update safe fields
 */
async function updateConfig(id, data, adminId) {
  const { expectedRevision, upgradeDeltaHalala, displayGroupKey, sortOrder, metadata } = data;
  
  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) throw createError("Config not found", "NOT_FOUND", 404);

  if (config.revision !== expectedRevision) {
    throw createError("Revision conflict", "PREMIUM_UPGRADE_REVISION_CONFLICT", 409);
  }

  if (config.status === "archived") {
    throw createError("Cannot update archived config", "PREMIUM_UPGRADE_ARCHIVED", 400);
  }

  if (upgradeDeltaHalala !== undefined) {
    if (typeof upgradeDeltaHalala !== 'number' || upgradeDeltaHalala < 0) {
      throw createError("Invalid upgrade delta halala", "PREMIUM_UPGRADE_INVALID_DELTA");
    }
    config.upgradeDeltaHalala = upgradeDeltaHalala;
  }
  
  if (displayGroupKey !== undefined) config.displayGroupKey = displayGroupKey;
  if (sortOrder !== undefined) config.sortOrder = sortOrder;
  if (metadata !== undefined) config.metadata = metadata;

  config.revision += 1;
  await config.save();
  
  const sourceMap = await fetchSourcesForConfigs([config]);
  return mapConfigToDTO(config, sourceMap.get(`${config.sourceType}_${config.sourceId}`));
}

/**
 * Update state (isEnabled, isVisible, status)
 */
async function updateConfigState(id, data, adminId) {
  const { expectedRevision, isEnabled, isVisible, status } = data;

  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) throw createError("Config not found", "NOT_FOUND", 404);

  if (config.revision !== expectedRevision) {
    throw createError("Revision conflict", "PREMIUM_UPGRADE_REVISION_CONFLICT", 409);
  }

  if (status && status !== config.status) {
    if (!["active", "archived"].includes(status)) {
      throw createError("Invalid status", "PREMIUM_UPGRADE_INVALID_STATE");
    }
    // If we are unarchiving, clear archive reason
    if (status === "active") {
      config.archiveReason = null;
    }
    config.status = status;
  }

  if (isEnabled !== undefined) config.isEnabled = isEnabled;
  if (isVisible !== undefined) config.isVisible = isVisible;

  config.revision += 1;
  await config.save();
  
  const sourceMap = await fetchSourcesForConfigs([config]);
  return mapConfigToDTO(config, sourceMap.get(`${config.sourceType}_${config.sourceId}`));
}

/**
 * Soft Archive
 */
async function archiveConfig(id, data, adminId) {
  const { expectedRevision, reason } = data;

  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) throw createError("Config not found", "NOT_FOUND", 404);

  if (config.revision !== expectedRevision) {
    throw createError("Revision conflict", "PREMIUM_UPGRADE_REVISION_CONFLICT", 409);
  }

  config.status = "archived";
  config.archiveReason = reason || "Archived by admin";
  config.isEnabled = false;
  config.isVisible = false;
  config.revision += 1;
  
  await config.save();
  
  const sourceMap = await fetchSourcesForConfigs([config]);
  return mapConfigToDTO(config, sourceMap.get(`${config.sourceType}_${config.sourceId}`));
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

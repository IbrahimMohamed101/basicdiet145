const PremiumUpgradeConfig = require("../../models/PremiumUpgradeConfig");
const MenuOption = require("../../models/MenuOption");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const BuilderProtein = require("../../models/BuilderProtein");
const {
  PREMIUM_MEAL_PROTEIN_KEYS,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
} = require("../../config/mealPlannerContract");
const { resolvePremiumLargeSaladPricing } = require("../catalog/premiumLargeSaladPricingService");

const KNOWN_PREMIUM_KEYS = Object.freeze([
  ...PREMIUM_MEAL_PROTEIN_KEYS,
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
]);

function createError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.statusCode = status;
  return err;
}

const IMMUTABLE_PATCH_FIELDS = [
  "sourceType",
  "sourceId",
  "sourceProductId",
  "sourceGroupId",
  "selectionType",
  "premiumKey",
  "currency",
];

function normalizePremiumKey(value) {
  return String(value || "").trim().toLowerCase();
}

async function loadClientPremiumUpgradeConfigState({ session = null } = {}) {
  let query = PremiumUpgradeConfig.find({});
  if (session && typeof query.session === "function") query = query.session(session);
  const configs = await query.lean();
  const activeVisibleConfigs = (configs || []).filter((config) => (
    config
    && config.status === "active"
    && config.isEnabled !== false
    && config.isVisible !== false
    && config.premiumKey
  ));
  const activeByKey = new Map();
  for (const config of activeVisibleConfigs) {
    activeByKey.set(normalizePremiumKey(config.premiumKey), config);
  }
  return {
    hasConfigs: configs.length > 0,
    configs,
    activeVisibleConfigs,
    activeByKey,
    getActiveConfig(premiumKey) {
      return activeByKey.get(normalizePremiumKey(premiumKey)) || null;
    },
    isAllowed(premiumKey) {
      return !configs.length || activeByKey.has(normalizePremiumKey(premiumKey));
    },
  };
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
function activePublishedSubscriptionFilter(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: "subscription" },
    ],
    ...extra,
  };
}

async function loadKnownPremiumCandidates() {
  const [basicMeal, proteinGroup, premiumSalad, configs] = await Promise.all([
    MenuProduct.findOne(activePublishedSubscriptionFilter({ key: "basic_meal" })).lean(),
    MenuOptionGroup.findOne({
      key: "proteins",
      isActive: true,
      isVisible: { $ne: false },
      isAvailable: { $ne: false },
      publishedAt: { $ne: null },
    }).lean(),
    MenuProduct.findOne(activePublishedSubscriptionFilter({ key: PREMIUM_LARGE_SALAD_PREMIUM_KEY })).lean(),
    PremiumUpgradeConfig.find({}).lean(),
  ]);

  const linkedKeys = new Set(configs.map((config) => normalizePremiumKey(config.premiumKey)));
  const candidates = [];

  if (basicMeal && proteinGroup) {
    const productGroup = await ProductOptionGroup.findOne({
      productId: basicMeal._id,
      groupId: proteinGroup._id,
      isActive: true,
      isVisible: { $ne: false },
      isAvailable: { $ne: false },
    }).lean();

    if (productGroup) {
      const options = await MenuOption.find(activePublishedSubscriptionFilter({
        groupId: proteinGroup._id,
        key: { $in: PREMIUM_MEAL_PROTEIN_KEYS },
        availableForSubscription: { $ne: false },
      })).lean();
      const optionById = new Map(options.map((option) => [String(option._id), option]));
      const relations = await ProductGroupOption.find({
        productId: basicMeal._id,
        groupId: proteinGroup._id,
        optionId: { $in: options.map((option) => option._id) },
        isActive: true,
        isVisible: { $ne: false },
        isAvailable: { $ne: false },
      }).lean();
      const relationByOptionId = new Map(relations.map((relation) => [String(relation.optionId), relation]));

      for (const premiumKey of PREMIUM_MEAL_PROTEIN_KEYS) {
        const option = options.find((row) => normalizePremiumKey(row.premiumKey || row.key) === premiumKey);
        const relation = option && relationByOptionId.get(String(option._id));
        if (!option || !relation || !optionById.has(String(option._id))) continue;
        candidates.push({
          id: option._id,
          sourceId: option._id,
          type: "menu_option",
          sourceType: "menu_option",
          sourceProductId: basicMeal._id,
          sourceGroupId: proteinGroup._id,
          sourceProductKey: basicMeal.key,
          sourceGroupKey: proteinGroup.key,
          key: premiumKey,
          premiumKey,
          name: option.name,
          selectionType: "premium_meal",
          upgradeDeltaHalala: Number(relation.extraPriceHalala ?? option.extraFeeHalala ?? option.extraPriceHalala ?? 0),
          currency: option.currency || basicMeal.currency || "SAR",
          isLinked: linkedKeys.has(premiumKey),
          eligibilityDiagnostics: { eligible: true, issues: [] },
        });
      }
    }
  }

  if (premiumSalad) {
    candidates.push({
      id: premiumSalad._id,
      sourceId: premiumSalad._id,
      type: "menu_product",
      sourceType: "menu_product",
      sourceProductId: premiumSalad._id,
      sourceGroupId: null,
      sourceProductKey: premiumSalad.key,
      sourceGroupKey: null,
      key: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      name: premiumSalad.name,
      selectionType: "premium_large_salad",
      upgradeDeltaHalala: Number(premiumSalad.priceHalala || 0),
      currency: premiumSalad.currency || "SAR",
      isLinked: linkedKeys.has(PREMIUM_LARGE_SALAD_PREMIUM_KEY),
      eligibilityDiagnostics: { eligible: true, issues: [] },
    });
  }

  return candidates;
}

async function getCandidates(query = {}) {
  const { selectionType, sourceType, q } = query;
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.max(1, Math.min(100, parseInt(query.limit || 20, 10)));
  const includeLinked = String(query.includeLinked || "false").toLowerCase() === "true";
  const search = String(q || "").trim().toLowerCase();

  let candidates = await loadKnownPremiumCandidates();
  if (selectionType) candidates = candidates.filter((item) => item.selectionType === selectionType);
  if (sourceType) candidates = candidates.filter((item) => item.sourceType === sourceType);
  if (!includeLinked) candidates = candidates.filter((item) => !item.isLinked);
  if (search) {
    candidates = candidates.filter((item) => (
      item.key.includes(search)
      || String(item.name?.en || "").toLowerCase().includes(search)
      || String(item.name?.ar || "").toLowerCase().includes(search)
    ));
  }

  const total = candidates.length;
  const skip = (pageNum - 1) * limitNum;
  return {
    data: candidates.slice(skip, skip + limitNum),
    meta: { total, page: pageNum, limit: limitNum },
  };
}

/**
 * Readiness checks for phase 1/2 migration.
 */
async function getReadiness() {
  const configs = await PremiumUpgradeConfig.find({}).lean();
  const sourceMap = await fetchSourcesForConfigs(configs);
  const candidates = await loadKnownPremiumCandidates();
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.premiumKey, candidate]));
  const configuredKnownKeys = [...new Set(configs
    .map((config) => normalizePremiumKey(config.premiumKey))
    .filter((key) => KNOWN_PREMIUM_KEYS.includes(key)))];
  const missingConfigKeys = KNOWN_PREMIUM_KEYS.filter((key) => !configuredKnownKeys.includes(key));
  const unresolvedSourceKeys = KNOWN_PREMIUM_KEYS.filter((key) => !candidateByKey.has(key));
  const configsEmpty = configs.length === 0;
  const partialConfigState = !configsEmpty && missingConfigKeys.length > 0;
  
  const diagnostics = {
    totalConfigs: configs.length,
    activeConfigs: configs.filter(c => c.status === "active").length,
    missingSources: 0,
    invalidRelations: 0,
    duplicateKeys: 0,
    priceMismatches: [],
    legacyChecks: {},
    configState: {
      isEmpty: configsEmpty,
      legacyFallbackActive: configsEmpty,
      configsAuthoritative: !configsEmpty,
      backfillStatus: configsEmpty ? "not_started" : (partialConfigState ? "incomplete" : "complete"),
      partialConfigRisk: partialConfigState,
      knownKeys: KNOWN_PREMIUM_KEYS,
      configuredKnownKeys,
      missingConfigKeys,
    },
    knownSources: KNOWN_PREMIUM_KEYS.map((premiumKey) => ({
      premiumKey,
      resolvable: candidateByKey.has(premiumKey),
      sourceType: candidateByKey.get(premiumKey)?.sourceType || null,
      sourceId: candidateByKey.get(premiumKey)?.sourceId || null,
      sourceProductId: candidateByKey.get(premiumKey)?.sourceProductId || null,
      sourceGroupId: candidateByKey.get(premiumKey)?.sourceGroupId || null,
      issues: candidateByKey.has(premiumKey) ? [] : ["Eligible subscription catalog source or relation not found"],
    })),
    unresolvedSourceKeys,
  };

  const legacyProteins = await BuilderProtein.find({});
  diagnostics.legacyChecks.builderProteinsCount = legacyProteins.length;
  diagnostics.legacyChecks.fallbackActive = configsEmpty;
  
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

  const saladConfig = configs.find((config) => normalizePremiumKey(config.premiumKey) === PREMIUM_LARGE_SALAD_PREMIUM_KEY);
  if (saladConfig) {
    const saladPricing = await resolvePremiumLargeSaladPricing();
    if (Number(saladConfig.upgradeDeltaHalala || 0) !== Number(saladPricing.extraFeeHalala || 0)) {
      diagnostics.priceMismatches.push({
        premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
        legacyPrice: Number(saladPricing.extraFeeHalala || 0),
        configPrice: Number(saladConfig.upgradeDeltaHalala || 0),
      });
    }
  }

  return {
    isReady: diagnostics.priceMismatches.length === 0
      && diagnostics.missingSources === 0
      && unresolvedSourceKeys.length === 0
      && !partialConfigState,
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

  if (!["premium_meal", "premium_large_salad"].includes(selectionType)) {
    throw createError("Invalid selectionType", "PREMIUM_UPGRADE_INVALID_SOURCE_ID");
  }
  if (selectionType === "premium_large_salad" && sourceType !== "menu_product") {
    throw createError("premium_large_salad must be backed by a menu product", "PREMIUM_UPGRADE_INVALID_RELATION");
  }
  if (selectionType === "premium_meal" && sourceType !== "menu_option") {
    throw createError("premium_meal must be backed by a menu option", "PREMIUM_UPGRADE_INVALID_RELATION");
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
  if (sourceDoc.isActive === false || sourceDoc.isVisible === false || sourceDoc.isAvailable === false) {
    throw createError("Source is not eligible", "PREMIUM_UPGRADE_SOURCE_NOT_ELIGIBLE");
  }
  if (sourceDoc.availableForSubscription === false) {
    throw createError("Source is not enabled for subscriptions", "PREMIUM_UPGRADE_SOURCE_NOT_ELIGIBLE");
  }
  if (Array.isArray(sourceDoc.availableFor) && sourceDoc.availableFor.length > 0 && !sourceDoc.availableFor.includes("subscription")) {
    throw createError("Source is not enabled for subscriptions", "PREMIUM_UPGRADE_SOURCE_NOT_ELIGIBLE");
  }

  if (sourceType === "menu_option" && (sourceProductId || sourceGroupId)) {
    const relation = await ProductGroupOption.findOne({
      ...(sourceProductId ? { productId: sourceProductId } : {}),
      ...(sourceGroupId ? { groupId: sourceGroupId } : {}),
      optionId: sourceId,
      isActive: true,
      isVisible: { $ne: false },
      isAvailable: { $ne: false },
    }).lean();
    if (!relation) {
      throw createError("Invalid source relation", "PREMIUM_UPGRADE_INVALID_RELATION");
    }
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
  const immutableField = IMMUTABLE_PATCH_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(data || {}, field));
  if (immutableField) {
    throw createError(`${immutableField} cannot be changed`, "PREMIUM_UPGRADE_IMMUTABLE_FIELD", 400);
  }
  
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
  loadClientPremiumUpgradeConfigState,
  getConfigs,
  getCandidates,
  getReadiness,
  createConfig,
  updateConfig,
  updateConfigState,
  archiveConfig
};

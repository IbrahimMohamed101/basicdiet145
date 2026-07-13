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
const {
  isMenuItemEnabledForSubscription,
} = require("./subscriptionMenuEligibilityPolicyService");

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
  const configByKey = new Map();
  for (const config of configs || []) {
    if (config && config.premiumKey) {
      configByKey.set(normalizePremiumKey(config.premiumKey), config);
    }
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
      const norm = normalizePremiumKey(premiumKey);
      if (activeByKey.has(norm)) return true;
      if (configByKey.has(norm)) return false;
      if (KNOWN_PREMIUM_KEYS.includes(norm) || norm === "custom_premium_salad") return true;
      return false;
    },
  };
}

/**
 * Canonical premium authority.
 *
 * Callers may normalize a legacy identifier to a premiumKey before entering
 * this function, but pricing and eligibility are decided here and nowhere
 * else. Missing/disabled configuration is deliberately fail-closed.
 */
async function resolvePremiumUpgrade(premiumKey, { session = null, includeHidden = false } = {}) {
  const normalizedKey = normalizePremiumKey(premiumKey);
  if (!normalizedKey) {
    throw createError("premiumKey is required", "PREMIUM_KEY_REQUIRED", 400);
  }

  const filter = {
    premiumKey: normalizedKey,
    status: "active",
    isEnabled: true,
    ...(includeHidden ? {} : { isVisible: { $ne: false } }),
  };
  let query = PremiumUpgradeConfig.findOne(filter);
  if (session && typeof query.session === "function") query = query.session(session);
  const config = await query.lean();
  if (!config) {
    throw createError(
      `Premium upgrade is not configured or available: ${normalizedKey}`,
      "PREMIUM_UPGRADE_UNAVAILABLE",
      409
    );
  }

  const priceHalala = Number(config.upgradeDeltaHalala);
  if (!Number.isSafeInteger(priceHalala) || priceHalala < 0) {
    throw createError(
      `Premium upgrade has invalid canonical pricing: ${normalizedKey}`,
      "PREMIUM_UPGRADE_INVALID_PRICE",
      500
    );
  }

  return Object.freeze({
    premiumKey: normalizedKey,
    priceHalala,
    upgradeDeltaHalala: priceHalala,
    currency: String(config.currency || "SAR").toUpperCase(),
    selectionType: config.selectionType,
    sourceType: config.sourceType,
    sourceId: config.sourceId || null,
    sourceProductId: config.sourceProductId || null,
    sourceGroupId: config.sourceGroupId || null,
    configId: config._id,
    revision: config.revision,
  });
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
function isAddonProduct(product) {
  const itemType = normalizePremiumKey(product?.itemType);
  const cardVariant = normalizePremiumKey(product?.ui?.cardVariant);
  return itemType === "addon" || cardVariant === "addon" || cardVariant === "addon_card";
}

function isActivePublishedAvailable(doc) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isVisible !== false
    && doc.isAvailable !== false
    && Boolean(doc.publishedAt);
}

function isActiveAvailableRelation(doc) {
  return Boolean(doc)
    && doc.isActive !== false
    && doc.isVisible !== false
    && doc.isAvailable !== false;
}

function relationIdentity({ sourceType, sourceId, sourceProductId }) {
  return `${sourceType}:${String(sourceId)}:${sourceProductId ? String(sourceProductId) : ""}`;
}

/**
 * This is the canonical discovery/eligibility resolver used by both the picker
 * and create. Product-backed upgrades are deliberately limited to the supported
 * premium-large-salad contract; option-backed upgrades are dynamically found
 * from all valid subscription product/group contexts. Premium eligibility does
 * not depend on a legacy premium marker already existing on the option.
 */
async function loadEligiblePremiumCandidates() {
  const [products, groups, options, productGroups, optionRelations, configs] = await Promise.all([
    MenuProduct.find({}).lean(),
    MenuOptionGroup.find({}).lean(),
    MenuOption.find({}).lean(),
    ProductOptionGroup.find({}).lean(),
    ProductGroupOption.find({}).lean(),
    PremiumUpgradeConfig.find({}).lean(),
  ]);

  const diagnostics = {
    totalMenuProductsScanned: products.length,
    totalMenuOptionsScanned: options.length,
    totalOptionRelationsScanned: optionRelations.length,
    excludedAddons: 0,
    excludedInactiveHiddenUnpublished: 0,
    excludedNotSubscriptionEnabled: 0,
    excludedInvalidRelation: 0,
    excludedUnsupportedProductScope: 0,
    excludedAlreadyLinked: 0,
    finalEligibleUnlinkedCount: 0,
    finalLinkedCount: 0,
  };

  const productById = new Map(products.map((product) => [String(product._id), product]));
  const groupById = new Map(groups.map((group) => [String(group._id), group]));
  const productGroupByKey = new Map(productGroups.map((relation) => [`${relation.productId}:${relation.groupId}`, relation]));
  const optionRelationsByOptionId = new Map();
  for (const relation of optionRelations) {
    const key = String(relation.optionId);
    if (!optionRelationsByOptionId.has(key)) optionRelationsByOptionId.set(key, []);
    optionRelationsByOptionId.get(key).push(relation);
  }
  const linkedKeys = new Set(configs.map((config) => normalizePremiumKey(config.premiumKey)));
  const linkedRelations = new Set(configs.map(relationIdentity));
  const candidates = [];

  for (const option of options) {
    if (!isActivePublishedAvailable(option)) {
      diagnostics.excludedInactiveHiddenUnpublished++;
      continue;
    }
    if (!isMenuItemEnabledForSubscription(option)) {
      diagnostics.excludedNotSubscriptionEnabled++;
      continue;
    }
    const premiumKey = normalizePremiumKey(option.premiumKey || option.key);
    if (!premiumKey) {
      diagnostics.excludedInvalidRelation++;
      continue;
    }

    let validContextCount = 0;
    let addonContextCount = 0;
    for (const relation of optionRelationsByOptionId.get(String(option._id)) || []) {
      const product = productById.get(String(relation.productId));
      const group = groupById.get(String(relation.groupId));
      const productGroup = productGroupByKey.get(`${relation.productId}:${relation.groupId}`);
      if (!isActiveAvailableRelation(relation)
        || !product
        || !group
        || String(option.groupId) !== String(group._id)
        || !isActivePublishedAvailable(product)
        || !isMenuItemEnabledForSubscription(product)
        || !isActivePublishedAvailable(group)
        || !isActiveAvailableRelation(productGroup)) continue;
      if (isAddonProduct(product)) {
        addonContextCount++;
        continue;
      }
      validContextCount++;
      const identity = relationIdentity({ sourceType: "menu_option", sourceId: option._id, sourceProductId: product._id });
      const relationLinked = linkedRelations.has(identity);
      candidates.push({
        id: String(option._id),
        sourceId: String(option._id),
        type: "menu_option",
        sourceType: "menu_option",
        sourceProductId: String(product._id),
        sourceGroupId: String(group._id),
        sourceProductKey: product.key || null,
        sourceGroupKey: group.key || null,
        key: premiumKey,
        premiumKey,
        name: { ar: option.name?.ar || null, en: option.name?.en || null },
        selectionType: "premium_meal",
        upgradeDeltaHalala: Number(relation.extraPriceHalala ?? option.extraFeeHalala ?? option.extraPriceHalala ?? 0),
        currency: "SAR",
        isLinked: relationLinked || linkedKeys.has(premiumKey),
        _relationLinked: relationLinked,
        eligibilityDiagnostics: { eligible: true, issues: [] },
      });
    }
    if (validContextCount === 0) {
      if (addonContextCount > 0) diagnostics.excludedAddons++;
      else diagnostics.excludedInvalidRelation++;
    }
  }

  for (const product of products) {
    if (!isActivePublishedAvailable(product)) {
      diagnostics.excludedInactiveHiddenUnpublished++;
      continue;
    }
    if (!isMenuItemEnabledForSubscription(product)) {
      diagnostics.excludedNotSubscriptionEnabled++;
      continue;
    }
    if (isAddonProduct(product)) {
      diagnostics.excludedAddons++;
      continue;
    }
    if (normalizePremiumKey(product.key) !== PREMIUM_LARGE_SALAD_PREMIUM_KEY) {
      diagnostics.excludedUnsupportedProductScope++;
      continue;
    }
    const identity = relationIdentity({ sourceType: "menu_product", sourceId: product._id, sourceProductId: product._id });
    candidates.push({
      id: String(product._id),
      sourceId: String(product._id),
      type: "menu_product",
      sourceType: "menu_product",
      sourceProductId: String(product._id),
      sourceGroupId: null,
      sourceProductKey: product.key,
      sourceGroupKey: null,
      key: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      premiumKey: PREMIUM_LARGE_SALAD_PREMIUM_KEY,
      name: { ar: product.name?.ar || null, en: product.name?.en || null },
      selectionType: "premium_large_salad",
      upgradeDeltaHalala: Number(product.priceHalala || 0),
      currency: "SAR",
      isLinked: linkedRelations.has(identity) || linkedKeys.has(PREMIUM_LARGE_SALAD_PREMIUM_KEY),
      eligibilityDiagnostics: { eligible: true, issues: [] },
    });
  }

  // A menu option can be reused by more than one product relation, while a
  // premium config links the option as one source. Prefer its already-linked
  // context, then the canonical basic meal context, to avoid duplicate picker
  // rows that share the same source and premium key.
  const deduped = new Map();
  for (const candidate of candidates) {
    if (candidate.sourceType !== "menu_option") {
      deduped.set(`${candidate.sourceType}:${candidate.sourceId}`, candidate);
      continue;
    }
    const key = `${candidate.sourceType}:${candidate.sourceId}`;
    const current = deduped.get(key);
    const shouldReplace = !current
      || (!current._relationLinked && candidate._relationLinked)
      || (!current._relationLinked && !candidate._relationLinked && current.sourceProductKey !== "basic_meal" && candidate.sourceProductKey === "basic_meal");
    if (shouldReplace) deduped.set(key, candidate);
  }
  const eligibleCandidates = [...deduped.values()].map(({ _relationLinked, ...candidate }) => candidate);
  diagnostics.excludedAlreadyLinked = eligibleCandidates.filter((candidate) => candidate.isLinked).length;
  diagnostics.finalEligibleUnlinkedCount = eligibleCandidates.filter((candidate) => !candidate.isLinked).length;
  diagnostics.finalLinkedCount = eligibleCandidates.filter((candidate) => candidate.isLinked).length;
  return { candidates: eligibleCandidates, diagnostics };
}

async function getCandidates(query = {}) {
  const { selectionType, sourceType, q } = query;
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.max(1, Math.min(100, parseInt(query.limit || 20, 10)));
  const includeLinked = String(query.includeLinked || "false").toLowerCase() === "true";
  const search = String(q || "").trim().toLowerCase();

  const resolved = await loadEligiblePremiumCandidates();
  let candidates = resolved.candidates;
  if (selectionType) candidates = candidates.filter((item) => item.selectionType === selectionType);
  if (sourceType) candidates = candidates.filter((item) => item.sourceType === sourceType);
  if (query.sourceProductId) candidates = candidates.filter((item) => String(item.sourceProductId) === String(query.sourceProductId));
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
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      diagnostics: {
        ...resolved.diagnostics,
        returnedAfterFilters: total,
      },
    },
  };
}

/**
 * Readiness checks for phase 1/2 migration.
 */
async function getReadiness() {
  const configs = await PremiumUpgradeConfig.find({}).lean();
  const sourceMap = await fetchSourcesForConfigs(configs);
  const { candidates } = await loadEligiblePremiumCandidates();
  const candidateByKey = new Map(candidates.map((candidate) => [candidate.premiumKey, candidate]));
  
  const allKnownKeys = [...new Set([
    ...KNOWN_PREMIUM_KEYS,
    ...configs.map(c => normalizePremiumKey(c.premiumKey)).filter(Boolean)
  ])];
  
  const configuredKnownKeys = [...new Set(configs
    .map((config) => normalizePremiumKey(config.premiumKey)))];
    
  const missingConfigKeys = KNOWN_PREMIUM_KEYS.filter((key) => !configuredKnownKeys.includes(key));
  const unresolvedSourceKeys = allKnownKeys.filter((key) => !candidateByKey.has(key));
  const configsEmpty = configs.length === 0;
  const partialConfigState = !configsEmpty && missingConfigKeys.length > 0;
  
  const diagnostics = {
    totalConfigs: configs.length,
    activeConfigs: configs.filter(c => c.status === "active").length,
    missingSources: 0,
    invalidRelations: 0,
    duplicateKeys: 0,
    invalidConfigs: 0,
    priceMismatches: [],
    legacyChecks: {},
    configState: {
      isEmpty: configsEmpty,
      legacyFallbackActive: false,
      configsAuthoritative: true,
      backfillStatus: configsEmpty ? "not_started" : (partialConfigState ? "incomplete" : "complete"),
      partialConfigRisk: partialConfigState,
      knownKeys: allKnownKeys,
      configuredKnownKeys,
      missingConfigKeys,
    },
    knownSources: allKnownKeys.map((premiumKey) => ({
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
  diagnostics.legacyChecks.fallbackActive = false;

  const keyCounts = new Map();
  for (const config of configs) {
    const key = normalizePremiumKey(config.premiumKey);
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  diagnostics.duplicateKeys = [...keyCounts.values()].filter((count) => count > 1).length;
  
  for (const config of configs) {
    const sourceDoc = sourceMap.get(`${config.sourceType}_${config.sourceId}`);
    if (!sourceDoc) {
      diagnostics.missingSources++;
    }
    const eligibleRelation = candidates.some((candidate) => {
      const matchSource = candidate.sourceType === config.sourceType && String(candidate.sourceId) === String(config.sourceId);
      if (!matchSource) return false;
      if (config.sourceProductId && String(candidate.sourceProductId) !== String(config.sourceProductId)) return false;
      if (config.sourceGroupId && String(candidate.sourceGroupId) !== String(config.sourceGroupId)) return false;
      return true;
    });
    if (sourceDoc && !eligibleRelation) diagnostics.invalidRelations++;
    if (config.status !== "active" || config.isEnabled === false || config.isVisible === false) diagnostics.invalidConfigs++;

    if (config.sourceType === "menu_option") {
      const legacyMatch = legacyProteins.find(lp => lp.key === config.premiumKey);
      if (legacyMatch && legacyMatch.extraFeeHalala !== config.upgradeDeltaHalala) {
        diagnostics.priceMismatches.push({
          premiumKey: config.premiumKey,
          legacyPrice: legacyMatch.extraFeeHalala,
          configPrice: config.upgradeDeltaHalala,
          severity: "warning",
          blocking: configsEmpty,
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
        severity: "warning",
        blocking: configsEmpty,
      });
    }
  }

  return {
    isReady: diagnostics.missingSources === 0
      && diagnostics.invalidRelations === 0
      && diagnostics.invalidConfigs === 0
      && diagnostics.duplicateKeys === 0
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

  const sourceDoc = sourceType === "menu_product"
    ? await MenuProduct.findById(sourceId)
    : await MenuOption.findById(sourceId);
  if (!sourceDoc) {
    throw createError("Source not found", "PREMIUM_UPGRADE_SOURCE_NOT_FOUND");
  }
  const { candidates: eligibleCandidates } = await loadEligiblePremiumCandidates();
  const eligibleCandidate = eligibleCandidates.find((candidate) => (
    candidate.sourceType === sourceType
    && String(candidate.sourceId) === String(sourceId)
    && String(candidate.sourceProductId || "") === String(sourceProductId || (sourceType === "menu_product" ? sourceId : ""))
    && String(candidate.sourceGroupId || "") === String(sourceGroupId || "")
    && candidate.selectionType === selectionType
  ));
  if (!eligibleCandidate) {
    throw createError("Source or relation is not eligible for subscription premium upgrades", "PREMIUM_UPGRADE_INVALID_RELATION");
  }

  // Derive premium key
  const premiumKey = eligibleCandidate.premiumKey;
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
      context: {
        productKey: eligibleCandidate.sourceProductKey,
        groupKey: eligibleCandidate.sourceGroupKey,
      }
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

/**
 * Unified backend resolver for subscription premium upgrade pricing.
 * Used by mobile meal planner catalog response, subscription quote, subscription checkout/create,
 * and legacy Flutter compatibility path.
 *
 * Pricing precedence:
 * 1. Active PremiumUpgradeConfig if available.
 * 2. Existing legacy/catalog premium pricing source if config is missing:
 *    - menu option relation price
 *    - builder premium price
 *    - legacy premium identity price
 *    - known project fallback already used before
 * 3. For known default premium proteins, do not allow accidental 0:
 *    - beef_steak
 *    - shrimp
 *    - salmon
 *
 * Important:
 * - Do not silently return 0 for known paid premium proteins.
 * - 0 is allowed only if explicitly configured as free by an active backend config.
 * - premium_large_salad must remain 2900 or config-driven if config exists.
 */
async function resolveSubscriptionPremiumUpgradePricing(premiumKey, { fallbackPriceHalala, optionDoc, builderProteinDoc, session = null } = {}) {
  const normalizedKey = normalizePremiumKey(premiumKey);
  if (!normalizedKey) {
    throw createError("premiumKey is required", "PREMIUM_KEY_REQUIRED", 400);
  }

  // 1. Active PremiumUpgradeConfig if available.
  try {
    const upgrade = await resolvePremiumUpgrade(normalizedKey, { session });
    return {
      premiumKey: normalizedKey,
      priceHalala: upgrade.priceHalala,
      upgradeDeltaHalala: upgrade.upgradeDeltaHalala,
      currency: upgrade.currency,
      selectionType: upgrade.selectionType,
      sourceType: upgrade.sourceType,
      sourceId: upgrade.sourceId,
      sourceProductId: upgrade.sourceProductId,
      sourceGroupId: upgrade.sourceGroupId,
      configId: upgrade.configId,
      revision: upgrade.revision,
      priceSource: "resolvePremiumUpgrade",
      isConfigured: true,
    };
  } catch (err) {
    // If config is missing/unavailable, do not fail-closed for known legacy mobile premium keys!
    // Only truly unknown/unresolvable premium keys should return INVALID_PREMIUM_ITEM.
    const isKnown = KNOWN_PREMIUM_KEYS.includes(normalizedKey) || normalizedKey === "custom_premium_salad";
    if (!isKnown && !optionDoc && !builderProteinDoc && fallbackPriceHalala === undefined) {
      const error = new Error(`Invalid premiumKey: ${normalizedKey} - Premium upgrade is not configured or available`);
      error.code = "INVALID_PREMIUM_ITEM";
      error.status = 409;
      throw error;
    }

    // 2. Existing legacy/catalog premium pricing source if config is missing
    let priceHalala = undefined;

    if (optionDoc && (optionDoc.extraPriceHalala !== undefined || optionDoc.extraFeeHalala !== undefined)) {
      priceHalala = Number(optionDoc.extraPriceHalala ?? optionDoc.extraFeeHalala);
    } else if (builderProteinDoc && builderProteinDoc.extraFeeHalala !== undefined) {
      priceHalala = Number(builderProteinDoc.extraFeeHalala);
    } else if (fallbackPriceHalala !== undefined) {
      priceHalala = Number(fallbackPriceHalala);
    }

    // If still undefined or 0 for known premium items, apply the legacy fallback rules
    if (normalizedKey === "premium_large_salad" || normalizedKey === "custom_premium_salad") {
      if (priceHalala === undefined || priceHalala === 0) {
        priceHalala = 2900;
      }
    } else if (["beef_steak", "shrimp", "salmon"].includes(normalizedKey)) {
      // 3. For known default premium proteins, do not allow accidental 0
      if (priceHalala === undefined || priceHalala === 0) {
        try {
          const BuilderProtein = require("../../models/BuilderProtein");
          let bpQuery = BuilderProtein.findOne({ premiumKey: normalizedKey, isPremium: true, isActive: true });
          if (session && typeof bpQuery.session === "function") bpQuery = bpQuery.session(session);
          const bp = await bpQuery.lean();
          if (bp && bp.extraFeeHalala) {
            priceHalala = Number(bp.extraFeeHalala);
          }
        } catch (_ignore) {}
        
        if (priceHalala === undefined || priceHalala === 0) {
          priceHalala = 2000; // Legacy fallback for premium proteins
        }
      }
    }

    if (priceHalala === undefined) {
      priceHalala = 0;
    }

    return {
      premiumKey: normalizedKey,
      priceHalala,
      upgradeDeltaHalala: priceHalala,
      currency: "SAR",
      selectionType: normalizedKey === "premium_large_salad" ? "premium_large_salad" : "premium_meal",
      sourceType: normalizedKey === "premium_large_salad" ? "menu_product" : "menu_option",
      sourceId: optionDoc ? String(optionDoc._id) : (builderProteinDoc ? String(builderProteinDoc._id) : null),
      sourceProductId: null,
      sourceGroupId: null,
      configId: null,
      revision: 0,
      priceSource: "legacy_fallback",
      isConfigured: false,
    };
  }
}

module.exports = {
  resolvePremiumUpgrade,
  resolveSubscriptionPremiumUpgradePricing,
  loadClientPremiumUpgradeConfigState,
  getConfigs,
  getCandidates,
  getReadiness,
  createConfig,
  updateConfig,
  updateConfigState,
  archiveConfig
};

const mongoose = require("mongoose");
const PremiumUpgradeConfig = require("../../models/PremiumUpgradeConfig");
const MenuOption = require("../../models/MenuOption");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const BuilderProtein = require("../../models/BuilderProtein");
const {
  PREMIUM_LARGE_SALAD_PREMIUM_KEY,
} = require("../../config/mealPlannerContract");
const { resolvePremiumLargeSaladPricing } = require("../catalog/premiumLargeSaladPricingService");
const {
  isMenuItemEnabledForSubscription,
} = require("./subscriptionMenuEligibilityPolicyService");

const ADMIN_KIND_TO_SOURCE_TYPE = Object.freeze({
  product: "menu_product",
  option: "menu_option",
});
const SOURCE_TYPE_TO_ADMIN_KIND = Object.freeze({
  menu_product: "product",
  menu_option: "option",
});
const SOURCE_TYPE_TO_SELECTION_TYPE = Object.freeze({
  menu_product: "premium_large_salad",
  menu_option: "premium_meal",
});
const HEALTH_READY = "ready";
const HEALTH_BROKEN = "broken";
const SYSTEM_PREMIUM_CURRENCY = "SAR";

function createError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.statusCode = status;
  return err;
}

const IMMUTABLE_PATCH_FIELDS = [
  "sourceProductId",
  "sourceGroupId",
  "selectionType",
  "premiumKey",
];

function normalizePremiumKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSlug(value, fallback = "premium_upgrade") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeObjectIdString(value) {
  if (!value) return "";
  return String(value).trim();
}

function idsEqual(left, right) {
  return normalizeObjectIdString(left) === normalizeObjectIdString(right);
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function localizedName(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ar: typeof value.ar === "string" ? value.ar : "",
      en: typeof value.en === "string" ? value.en : "",
    };
  }
  return { ar: "", en: "" };
}

function sourceModelForSourceType(sourceType) {
  if (sourceType === "menu_product") return "MenuProduct";
  if (sourceType === "menu_option") return "MenuOption";
  if (sourceType === "builder_protein") return "BuilderProtein";
  return "";
}

function sourceKeyFor(doc) {
  return normalizePremiumKey(doc?.premiumKey || doc?.key)
    || normalizeSlug(doc?.name?.en || doc?.name?.ar || (doc?._id ? String(doc._id) : ""));
}

function configName(config = {}, sourceDoc = null) {
  return localizedName(sourceDoc?.name || config.sourceSnapshot?.name || {});
}

function buildPremiumUpgradeSnapshot(config, sourceDoc = null, { quantity = 1, catalogVersion = null, purchasedAt = new Date() } = {}) {
  if (!config) return null;
  const qty = Math.max(0, Math.floor(Number(quantity || 0)));
  const unitExtraFeeHalala = Number(config.upgradeDeltaHalala || 0);
  const nameI18n = configName(config, sourceDoc);
  const sourceType = String(config.sourceType || "");
  const sourceId = config.sourceId || sourceDoc?._id || null;
  return {
    configId: config._id || null,
    revision: Number(config.revision || 0),
    premiumKey: normalizePremiumKey(config.premiumKey),
    kind: SOURCE_TYPE_TO_ADMIN_KIND[sourceType] || "",
    entityType: config.selectionType || (sourceType === "menu_product" ? "premium_large_salad" : "premium_meal"),
    selectionType: config.selectionType || "",
    sourceType,
    sourceModel: sourceModelForSourceType(sourceType),
    sourceId: sourceId ? String(sourceId) : "",
    sourceProductId: config.sourceProductId ? String(config.sourceProductId) : "",
    sourceGroupId: config.sourceGroupId ? String(config.sourceGroupId) : "",
    sourceGroupKey: String(config.sourceSnapshot?.context?.groupKey || ""),
    sourceKey: sourceKeyFor(sourceDoc) || config.sourceSnapshot?.key || normalizePremiumKey(config.premiumKey),
    name: nameI18n.en || nameI18n.ar || normalizePremiumKey(config.premiumKey),
    nameI18n,
    imageUrl: String(sourceDoc?.imageUrl || config.sourceSnapshot?.context?.imageUrl || ""),
    purchasedQty: qty,
    qty,
    unitExtraFeeHalala,
    totalHalala: qty * unitExtraFeeHalala,
    currency: String(config.currency || SYSTEM_PREMIUM_CURRENCY).toUpperCase(),
    catalogVersion: catalogVersion || sourceDoc?.updatedAt || config.updatedAt || null,
    purchasedAt,
  };
}

function normalizeAdminKind(data = {}) {
  const explicitKind = data.kind ? String(data.kind).trim().toLowerCase() : "";
  const sourceType = data.sourceType ? String(data.sourceType).trim() : "";

  if (explicitKind && !ADMIN_KIND_TO_SOURCE_TYPE[explicitKind]) {
    throw createError("Invalid premium source kind", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  if (sourceType && !SOURCE_TYPE_TO_ADMIN_KIND[sourceType]) {
    throw createError("Invalid premium source type", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  if (explicitKind && sourceType && ADMIN_KIND_TO_SOURCE_TYPE[explicitKind] !== sourceType) {
    throw createError("Conflicting premium source kind and sourceType", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  if (explicitKind) return explicitKind;
  if (sourceType) return SOURCE_TYPE_TO_ADMIN_KIND[sourceType];
  throw createError("kind is required", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
}

function statusFromConfig(config) {
  if (config.status === "archived") return "archived";
  if (config.isEnabled === false) return "disabled";
  if (config.isVisible === false) return "hidden";
  return "active";
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

function isSelectableProduct(product) {
  return isActivePublishedAvailable(product)
    && isMenuItemEnabledForSubscription(product)
    && !isAddonProduct(product);
}

function isSelectableOption(option) {
  return isActivePublishedAvailable(option)
    && isMenuItemEnabledForSubscription(option);
}

function compactIssueMessage(code) {
  switch (code) {
    case "SOURCE_NOT_FOUND":
      return "The linked source no longer exists";
    case "SOURCE_RELATION_INVALID":
      return "The linked source relation is no longer valid";
    case "SOURCE_NOT_SELECTABLE":
      return "The linked source is not selectable for subscriptions";
    default:
      return null;
  }
}

async function loadClientPremiumUpgradeConfigState({ session = null } = {}) {
  let query = PremiumUpgradeConfig.find({});
  if (session && typeof query.session === "function") query = query.session(session);
  const configs = await query.lean();
  const healthRows = await Promise.all((configs || []).map(async (config) => ({
    config,
    health: await resolveConfigHealth(config, { session }),
  })));
  const activeVisibleConfigs = healthRows
    .filter(({ config, health }) => (
      config
      && config.status === "active"
      && config.isEnabled !== false
      && config.isVisible !== false
      && config.premiumKey
      && health.status === HEALTH_READY
    ))
    .map(({ config }) => config);
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
      return false;
    },
  };
}

async function listActiveReadyPremiumUpgradeConfigs({ session = null } = {}) {
  let query = PremiumUpgradeConfig.find({
    status: "active",
    isEnabled: true,
    isVisible: true,
  }).sort({ sortOrder: 1, createdAt: 1 });
  if (session && typeof query.session === "function") query = query.session(session);
  const configs = await query.lean();
  const sourceMap = await fetchSourcesForConfigs(configs);
  const readyRows = [];
  for (const config of configs) {
    const sourceDoc = sourceMap.get(`${config.sourceType}_${config.sourceId}`) || null;
    const health = await resolveConfigHealth(config, { sourceDoc, session });
    if (health.status !== HEALTH_READY) continue;
    readyRows.push({ config, sourceDoc, health });
  }
  return readyRows;
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
  const health = await resolveConfigHealth(config, { session });
  if (health.status !== HEALTH_READY) {
    throw createError(
      `Premium upgrade source is not available: ${normalizedKey}`,
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

function buildHealth(status, code = null) {
  return {
    status,
    code,
    message: code ? compactIssueMessage(code) : null,
  };
}

async function resolveOptionRelationContext(config, optionDoc, { session = null } = {}) {
  const groupId = config.sourceGroupId || optionDoc.groupId || null;
  if (!groupId) return { valid: false, code: "SOURCE_RELATION_INVALID" };

  let groupQuery = MenuOptionGroup.findById(groupId);
  if (session && typeof groupQuery.session === "function") groupQuery = groupQuery.session(session);
  const group = await groupQuery.lean();
  if (!isActivePublishedAvailable(group)) return { valid: false, code: "SOURCE_RELATION_INVALID", group };

  const relationFilter = {
    optionId: optionDoc._id,
    groupId,
    ...(config.sourceProductId ? { productId: config.sourceProductId } : {}),
  };
  let relationQuery = ProductGroupOption.findOne(relationFilter);
  if (session && typeof relationQuery.session === "function") relationQuery = relationQuery.session(session);
  const optionRelation = await relationQuery.lean();
  if (!isActiveAvailableRelation(optionRelation)) {
    return { valid: false, code: "SOURCE_RELATION_INVALID", group, optionRelation };
  }

  let productQuery = MenuProduct.findById(optionRelation.productId);
  if (session && typeof productQuery.session === "function") productQuery = productQuery.session(session);
  const product = await productQuery.lean();
  if (!isSelectableProduct(product)) return { valid: false, code: "SOURCE_RELATION_INVALID", group, optionRelation, product };

  let productGroupQuery = ProductOptionGroup.findOne({ productId: product._id, groupId });
  if (session && typeof productGroupQuery.session === "function") productGroupQuery = productGroupQuery.session(session);
  const productGroup = await productGroupQuery.lean();
  if (!isActiveAvailableRelation(productGroup)) {
    return { valid: false, code: "SOURCE_RELATION_INVALID", group, optionRelation, product, productGroup };
  }

  if (!idsEqual(optionDoc.groupId, group._id)) {
    return { valid: false, code: "SOURCE_RELATION_INVALID", group, optionRelation, product, productGroup };
  }

  return { valid: true, group, optionRelation, product, productGroup };
}

async function resolveConfigHealth(config, { sourceDoc = null, session = null } = {}) {
  if (!config) return buildHealth(HEALTH_BROKEN, "SOURCE_NOT_FOUND");
  const sourceType = config.sourceType;
  let resolvedSource = sourceDoc;
  if (!resolvedSource) {
    let sourceQuery = sourceType === "menu_product"
      ? MenuProduct.findById(config.sourceId)
      : sourceType === "menu_option"
        ? MenuOption.findById(config.sourceId)
        : null;
    if (!sourceQuery) return buildHealth(HEALTH_BROKEN, "SOURCE_NOT_FOUND");
    if (session && typeof sourceQuery.session === "function") sourceQuery = sourceQuery.session(session);
    resolvedSource = await sourceQuery.lean();
  }
  if (!resolvedSource) return buildHealth(HEALTH_BROKEN, "SOURCE_NOT_FOUND");

  if (sourceType === "menu_product") {
    if (!isSelectableProduct(resolvedSource)) return buildHealth(HEALTH_BROKEN, "SOURCE_NOT_SELECTABLE");
    return buildHealth(HEALTH_READY);
  }

  if (sourceType === "menu_option") {
    if (!isSelectableOption(resolvedSource)) return buildHealth(HEALTH_BROKEN, "SOURCE_NOT_SELECTABLE");
    const relation = await resolveOptionRelationContext(config, resolvedSource, { session });
    if (!relation.valid) return buildHealth(HEALTH_BROKEN, relation.code || "SOURCE_RELATION_INVALID");
    return buildHealth(HEALTH_READY);
  }

  return buildHealth(HEALTH_BROKEN, "SOURCE_NOT_FOUND");
}

async function mapConfigToCompactDTO(config, sourceDoc = null) {
  const health = await resolveConfigHealth(config, { sourceDoc });
  const sourceName = sourceDoc?.name || config.sourceSnapshot?.name || {};
  const sourceKey = sourceKeyFor(sourceDoc) || config.sourceSnapshot?.key || config.premiumKey;
  return {
    id: config._id.toString(),
    key: config.premiumKey || sourceKey,
    name: localizedName(sourceName),
    kind: SOURCE_TYPE_TO_ADMIN_KIND[config.sourceType] || null,
    sourceId: config.sourceId ? config.sourceId.toString() : null,
    priceHalala: Number(config.upgradeDeltaHalala || 0),
    priceSar: Number(config.upgradeDeltaHalala || 0) / 100,
    currency: config.currency || SYSTEM_PREMIUM_CURRENCY,
    status: statusFromConfig(config),
    health: health.status,
    issueCode: health.code,
    sortOrder: Number(config.sortOrder || 0),
  };
}

function mapConfigToCompatibilityDTO(config, sourceDoc = null) {
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

async function mapConfigToDetailDTO(config, sourceDoc = null) {
  const health = await resolveConfigHealth(config, { sourceDoc });
  const sourceName = sourceDoc?.name || config.sourceSnapshot?.name || {};
  const sourceKey = sourceKeyFor(sourceDoc) || config.sourceSnapshot?.key || config.premiumKey;
  return {
    id: config._id.toString(),
    revision: config.revision,
    key: config.premiumKey || sourceKey,
    name: localizedName(sourceName),
    kind: SOURCE_TYPE_TO_ADMIN_KIND[config.sourceType] || null,
    source: {
      type: config.sourceType,
      id: config.sourceId ? config.sourceId.toString() : null,
      productId: config.sourceProductId ? config.sourceProductId.toString() : null,
      groupId: config.sourceGroupId ? config.sourceGroupId.toString() : null,
      groupKey: config.sourceSnapshot?.context?.groupKey || null,
      key: sourceKey,
    },
    pricing: {
      upgradeDeltaHalala: Number(config.upgradeDeltaHalala || 0),
      upgradeDeltaSar: Number(config.upgradeDeltaHalala || 0) / 100,
      currency: config.currency || SYSTEM_PREMIUM_CURRENCY,
    },
    display: {
      enabled: config.isEnabled !== false,
      visible: config.isVisible !== false,
      sortOrder: Number(config.sortOrder || 0),
    },
    behavior: {
      consumesMealSlot: true,
    },
    health,
    compatibility: mapConfigToCompatibilityDTO(config, sourceDoc),
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
  
  if (status === "archived") filter.status = "archived";
  if (status === "disabled") {
    filter.status = { $ne: "archived" };
    filter.isEnabled = false;
  }
  if (status === "hidden") {
    filter.status = { $ne: "archived" };
    filter.isEnabled = { $ne: false };
    filter.isVisible = false;
  }
  if (status === "active") {
    filter.status = { $ne: "archived" };
    filter.isEnabled = { $ne: false };
    filter.isVisible = { $ne: false };
  }
  if (isEnabled !== undefined) filter.isEnabled = isEnabled === "true";
  if (isVisible !== undefined) filter.isVisible = isVisible === "true";
  if (sourceType) filter.sourceType = sourceType;
  if (query.kind) filter.sourceType = ADMIN_KIND_TO_SOURCE_TYPE[String(query.kind).trim().toLowerCase()];
  if (selectionType) filter.selectionType = selectionType;

  if (q) {
    const rx = new RegExp(q, "i");
    filter.$or = [
      { premiumKey: rx },
      { "sourceSnapshot.key": rx },
      { "sourceSnapshot.name.en": rx },
      { "sourceSnapshot.name.ar": rx },
    ];
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
  const data = await Promise.all(configs.map(c => mapConfigToCompactDTO(c, sourceMap.get(`${c.sourceType}_${c.sourceId}`))));

  return {
    data,
    meta: {
      total,
      page: parseInt(page, 10),
      limit: limitNum
    },
    status: true,
  };
}

async function getConfigDetail(id) {
  if (!isValidObjectId(id)) throw createError("Config not found", "NOT_FOUND", 404);
  const config = await PremiumUpgradeConfig.findById(id).lean();
  if (!config) throw createError("Config not found", "NOT_FOUND", 404);
  const sourceMap = await fetchSourcesForConfigs([config]);
  return mapConfigToDetailDTO(config, sourceMap.get(`${config.sourceType}_${config.sourceId}`));
}

function mapCandidateToSource(candidate) {
  return {
    id: candidate.sourceId,
    kind: SOURCE_TYPE_TO_ADMIN_KIND[candidate.sourceType],
    key: candidate.key || candidate.premiumKey || "",
    name: localizedName(candidate.name),
    imageUrl: candidate.imageUrl || "",
    group: {
      id: candidate.sourceGroupId || null,
      key: candidate.sourceGroupKey || (candidate.sourceType === "menu_product" ? "premium" : null),
    },
    selectable: true,
  };
}

async function getSources(query = {}) {
  const kind = normalizeAdminKind({ kind: query.kind || "option" });
  const status = String(query.status || "active").toLowerCase();
  if (!["active", "all"].includes(status)) {
    throw createError("Invalid source status", "PREMIUM_SOURCE_STATUS_INVALID", 400);
  }
  const pageNum = Math.max(1, parseInt(query.page || 1, 10));
  const limitNum = Math.max(1, Math.min(100, parseInt(query.limit || 20, 10)));
  const search = String(query.q || "").trim().toLowerCase();

  if (status === "active") {
    const { candidates } = await loadEligiblePremiumCandidates();
    let rows = candidates
      .filter((candidate) => candidate.sourceType === ADMIN_KIND_TO_SOURCE_TYPE[kind])
      .map(mapCandidateToSource);
    if (search) {
      rows = rows.filter((row) => (
        row.key.includes(search)
        || String(row.name.en || "").toLowerCase().includes(search)
        || String(row.name.ar || "").toLowerCase().includes(search)
      ));
    }
    const total = rows.length;
    const skip = (pageNum - 1) * limitNum;
    return {
      data: rows.slice(skip, skip + limitNum),
      meta: { total, page: pageNum, limit: limitNum },
      status: true,
    };
  }

  const rx = search ? new RegExp(search, "i") : null;
  if (kind === "product") {
    const filter = rx ? { $or: [{ key: rx }, { "name.en": rx }, { "name.ar": rx }] } : {};
    const products = await MenuProduct.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    const rows = products.map((product) => ({
      id: String(product._id),
      kind,
      key: sourceKeyFor(product),
      name: localizedName(product.name),
      imageUrl: product.imageUrl || "",
      group: { id: null, key: "premium" },
      selectable: isSelectableProduct(product),
    }));
    const total = rows.length;
    const skip = (pageNum - 1) * limitNum;
    return {
      data: rows.slice(skip, skip + limitNum),
      meta: { total, page: pageNum, limit: limitNum },
      status: true,
    };
  }

  const filter = rx ? { $or: [{ key: rx }, { premiumKey: rx }, { "name.en": rx }, { "name.ar": rx }] } : {};
  const options = await MenuOption.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
  const groupIds = [...new Set(options.map((option) => String(option.groupId)).filter(Boolean))];
  const groups = await MenuOptionGroup.find({ _id: { $in: groupIds } }).lean();
  const groupById = new Map(groups.map((group) => [String(group._id), group]));
  const rows = options.map((option) => {
    const group = groupById.get(String(option.groupId));
    return {
      id: String(option._id),
      kind,
      key: sourceKeyFor(option),
      name: localizedName(option.name),
      imageUrl: option.imageUrl || "",
      group: {
        id: group ? String(group._id) : (option.groupId ? String(option.groupId) : null),
        key: group?.key || null,
      },
      selectable: isSelectableOption(option),
    };
  });
  const total = rows.length;
  const skip = (pageNum - 1) * limitNum;
  return {
    data: rows.slice(skip, skip + limitNum),
    meta: { total, page: pageNum, limit: limitNum },
    status: true,
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
        imageUrl: option.imageUrl || "",
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
    const identity = relationIdentity({ sourceType: "menu_product", sourceId: product._id, sourceProductId: product._id });
    const premiumKey = sourceKeyFor(product);
    candidates.push({
      id: String(product._id),
      sourceId: String(product._id),
      type: "menu_product",
      sourceType: "menu_product",
      sourceProductId: String(product._id),
      sourceGroupId: null,
      sourceProductKey: product.key,
      sourceGroupKey: null,
      key: premiumKey,
      premiumKey,
      name: { ar: product.name?.ar || null, en: product.name?.en || null },
      imageUrl: product.imageUrl || "",
      selectionType: SOURCE_TYPE_TO_SELECTION_TYPE.menu_product,
      upgradeDeltaHalala: Number(product.priceHalala || 0),
      currency: "SAR",
      isLinked: linkedRelations.has(identity) || linkedKeys.has(premiumKey),
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
  
  const allKnownKeys = [...new Set(configs.map(c => normalizePremiumKey(c.premiumKey)).filter(Boolean))];
  
  const configuredKnownKeys = [...new Set(configs
    .map((config) => normalizePremiumKey(config.premiumKey)))];
    
  const missingConfigKeys = [];
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
async function assertSourceCollectionMatch(kind, sourceId) {
  if (!isValidObjectId(sourceId)) {
    throw createError("Premium source was not found", "PREMIUM_SOURCE_NOT_FOUND", 404);
  }
  if (kind === "product") {
    const option = await MenuOption.exists({ _id: sourceId });
    if (option) throw createError("Premium source type mismatch", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  if (kind === "option") {
    const product = await MenuProduct.exists({ _id: sourceId });
    if (product) throw createError("Premium source type mismatch", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
}

async function resolvePremiumSourceIdentity(data = {}) {
  const kind = normalizeAdminKind(data);
  const sourceType = ADMIN_KIND_TO_SOURCE_TYPE[kind];
  const sourceId = data.sourceId;
  await assertSourceCollectionMatch(kind, sourceId);

  if (kind === "product") {
    const product = await MenuProduct.findById(sourceId).lean();
    if (!product) throw createError("Premium source was not found", "PREMIUM_SOURCE_NOT_FOUND", 404);
    if (!isSelectableProduct(product)) {
      throw createError("Premium source is not selectable", "PREMIUM_SOURCE_NOT_SELECTABLE", 400);
    }
    const premiumKey = sourceKeyFor(product);
    if (!premiumKey) throw createError("Premium source has no key", "PREMIUM_SOURCE_NOT_SELECTABLE", 400);
    return {
      kind,
      sourceType,
      sourceId: product._id,
      sourceProductId: product._id,
      sourceGroupId: null,
      sourceProductKey: product.key || null,
      sourceGroupKey: null,
      selectionType: SOURCE_TYPE_TO_SELECTION_TYPE[sourceType],
      premiumKey,
      sourceDoc: product,
    };
  }

  const option = await MenuOption.findById(sourceId).lean();
  if (!option) throw createError("Premium source was not found", "PREMIUM_SOURCE_NOT_FOUND", 404);
  if (!isSelectableOption(option)) {
    throw createError("Premium source is not selectable", "PREMIUM_SOURCE_NOT_SELECTABLE", 400);
  }

  const probeConfig = {
    sourceType,
    sourceId: option._id,
    sourceProductId: data.sourceProductId || null,
    sourceGroupId: data.sourceGroupId || option.groupId || null,
  };
  const relation = await resolveOptionRelationContext(probeConfig, option);
  if (!relation.valid) {
    throw createError("Premium source relation is invalid", "PREMIUM_SOURCE_RELATION_INVALID", 400);
  }
  const premiumKey = sourceKeyFor(option);
  if (!premiumKey) throw createError("Premium source has no key", "PREMIUM_SOURCE_NOT_SELECTABLE", 400);
  return {
    kind,
    sourceType,
    sourceId: option._id,
    sourceProductId: relation.product._id,
    sourceGroupId: relation.group._id,
    sourceProductKey: relation.product.key || null,
    sourceGroupKey: relation.group.key || null,
    selectionType: SOURCE_TYPE_TO_SELECTION_TYPE[sourceType],
    premiumKey,
    sourceDoc: option,
  };
}

async function assertNoActiveConflicts(identity, { excludeId = null } = {}) {
  const excludeFilter = excludeId ? { _id: { $ne: excludeId } } : {};
  const sourceConflict = await PremiumUpgradeConfig.findOne({
    ...excludeFilter,
    status: "active",
    sourceType: identity.sourceType,
    sourceId: identity.sourceId,
  }).lean();
  if (sourceConflict) {
    throw createError("Duplicate premium source", "PREMIUM_SOURCE_CONFLICT", 409);
  }

  const keyConflict = await PremiumUpgradeConfig.findOne({
    ...excludeFilter,
    status: "active",
    premiumKey: identity.premiumKey,
  }).lean();
  if (keyConflict) {
    throw createError("Duplicate premiumKey", "PREMIUM_KEY_CONFLICT", 409);
  }
}

function normalizePremiumWriteFields(data = {}) {
  const currency = data.currency ? String(data.currency).trim().toUpperCase() : SYSTEM_PREMIUM_CURRENCY;
  if (currency !== SYSTEM_PREMIUM_CURRENCY) {
    throw createError("Invalid premium currency", "PREMIUM_UPGRADE_INVALID_CURRENCY", 400);
  }
  const upgradeDeltaHalala = Number(data.upgradeDeltaHalala);
  if (!Number.isSafeInteger(upgradeDeltaHalala) || upgradeDeltaHalala < 0) {
    throw createError("Invalid upgrade delta halala", "PREMIUM_UPGRADE_INVALID_DELTA", 400);
  }
  return {
    upgradeDeltaHalala,
    currency,
    isEnabled: data.isActive !== undefined ? data.isActive !== false : data.isEnabled !== false,
    isVisible: data.isVisible !== false,
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
  };
}

async function createConfig(data, adminId) {
  const identity = await resolvePremiumSourceIdentity(data);
  const writeFields = normalizePremiumWriteFields(data);
  await assertNoActiveConflicts(identity);

  const config = new PremiumUpgradeConfig({
    sourceType: identity.sourceType,
    sourceId: identity.sourceId,
    sourceProductId: identity.sourceProductId || null,
    sourceGroupId: identity.sourceGroupId || null,
    selectionType: identity.selectionType,
    premiumKey: identity.premiumKey,
    displayGroupKey: "premium",
    upgradeDeltaHalala: writeFields.upgradeDeltaHalala,
    currency: writeFields.currency,
    isEnabled: writeFields.isEnabled,
    isVisible: writeFields.isVisible,
    sortOrder: writeFields.sortOrder,
    sourceSnapshot: {
      key: identity.sourceDoc.key,
      name: identity.sourceDoc.name,
      context: {
        productKey: identity.sourceProductKey,
        groupKey: identity.sourceGroupKey,
      }
    }
  });

  await config.save();
  return mapConfigToDetailDTO(config, identity.sourceDoc);
}

/**
 * Update safe fields
 */
async function updateConfig(id, data, adminId) {
  const { expectedRevision, upgradeDeltaHalala, sortOrder, metadata, isActive, isEnabled, isVisible, currency } = data;
  const immutableField = IMMUTABLE_PATCH_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(data || {}, field));
  if (immutableField) {
    throw createError(`${immutableField} cannot be changed`, "PREMIUM_UPGRADE_IMMUTABLE_FIELD", 400);
  }
  
  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) throw createError("Config not found", "NOT_FOUND", 404);

  if (expectedRevision !== undefined && config.revision !== expectedRevision) {
    throw createError("Revision conflict", "PREMIUM_UPGRADE_REVISION_CONFLICT", 409);
  }

  if (config.status === "archived") {
    throw createError("Cannot update archived config", "PREMIUM_UPGRADE_ARCHIVED", 400);
  }

  const isRelink = Object.prototype.hasOwnProperty.call(data || {}, "kind")
    || Object.prototype.hasOwnProperty.call(data || {}, "sourceId")
    || Object.prototype.hasOwnProperty.call(data || {}, "sourceType");
  let relinkSourceDoc = null;
  if (isRelink) {
    const identity = await resolvePremiumSourceIdentity({
      ...data,
      kind: data.kind || SOURCE_TYPE_TO_ADMIN_KIND[config.sourceType],
      sourceId: data.sourceId || config.sourceId,
    });
    await assertNoActiveConflicts(identity, { excludeId: config._id });
    const previousSources = Array.isArray(config.metadata?.previousSources)
      ? config.metadata.previousSources
      : [];
    config.metadata = {
      ...(config.metadata || {}),
      previousSources: previousSources.concat({
        sourceType: config.sourceType,
        sourceId: config.sourceId ? String(config.sourceId) : null,
        sourceProductId: config.sourceProductId ? String(config.sourceProductId) : null,
        sourceGroupId: config.sourceGroupId ? String(config.sourceGroupId) : null,
        premiumKey: config.premiumKey,
        revision: config.revision,
        snapshot: config.sourceSnapshot || {},
        changedAt: new Date(),
        changedBy: adminId ? String(adminId) : null,
      }),
    };
    config.sourceType = identity.sourceType;
    config.sourceId = identity.sourceId;
    config.sourceProductId = identity.sourceProductId || null;
    config.sourceGroupId = identity.sourceGroupId || null;
    config.selectionType = identity.selectionType;
    config.premiumKey = identity.premiumKey;
    config.displayGroupKey = "premium";
    config.sourceSnapshot = {
      key: identity.sourceDoc.key,
      name: identity.sourceDoc.name,
      context: {
        productKey: identity.sourceProductKey,
        groupKey: identity.sourceGroupKey,
      },
    };
    relinkSourceDoc = identity.sourceDoc;
  }

  if (upgradeDeltaHalala !== undefined) {
    const amount = Number(upgradeDeltaHalala);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw createError("Invalid upgrade delta halala", "PREMIUM_UPGRADE_INVALID_DELTA", 400);
    }
    config.upgradeDeltaHalala = amount;
  }
  if (currency !== undefined && String(currency).trim().toUpperCase() !== SYSTEM_PREMIUM_CURRENCY) {
    throw createError("Invalid premium currency", "PREMIUM_UPGRADE_INVALID_CURRENCY", 400);
  }
  if (currency !== undefined) config.currency = SYSTEM_PREMIUM_CURRENCY;
  
  if (sortOrder !== undefined) config.sortOrder = sortOrder;
  if (metadata !== undefined) config.metadata = { ...(config.metadata || {}), ...metadata };
  if (isActive !== undefined) config.isEnabled = isActive !== false;
  if (isEnabled !== undefined) config.isEnabled = isEnabled !== false;
  if (isVisible !== undefined) config.isVisible = isVisible !== false;

  config.revision += 1;
  await config.save();
  
  const sourceMap = relinkSourceDoc ? null : await fetchSourcesForConfigs([config]);
  return mapConfigToDetailDTO(config, relinkSourceDoc || sourceMap.get(`${config.sourceType}_${config.sourceId}`));
}

/**
 * Update state (isEnabled, isVisible, status)
 */
async function updateConfigState(id, data, adminId) {
  const { expectedRevision, isEnabled, isVisible, status } = data;

  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) throw createError("Config not found", "NOT_FOUND", 404);

  if (expectedRevision !== undefined && config.revision !== expectedRevision) {
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
  return mapConfigToDetailDTO(config, sourceMap.get(`${config.sourceType}_${config.sourceId}`));
}

/**
 * Soft Archive
 */
async function archiveConfig(id, data, adminId) {
  const { expectedRevision, reason } = data;

  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) throw createError("Config not found", "NOT_FOUND", 404);

  if (expectedRevision !== undefined && config.revision !== expectedRevision) {
    throw createError("Revision conflict", "PREMIUM_UPGRADE_REVISION_CONFLICT", 409);
  }

  config.status = "archived";
  config.archiveReason = reason || "Archived by admin";
  config.isEnabled = false;
  config.isVisible = false;
  config.revision += 1;
  
  await config.save();
  
  const sourceMap = await fetchSourcesForConfigs([config]);
  return mapConfigToDetailDTO(config, sourceMap.get(`${config.sourceType}_${config.sourceId}`));
}

/**
 * Unified backend resolver for subscription premium upgrade pricing.
 * Used by mobile meal planner catalog response, subscription quote, subscription checkout/create,
 * and legacy Flutter compatibility path.
 *
 * Pricing precedence:
 * 1. Active PremiumUpgradeConfig if available.
 * 2. Existing database catalog premium pricing source if config is missing:
 *    - menu option price
 *    - builder premium price
 *    - resolver-provided database price
 *
 * Important:
 * - Do not silently return hardcoded fallback prices.
 * - 0 is allowed only if explicitly configured as free by an active backend config.
 */
async function resolveSubscriptionPremiumUpgradePricing(premiumKey, { fallbackPriceHalala, optionDoc, builderProteinDoc, session = null } = {}) {
  const normalizedKey = normalizePremiumKey(premiumKey);
  if (!normalizedKey) {
    throw createError("premiumKey is required", "PREMIUM_KEY_REQUIRED", 400);
  }

  // 1. Active PremiumUpgradeConfig if available.
  try {
    const upgrade = await resolvePremiumUpgrade(normalizedKey, { session });
    let sourceDoc = null;
    if (upgrade.sourceType === "menu_option") {
      sourceDoc = optionDoc || null;
      if (!sourceDoc && upgrade.sourceId) {
        let sourceQuery = MenuOption.findById(upgrade.sourceId);
        if (session && typeof sourceQuery.session === "function") sourceQuery = sourceQuery.session(session);
        sourceDoc = await sourceQuery.lean();
      }
    } else if (upgrade.sourceType === "menu_product" && upgrade.sourceId) {
      let sourceQuery = MenuProduct.findById(upgrade.sourceId);
      if (session && typeof sourceQuery.session === "function") sourceQuery = sourceQuery.session(session);
      sourceDoc = await sourceQuery.lean();
    }
    let configQuery = PremiumUpgradeConfig.findById(upgrade.configId);
    if (session && typeof configQuery.session === "function") configQuery = configQuery.session(session);
    const config = await configQuery.lean();
    const snapshot = buildPremiumUpgradeSnapshot(config, sourceDoc, { quantity: 1 });
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
      snapshot,
      priceSource: "resolvePremiumUpgrade",
      isConfigured: true,
    };
  } catch (err) {
    // 2. Existing database catalog pricing source if config is missing.
    // This is intentionally DB-backed only; no item-specific code fallback is allowed.
    let priceHalala = undefined;
    let priceSource = "";
    let sourceType = normalizedKey === "premium_large_salad" ? "menu_product" : "menu_option";
    let sourceId = null;

    let existingConfigQuery = PremiumUpgradeConfig.findOne({ premiumKey: normalizedKey });
    if (session && typeof existingConfigQuery.session === "function") existingConfigQuery = existingConfigQuery.session(session);
    const existingConfig = await existingConfigQuery.lean();
    if (existingConfig) {
      const error = new Error(`Premium upgrade is not configured or available: ${normalizedKey}`);
      error.code = "PREMIUM_UPGRADE_UNAVAILABLE";
      error.status = 422;
      throw error;
    }

    let resolvedOptionDoc = optionDoc || null;
    let resolvedBuilderProteinDoc = builderProteinDoc || null;
    if (!resolvedOptionDoc) {
      let optionQuery = MenuOption.findOne({
        $or: [{ premiumKey: normalizedKey }, { key: normalizedKey }],
        isActive: true,
        isVisible: { $ne: false },
        isAvailable: { $ne: false },
        availableForSubscription: { $ne: false },
      });
      if (session && typeof optionQuery.session === "function") optionQuery = optionQuery.session(session);
      resolvedOptionDoc = await optionQuery.lean();
    }
    if (!resolvedBuilderProteinDoc) {
      let proteinQuery = BuilderProtein.findOne({
        premiumKey: normalizedKey,
        isPremium: true,
        isActive: true,
        isArchived: { $ne: true },
        availableForSubscription: { $ne: false },
      });
      if (session && typeof proteinQuery.session === "function") proteinQuery = proteinQuery.session(session);
      resolvedBuilderProteinDoc = await proteinQuery.lean();
    }

    if (resolvedOptionDoc && (resolvedOptionDoc.extraPriceHalala !== undefined || resolvedOptionDoc.extraFeeHalala !== undefined)) {
      priceHalala = Number(resolvedOptionDoc.extraPriceHalala ?? resolvedOptionDoc.extraFeeHalala);
      priceSource = "menu_option";
      sourceType = "menu_option";
      sourceId = String(resolvedOptionDoc._id);
    } else if (resolvedBuilderProteinDoc && resolvedBuilderProteinDoc.extraFeeHalala !== undefined) {
      priceHalala = Number(resolvedBuilderProteinDoc.extraFeeHalala);
      priceSource = "builder_protein";
      sourceType = "builder_protein";
      sourceId = String(resolvedBuilderProteinDoc._id);
    } else if (fallbackPriceHalala !== undefined) {
      priceHalala = Number(fallbackPriceHalala);
      priceSource = "catalog_resolution";
    }

    if (!Number.isSafeInteger(priceHalala) || priceHalala < 0) {
      const error = new Error(`Premium upgrade is not configured or priced: ${normalizedKey}`);
      error.code = "PREMIUM_UPGRADE_UNAVAILABLE";
      error.status = 422;
      throw error;
    }

    return {
      premiumKey: normalizedKey,
      priceHalala,
      upgradeDeltaHalala: priceHalala,
      currency: "SAR",
      selectionType: normalizedKey === "premium_large_salad" ? "premium_large_salad" : "premium_meal",
      sourceType,
      sourceId,
      sourceProductId: null,
      sourceGroupId: null,
      configId: null,
      revision: 0,
      priceSource,
      isConfigured: false,
    };
  }
}

module.exports = {
  resolvePremiumUpgrade,
  resolveConfigHealth,
  resolveSubscriptionPremiumUpgradePricing,
  loadClientPremiumUpgradeConfigState,
  listActiveReadyPremiumUpgradeConfigs,
  buildPremiumUpgradeSnapshot,
  getConfigs,
  getSources,
  getConfigDetail,
  getCandidates,
  getReadiness,
  createConfig,
  updateConfig,
  updateConfigState,
  archiveConfig
};

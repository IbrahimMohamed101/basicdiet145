"use strict";

const mongoose = require("mongoose");

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const PremiumUpgradeConfig = require("../models/PremiumUpgradeConfig");
const premiumService = require("./subscription/premiumUpgradeConfigService");

const SYSTEM_CURRENCY = "SAR";
const SOURCE_TYPE_BY_KIND = Object.freeze({
  product: "menu_product",
  option: "menu_option",
});
const KIND_BY_SOURCE_TYPE = Object.freeze({
  menu_product: "product",
  menu_option: "option",
});
const HEALTH_READY = "ready";
const HEALTH_BROKEN = "broken";

const baseResolveSubscriptionPremiumUpgradePricing =
  premiumService.resolveSubscriptionPremiumUpgradePricing;
const buildPremiumUpgradeSnapshot = premiumService.buildPremiumUpgradeSnapshot;

function createError(message, code, status = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  if (details !== undefined) error.details = details;
  return error;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function objectId(value, fieldName = "id") {
  const raw = String(value || "").trim();
  if (!mongoose.Types.ObjectId.isValid(raw)) {
    throw createError(`${fieldName} is invalid`, "PREMIUM_UPGRADE_INVALID_SOURCE_ID", 400, {
      fieldName,
    });
  }
  return raw;
}

function localizedName(value) {
  return {
    ar: String(value && value.ar || ""),
    en: String(value && value.en || ""),
  };
}

function sourceKey(source) {
  return normalized(source && (source.premiumKey || source.key));
}

function configStatus(config) {
  if (config.status === "archived") return "archived";
  if (config.isEnabled === false) return "disabled";
  if (config.isVisible === false) return "hidden";
  return "active";
}

function sourceLifecycle(source) {
  const reasonCodes = [];
  if (!source) reasonCodes.push("SOURCE_NOT_FOUND");
  if (source && source.isActive === false) reasonCodes.push("SOURCE_INACTIVE");
  if (source && source.isVisible === false) reasonCodes.push("SOURCE_HIDDEN");
  if (source && source.isAvailable === false) reasonCodes.push("SOURCE_UNAVAILABLE");
  if (source && !source.publishedAt) reasonCodes.push("SOURCE_UNPUBLISHED");

  return {
    active: Boolean(source && source.isActive !== false),
    ready: reasonCodes.length === 0,
    reasonCodes,
    issueCode: reasonCodes[0] || null,
  };
}

function isPremiumLargeSaladProduct(product) {
  const values = [
    product && product.key,
    product && product.itemType,
    product && product.selectionType,
    product && product.ui && product.ui.cardVariant,
    ...(Array.isArray(product && product.ruleTags) ? product.ruleTags : []),
  ].map(normalized);
  return values.includes("premium_large_salad") || values.includes("large_salad");
}

function selectionTypeFor(kind, source) {
  if (kind === "product" && isPremiumLargeSaladProduct(source)) {
    return "premium_large_salad";
  }
  return "premium_meal";
}

function parseOptionalRelationId(value, expectedSourceId) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts[0] !== "menu_option") {
    throw createError(
      "Invalid premium source relation id",
      "PREMIUM_SOURCE_RELATION_INVALID",
      400
    );
  }
  if (parts.length === 2) {
    objectId(parts[1], "sourceId");
    if (String(parts[1]) !== String(expectedSourceId)) {
      throw createError(
        "Premium relation does not match the selected source",
        "PREMIUM_SOURCE_RELATION_INVALID",
        400
      );
    }
    return { sourceId: parts[1], sourceProductId: null, sourceGroupId: null };
  }
  if (parts.length !== 4) {
    throw createError(
      "Invalid premium source relation id",
      "PREMIUM_SOURCE_RELATION_INVALID",
      400
    );
  }
  const [, sourceId, sourceProductId, sourceGroupId] = parts;
  objectId(sourceId, "sourceId");
  objectId(sourceProductId, "sourceProductId");
  objectId(sourceGroupId, "sourceGroupId");
  if (String(sourceId) !== String(expectedSourceId)) {
    throw createError(
      "Premium relation does not match the selected source",
      "PREMIUM_SOURCE_RELATION_INVALID",
      400
    );
  }
  return { sourceId, sourceProductId, sourceGroupId };
}

async function resolveSourceIdentity(data = {}) {
  const kind = normalized(data.kind);
  if (!SOURCE_TYPE_BY_KIND[kind]) {
    throw createError("kind is required", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  const sourceId = objectId(data.sourceId, "sourceId");
  const source = kind === "product"
    ? await MenuProduct.findById(sourceId).lean()
    : await MenuOption.findById(sourceId).lean();

  if (!source) {
    throw createError("Premium source was not found", "PREMIUM_SOURCE_NOT_FOUND", 404);
  }

  const lifecycle = sourceLifecycle(source);
  if (!lifecycle.ready) {
    throw createError(
      "Premium source is not published and available",
      "PREMIUM_SOURCE_NOT_SELECTABLE",
      400,
      lifecycle
    );
  }

  const premiumKey = sourceKey(source);
  if (!premiumKey) {
    throw createError(
      "Premium source has no stable key",
      "PREMIUM_SOURCE_NOT_SELECTABLE",
      400
    );
  }

  const relation = kind === "option"
    ? parseOptionalRelationId(data.relationId, sourceId)
    : null;

  return {
    kind,
    sourceType: SOURCE_TYPE_BY_KIND[kind],
    source,
    sourceId: source._id,
    sourceProductId: kind === "product"
      ? source._id
      : relation && relation.sourceProductId || null,
    sourceGroupId: kind === "option"
      ? relation && relation.sourceGroupId || source.groupId || null
      : null,
    selectionType: selectionTypeFor(kind, source),
    premiumKey,
  };
}

async function sourceDocsForConfigs(configs) {
  const optionIds = [];
  const productIds = [];
  for (const config of configs || []) {
    if (config.sourceType === "menu_option" && config.sourceId) optionIds.push(config.sourceId);
    if (config.sourceType === "menu_product" && config.sourceId) productIds.push(config.sourceId);
  }
  const [options, products] = await Promise.all([
    MenuOption.find({ _id: { $in: optionIds } }).lean(),
    MenuProduct.find({ _id: { $in: productIds } }).lean(),
  ]);
  const map = new Map();
  for (const option of options) map.set(`menu_option:${option._id}`, option);
  for (const product of products) map.set(`menu_product:${product._id}`, product);
  return map;
}

async function independentResolveConfigHealth(config, { sourceDoc = null } = {}) {
  if (!config) {
    return { status: HEALTH_BROKEN, code: "SOURCE_NOT_FOUND", message: "Source not found" };
  }
  let source = sourceDoc;
  if (!source) {
    source = config.sourceType === "menu_product"
      ? await MenuProduct.findById(config.sourceId).lean()
      : config.sourceType === "menu_option"
        ? await MenuOption.findById(config.sourceId).lean()
        : null;
  }
  const lifecycle = sourceLifecycle(source);
  return lifecycle.ready
    ? { status: HEALTH_READY, code: null, message: null }
    : {
        status: HEALTH_BROKEN,
        code: lifecycle.issueCode || "SOURCE_NOT_SELECTABLE",
        message: "Premium source is not active, visible, available, and published",
        reasonCodes: lifecycle.reasonCodes,
      };
}

function linkedConfigMaps(configs) {
  const bySource = new Map();
  const byKey = new Map();
  for (const config of configs || []) {
    if (config.status === "archived") continue;
    bySource.set(`${config.sourceType}:${String(config.sourceId)}`, config);
    const key = normalized(config.premiumKey);
    if (key) byKey.set(key, config);
  }
  return { bySource, byKey };
}

function applyLinkState(row, maps, excludeConfigId) {
  const sourceType = row.kind === "product" ? "menu_product" : "menu_option";
  const linkedConfig = maps.bySource.get(`${sourceType}:${row.sourceId}`)
    || maps.byKey.get(normalized(row.key));
  const linked = Boolean(
    linkedConfig && String(linkedConfig._id) !== String(excludeConfigId || "")
  );
  return {
    ...row,
    linked,
    linkedConfigId: linked ? String(linkedConfig._id) : null,
    conflictReason: linked ? "SOURCE_ALREADY_LINKED" : null,
    selectable: row.selectable && !linked,
    reasonCodes: linked
      ? [...new Set([...(row.reasonCodes || []), "SOURCE_ALREADY_LINKED"])]
      : row.reasonCodes || [],
    issueCode: linked ? "SOURCE_ALREADY_LINKED" : row.issueCode || null,
  };
}

async function independentGetSources(query = {}) {
  const kind = normalized(query.kind || "product");
  if (!SOURCE_TYPE_BY_KIND[kind]) {
    throw createError("Invalid premium source kind", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  const status = normalized(query.status || "all");
  if (!new Set(["all", "active"]).has(status)) {
    throw createError("Invalid source status", "PREMIUM_SOURCE_STATUS_INVALID", 400);
  }
  const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "20", 10) || 20));
  const q = normalized(query.q);
  const excludeConfigId = query.excludeConfigId || null;

  const [configs, groups] = await Promise.all([
    PremiumUpgradeConfig.find({}).lean(),
    MenuOptionGroup.find({}).lean(),
  ]);
  const maps = linkedConfigMaps(configs);
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));

  const docs = kind === "product"
    ? await MenuProduct.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean()
    : await MenuOption.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean();

  let rows = docs.map((source) => {
    const lifecycle = sourceLifecycle(source);
    const group = kind === "option" ? groupsById.get(String(source.groupId)) || null : null;
    const base = {
      id: String(source._id),
      sourceId: String(source._id),
      kind,
      key: sourceKey(source),
      name: localizedName(source.name),
      imageUrl: String(source.imageUrl || ""),
      sourceProductId: kind === "product" ? String(source._id) : null,
      sourceGroupId: kind === "option" && source.groupId ? String(source.groupId) : null,
      sourceProductKey: kind === "product" ? source.key || null : null,
      sourceGroupKey: group && group.key || null,
      relationId: null,
      group: kind === "option"
        ? {
            id: group ? String(group._id) : source.groupId ? String(source.groupId) : null,
            key: group && group.key || null,
            name: localizedName(group && group.name),
          }
        : { id: null, key: "premium", name: { ar: "مميز", en: "Premium" } },
      supportedSelectionType: selectionTypeFor(kind, source),
      compatibilityKeys: [sourceKey(source)].filter(Boolean),
      premiumCompatibilityKeys: [sourceKey(source)].filter(Boolean),
      sourceLifecycleStatus: lifecycle.active ? "active" : "inactive",
      selectable: lifecycle.ready,
      reasonCodes: lifecycle.reasonCodes,
      issueCode: lifecycle.issueCode,
      relationRequired: false,
    };
    return applyLinkState(base, maps, excludeConfigId);
  });

  if (status === "active") {
    rows = rows.filter((row) => row.sourceLifecycleStatus === "active");
  }
  if (q) {
    rows = rows.filter((row) => [
      row.key,
      row.name && row.name.ar,
      row.name && row.name.en,
      row.sourceProductKey,
      row.sourceGroupKey,
    ].map(normalized).some((value) => value.includes(q)));
  }

  rows.sort((left, right) =>
    Number(right.selectable) - Number(left.selectable)
    || Number(left.linked) - Number(right.linked)
    || String(left.name.ar || left.name.en || left.key).localeCompare(
      String(right.name.ar || right.name.en || right.key),
      "ar"
    )
  );

  const total = rows.length;
  const start = (page - 1) * limit;
  return {
    status: true,
    data: rows.slice(start, start + limit),
    meta: {
      total,
      page,
      limit,
      pages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

function validatePriceAndCurrency(data) {
  const amount = Number(data.upgradeDeltaHalala);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw createError(
      "Invalid upgrade delta halala",
      "PREMIUM_UPGRADE_INVALID_DELTA",
      400
    );
  }
  const currency = String(data.currency || SYSTEM_CURRENCY).trim().toUpperCase();
  if (currency !== SYSTEM_CURRENCY) {
    throw createError(
      "Invalid premium currency",
      "PREMIUM_UPGRADE_INVALID_CURRENCY",
      400
    );
  }
  return { amount, currency };
}

async function assertNoSourceConflict(identity, excludeConfigId = null) {
  const filters = [
    { premiumKey: identity.premiumKey },
    { sourceType: identity.sourceType, sourceId: identity.sourceId },
  ];
  const conflict = await PremiumUpgradeConfig.findOne({
    status: { $ne: "archived" },
    ...(excludeConfigId ? { _id: { $ne: excludeConfigId } } : {}),
    $or: filters,
  }).lean();
  if (conflict) {
    throw createError("Duplicate premium source", "PREMIUM_SOURCE_CONFLICT", 409, {
      configId: String(conflict._id),
    });
  }
}

function sourceSnapshot(identity) {
  return {
    key: identity.source.key || identity.premiumKey,
    name: localizedName(identity.source.name),
    context: {
      groupId: identity.sourceGroupId ? String(identity.sourceGroupId) : null,
      groupKey: null,
      productId: identity.sourceProductId ? String(identity.sourceProductId) : null,
      authoringContract: "independent_premium_authority.v2",
    },
  };
}

async function independentCreateConfig(data = {}, adminId = null) {
  const identity = await resolveSourceIdentity(data);
  const { amount, currency } = validatePriceAndCurrency(data);
  await assertNoSourceConflict(identity);

  const config = await PremiumUpgradeConfig.create({
    sourceType: identity.sourceType,
    sourceId: identity.sourceId,
    sourceProductId: identity.sourceProductId || null,
    sourceGroupId: identity.sourceGroupId || null,
    selectionType: identity.selectionType,
    premiumKey: identity.premiumKey,
    displayGroupKey: "premium",
    upgradeDeltaHalala: amount,
    currency,
    isEnabled: data.isActive !== undefined ? data.isActive !== false : data.isEnabled !== false,
    isVisible: data.isVisible !== false,
    status: "active",
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
    metadata: {
      ...(data.metadata && typeof data.metadata === "object" ? data.metadata : {}),
      createdBy: adminId ? String(adminId) : null,
      authoringContract: "independent_premium_authority.v2",
    },
    sourceSnapshot: sourceSnapshot(identity),
  });

  return independentGetConfigDetail(String(config._id));
}

function compactRow(config, source, health) {
  return {
    id: String(config._id),
    key: config.premiumKey || sourceKey(source),
    name: localizedName(source && source.name || config.sourceSnapshot && config.sourceSnapshot.name),
    kind: KIND_BY_SOURCE_TYPE[config.sourceType] || null,
    sourceId: config.sourceId ? String(config.sourceId) : null,
    priceHalala: Number(config.upgradeDeltaHalala || 0),
    priceSar: Number(config.upgradeDeltaHalala || 0) / 100,
    currency: config.currency || SYSTEM_CURRENCY,
    status: configStatus(config),
    health: health.status,
    issueCode: health.code,
    sortOrder: Number(config.sortOrder || 0),
    revision: Number(config.revision || 1),
  };
}

async function independentGetConfigs(query = {}) {
  const filter = {};
  const status = normalized(query.status);
  if (status === "archived") filter.status = "archived";
  if (status === "active") {
    filter.status = { $ne: "archived" };
    filter.isEnabled = { $ne: false };
    filter.isVisible = { $ne: false };
  }
  if (status === "hidden") {
    filter.status = { $ne: "archived" };
    filter.isEnabled = { $ne: false };
    filter.isVisible = false;
  }
  if (status === "disabled") {
    filter.status = { $ne: "archived" };
    filter.isEnabled = false;
  }
  if (query.kind && query.kind !== "all") {
    const sourceType = SOURCE_TYPE_BY_KIND[normalized(query.kind)];
    if (!sourceType) {
      throw createError("Invalid premium source kind", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
    }
    filter.sourceType = sourceType;
  }
  if (query.sourceType) filter.sourceType = String(query.sourceType);
  if (query.selectionType) filter.selectionType = String(query.selectionType);

  const configs = await PremiumUpgradeConfig.find(filter)
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  const sourceMap = await sourceDocsForConfigs(configs);
  const q = normalized(query.q);
  const requestedHealth = normalized(query.health);
  let rows = [];
  for (const config of configs) {
    const source = sourceMap.get(`${config.sourceType}:${config.sourceId}`) || null;
    const health = await independentResolveConfigHealth(config, { sourceDoc: source });
    if (requestedHealth && requestedHealth !== "all" && health.status !== requestedHealth) continue;
    const row = compactRow(config, source, health);
    if (q && ![
      row.key,
      row.name.ar,
      row.name.en,
    ].map(normalized).some((value) => value.includes(q))) continue;
    rows.push(row);
  }

  const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "20", 10) || 20));
  const total = rows.length;
  const start = (page - 1) * limit;
  return {
    status: true,
    data: rows.slice(start, start + limit),
    meta: { total, page, limit, pages: total === 0 ? 0 : Math.ceil(total / limit) },
  };
}

async function independentGetConfigDetail(id) {
  objectId(id, "configId");
  const config = await PremiumUpgradeConfig.findById(id).lean();
  if (!config) {
    throw createError("Premium upgrade config was not found", "PREMIUM_UPGRADE_NOT_FOUND", 404);
  }
  const source = config.sourceType === "menu_product"
    ? await MenuProduct.findById(config.sourceId).lean()
    : await MenuOption.findById(config.sourceId).lean();
  const health = await independentResolveConfigHealth(config, { sourceDoc: source });
  const name = localizedName(source && source.name || config.sourceSnapshot && config.sourceSnapshot.name);
  const key = config.premiumKey || sourceKey(source);
  return {
    ...compactRow(config, source, health),
    source: {
      type: config.sourceType,
      id: config.sourceId ? String(config.sourceId) : null,
      productId: config.sourceProductId ? String(config.sourceProductId) : null,
      groupId: config.sourceGroupId ? String(config.sourceGroupId) : null,
      groupKey: config.sourceSnapshot && config.sourceSnapshot.context && config.sourceSnapshot.context.groupKey || null,
      key,
      name,
    },
    pricing: {
      upgradeDeltaHalala: Number(config.upgradeDeltaHalala || 0),
      upgradeDeltaSar: Number(config.upgradeDeltaHalala || 0) / 100,
      currency: config.currency || SYSTEM_CURRENCY,
    },
    display: {
      enabled: config.isEnabled !== false,
      visible: config.isVisible !== false,
      sortOrder: Number(config.sortOrder || 0),
    },
    behavior: { consumesMealSlot: true },
    health,
    compatibility: {
      sourceType: config.sourceType,
      sourceId: config.sourceId ? String(config.sourceId) : null,
      sourceProductId: config.sourceProductId ? String(config.sourceProductId) : null,
      sourceGroupId: config.sourceGroupId ? String(config.sourceGroupId) : null,
      sourceKey: key,
      sourceName: name,
      selectionType: config.selectionType,
      premiumKey: config.premiumKey,
      upgradeDeltaHalala: Number(config.upgradeDeltaHalala || 0),
      upgradeDeltaSar: Number(config.upgradeDeltaHalala || 0) / 100,
      currency: config.currency || SYSTEM_CURRENCY,
      isEnabled: config.isEnabled !== false,
      isVisible: config.isVisible !== false,
      status: config.status,
      sortOrder: Number(config.sortOrder || 0),
      sourceStatus: {
        exists: Boolean(source),
        active: Boolean(source && source.isActive !== false),
        visible: Boolean(source && source.isVisible !== false),
        available: Boolean(source && source.isAvailable !== false),
        published: Boolean(source && source.publishedAt),
        subscriptionEnabled: true,
        relationValid: true,
      },
      validation: {
        valid: health.status === HEALTH_READY,
        errors: health.status === HEALTH_READY ? [] : [health.code || "SOURCE_NOT_SELECTABLE"],
        warnings: [],
      },
    },
    repair: health.status === HEALTH_READY
      ? null
      : {
          currentPremiumKey: config.premiumKey,
          missingSourceId: health.code === "SOURCE_NOT_FOUND" ? String(config.sourceId || "") : null,
          expectedKind: KIND_BY_SOURCE_TYPE[config.sourceType] || null,
          compatibleReplacementCount: 0,
          compatibleSourceSuggestions: [],
          canRelink: true,
          blockingIssueCode: health.code || null,
        },
  };
}

async function independentGetReadiness() {
  const configs = await PremiumUpgradeConfig.find({}).lean();
  const sourceMap = await sourceDocsForConfigs(configs);
  const brokenConfigs = [];
  for (const config of configs) {
    const source = sourceMap.get(`${config.sourceType}:${config.sourceId}`) || null;
    const health = await independentResolveConfigHealth(config, { sourceDoc: source });
    if (config.status !== "archived" && health.status !== HEALTH_READY) {
      brokenConfigs.push({
        id: String(config._id),
        currentPremiumKey: config.premiumKey,
        blockingIssueCode: health.code || null,
        reasonCodes: health.reasonCodes || [],
        canRelink: true,
      });
    }
  }
  const keyCounts = new Map();
  for (const config of configs.filter((row) => row.status !== "archived")) {
    const key = normalized(config.premiumKey);
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  const duplicateKeys = [...keyCounts.values()].filter((count) => count > 1).length;
  return {
    status: true,
    isReady: brokenConfigs.length === 0 && duplicateKeys === 0,
    diagnostics: {
      totalConfigs: configs.length,
      activeConfigs: configs.filter((row) => row.status === "active" && row.isEnabled !== false).length,
      missingSources: brokenConfigs.filter((row) => row.blockingIssueCode === "SOURCE_NOT_FOUND").length,
      invalidRelations: 0,
      duplicateKeys,
      invalidConfigs: brokenConfigs.length,
      priceMismatches: [],
      legacyChecks: { fallbackActive: false },
      configState: {
        isEmpty: configs.length === 0,
        legacyFallbackActive: false,
        configsAuthoritative: true,
        backfillStatus: configs.length === 0 ? "not_started" : "complete",
        partialConfigRisk: false,
        knownKeys: configs.map((row) => row.premiumKey).filter(Boolean),
        configuredKnownKeys: configs.map((row) => row.premiumKey).filter(Boolean),
        missingConfigKeys: [],
      },
      knownSources: configs.map((config) => ({
        premiumKey: config.premiumKey,
        sourceType: config.sourceType,
        sourceId: config.sourceId ? String(config.sourceId) : null,
        sourceProductId: config.sourceProductId ? String(config.sourceProductId) : null,
        sourceGroupId: config.sourceGroupId ? String(config.sourceGroupId) : null,
      })),
      unresolvedSourceKeys: brokenConfigs.map((row) => row.currentPremiumKey),
      brokenConfigs,
    },
  };
}

async function independentUpdateConfig(id, data = {}, adminId = null) {
  objectId(id, "configId");
  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) {
    throw createError("Premium upgrade config was not found", "PREMIUM_UPGRADE_NOT_FOUND", 404);
  }
  if (config.status === "archived") {
    throw createError("Premium upgrade is archived", "PREMIUM_UPGRADE_ARCHIVED", 409);
  }
  if (
    data.expectedRevision !== undefined
    && Number(data.expectedRevision) !== Number(config.revision || 1)
  ) {
    throw createError(
      "Premium upgrade revision conflict",
      "PREMIUM_UPGRADE_REVISION_CONFLICT",
      409
    );
  }

  if (data.kind !== undefined || data.sourceId !== undefined) {
    if (!data.kind || !data.sourceId) {
      throw createError(
        "kind and sourceId are required together",
        "PREMIUM_SOURCE_TYPE_MISMATCH",
        400
      );
    }
    const identity = await resolveSourceIdentity(data);
    await assertNoSourceConflict(identity, config._id);
    config.sourceType = identity.sourceType;
    config.sourceId = identity.sourceId;
    config.sourceProductId = identity.sourceProductId || null;
    config.sourceGroupId = identity.sourceGroupId || null;
    config.selectionType = identity.selectionType;
    config.premiumKey = identity.premiumKey;
    config.sourceSnapshot = sourceSnapshot(identity);
  }

  if (data.upgradeDeltaHalala !== undefined || data.currency !== undefined) {
    const price = validatePriceAndCurrency({
      upgradeDeltaHalala: data.upgradeDeltaHalala !== undefined
        ? data.upgradeDeltaHalala
        : config.upgradeDeltaHalala,
      currency: data.currency || config.currency,
    });
    config.upgradeDeltaHalala = price.amount;
    config.currency = price.currency;
  }
  if (data.isActive !== undefined) config.isEnabled = data.isActive !== false;
  if (data.isEnabled !== undefined) config.isEnabled = data.isEnabled !== false;
  if (data.isVisible !== undefined) config.isVisible = data.isVisible !== false;
  if (data.sortOrder !== undefined) {
    const sortOrder = Number(data.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw createError("sortOrder must be an integer >= 0", "VALIDATION_ERROR", 400);
    }
    config.sortOrder = sortOrder;
  }
  config.revision = Number(config.revision || 1) + 1;
  config.metadata = {
    ...(config.metadata && typeof config.metadata === "object" ? config.metadata : {}),
    updatedBy: adminId ? String(adminId) : null,
  };
  await config.save();
  return independentGetConfigDetail(String(config._id));
}

async function independentUpdateConfigState(id, data = {}, adminId = null) {
  return independentUpdateConfig(id, data, adminId);
}

async function independentArchiveConfig(id, data = {}, adminId = null) {
  objectId(id, "configId");
  const config = await PremiumUpgradeConfig.findById(id);
  if (!config) {
    throw createError("Premium upgrade config was not found", "PREMIUM_UPGRADE_NOT_FOUND", 404);
  }
  if (
    data.expectedRevision !== undefined
    && Number(data.expectedRevision) !== Number(config.revision || 1)
  ) {
    throw createError(
      "Premium upgrade revision conflict",
      "PREMIUM_UPGRADE_REVISION_CONFLICT",
      409
    );
  }
  config.status = "archived";
  config.isEnabled = false;
  config.archiveReason = String(data.reason || "Archived by administrator");
  config.revision = Number(config.revision || 1) + 1;
  config.metadata = {
    ...(config.metadata && typeof config.metadata === "object" ? config.metadata : {}),
    archivedBy: adminId ? String(adminId) : null,
  };
  await config.save();
  return independentGetConfigDetail(String(config._id));
}

async function independentResolvePremiumUpgrade(premiumKey, { includeHidden = false } = {}) {
  const key = normalized(premiumKey);
  if (!key) throw createError("premiumKey is required", "PREMIUM_KEY_REQUIRED", 400);
  const config = await PremiumUpgradeConfig.findOne({
    premiumKey: key,
    status: "active",
    isEnabled: true,
    ...(includeHidden ? {} : { isVisible: { $ne: false } }),
  }).lean();
  if (!config) {
    throw createError(
      `Premium upgrade is not configured or available: ${key}`,
      "PREMIUM_UPGRADE_UNAVAILABLE",
      409
    );
  }
  const health = await independentResolveConfigHealth(config);
  if (health.status !== HEALTH_READY) {
    throw createError(
      `Premium upgrade source is not available: ${key}`,
      "PREMIUM_UPGRADE_UNAVAILABLE",
      409,
      health
    );
  }
  const amount = Number(config.upgradeDeltaHalala);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw createError(
      `Premium upgrade has invalid pricing: ${key}`,
      "PREMIUM_UPGRADE_INVALID_PRICE",
      500
    );
  }
  return Object.freeze({
    premiumKey: key,
    priceHalala: amount,
    upgradeDeltaHalala: amount,
    currency: String(config.currency || SYSTEM_CURRENCY).toUpperCase(),
    selectionType: config.selectionType,
    sourceType: config.sourceType,
    sourceId: config.sourceId || null,
    sourceProductId: config.sourceProductId || null,
    sourceGroupId: config.sourceGroupId || null,
    configId: config._id,
    revision: config.revision,
  });
}

async function independentResolveSubscriptionPremiumUpgradePricing(
  premiumKey,
  options = {}
) {
  const key = normalized(premiumKey);
  const existingConfig = key
    ? await PremiumUpgradeConfig.findOne({ premiumKey: key }).lean()
    : null;
  if (!existingConfig) {
    return baseResolveSubscriptionPremiumUpgradePricing(premiumKey, options);
  }

  const upgrade = await independentResolvePremiumUpgrade(key, {
    includeHidden: options.includeHidden === true,
  });
  const sourceDoc = upgrade.sourceType === "menu_product"
    ? await MenuProduct.findById(upgrade.sourceId).lean()
    : await MenuOption.findById(upgrade.sourceId).lean();
  const config = await PremiumUpgradeConfig.findById(upgrade.configId).lean();
  const snapshot = buildPremiumUpgradeSnapshot(config, sourceDoc, { quantity: 1 });
  return {
    premiumKey: key,
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
    priceSource: "independent_premium_authority",
    isConfigured: true,
  };
}

async function independentLoadClientPremiumUpgradeConfigState() {
  const configs = await PremiumUpgradeConfig.find({}).lean();
  const sourceMap = await sourceDocsForConfigs(configs);
  const activeVisibleConfigs = [];
  for (const config of configs) {
    if (
      config.status !== "active"
      || config.isEnabled === false
      || config.isVisible === false
      || !config.premiumKey
    ) continue;
    const source = sourceMap.get(`${config.sourceType}:${config.sourceId}`) || null;
    const health = await independentResolveConfigHealth(config, { sourceDoc: source });
    if (health.status === HEALTH_READY) activeVisibleConfigs.push(config);
  }
  const activeByKey = new Map(
    activeVisibleConfigs.map((config) => [normalized(config.premiumKey), config])
  );
  return {
    hasConfigs: configs.length > 0,
    configs,
    activeVisibleConfigs,
    activeByKey,
    getActiveConfig(premiumKey) {
      return activeByKey.get(normalized(premiumKey)) || null;
    },
    isAllowed(premiumKey) {
      return activeByKey.has(normalized(premiumKey));
    },
  };
}

async function independentListActiveReadyPremiumUpgradeConfigs() {
  const configs = await PremiumUpgradeConfig.find({
    status: "active",
    isEnabled: true,
    isVisible: true,
  }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  const sourceMap = await sourceDocsForConfigs(configs);
  const rows = [];
  for (const config of configs) {
    const sourceDoc = sourceMap.get(`${config.sourceType}:${config.sourceId}`) || null;
    const health = await independentResolveConfigHealth(config, { sourceDoc });
    if (health.status === HEALTH_READY) rows.push({ config, sourceDoc, health });
  }
  return rows;
}

function installIndependentPremiumAuthority() {
  premiumService.getSources = independentGetSources;
  premiumService.getCandidates = independentGetSources;
  premiumService.createConfig = independentCreateConfig;
  premiumService.getConfigs = independentGetConfigs;
  premiumService.getConfigDetail = independentGetConfigDetail;
  premiumService.getReadiness = independentGetReadiness;
  premiumService.updateConfig = independentUpdateConfig;
  premiumService.updateConfigState = independentUpdateConfigState;
  premiumService.archiveConfig = independentArchiveConfig;
  premiumService.resolveConfigHealth = independentResolveConfigHealth;
  premiumService.resolvePremiumUpgrade = independentResolvePremiumUpgrade;
  premiumService.resolveSubscriptionPremiumUpgradePricing =
    independentResolveSubscriptionPremiumUpgradePricing;
  premiumService.loadClientPremiumUpgradeConfigState =
    independentLoadClientPremiumUpgradeConfigState;
  premiumService.listActiveReadyPremiumUpgradeConfigs =
    independentListActiveReadyPremiumUpgradeConfigs;
  return premiumService;
}

installIndependentPremiumAuthority();

module.exports = {
  independentCreateConfig,
  independentGetConfigDetail,
  independentGetConfigs,
  independentGetReadiness,
  independentGetSources,
  independentResolveConfigHealth,
  independentResolvePremiumUpgrade,
  independentResolveSubscriptionPremiumUpgradePricing,
  installIndependentPremiumAuthority,
  resolveSourceIdentity,
  sourceLifecycle,
};

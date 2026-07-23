"use strict";

const mongoose = require("mongoose");

const MenuOption = require("../models/MenuOption");
const MenuOptionGroup = require("../models/MenuOptionGroup");
const MenuProduct = require("../models/MenuProduct");
const PremiumUpgradeConfig = require("../models/PremiumUpgradeConfig");
const ProductGroupOption = require("../models/ProductGroupOption");
const ProductOptionGroup = require("../models/ProductOptionGroup");
const premiumService = require("./subscription/premiumUpgradeConfigService");

const SYSTEM_CURRENCY = "SAR";
let installed = false;

function error(message, code, status = 400, details) {
  const value = new Error(message);
  value.code = code;
  value.status = status;
  value.statusCode = status;
  if (details !== undefined) value.details = details;
  return value;
}

function id(value) {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function localizedName(value) {
  return {
    ar: String(value?.ar || ""),
    en: String(value?.en || ""),
  };
}

function isActivePublishedAvailable(doc) {
  return Boolean(
    doc &&
      doc.isActive !== false &&
      doc.isVisible !== false &&
      doc.isAvailable !== false &&
      doc.publishedAt
  );
}

function isSubscriptionEnabled(doc) {
  if (!doc || doc.availableForSubscription === false) return false;
  if (!Array.isArray(doc.availableFor) || doc.availableFor.length === 0) return true;
  return doc.availableFor.includes("subscription");
}

function isAddonProduct(product) {
  const itemType = normalized(product?.itemType);
  const variant = normalized(product?.ui?.cardVariant);
  return itemType === "addon" || variant === "addon" || variant === "addon_card";
}

function relationReady(doc) {
  return Boolean(
    doc &&
      doc.isActive !== false &&
      doc.isVisible !== false &&
      doc.isAvailable !== false
  );
}

function premiumKeyFor(doc) {
  return normalized(doc?.premiumKey || doc?.key);
}

function isPremiumLargeSaladProduct(product) {
  const key = normalized(product?.key);
  const itemType = normalized(product?.itemType);
  const selectionType = normalized(product?.selectionType);
  const variant = normalized(product?.ui?.cardVariant);
  const tags = Array.isArray(product?.ruleTags)
    ? product.ruleTags.map(normalized)
    : [];
  return (
    key === "premium_large_salad" ||
    itemType === "premium_large_salad" ||
    selectionType === "premium_large_salad" ||
    variant === "large_salad" ||
    tags.includes("premium_large_salad")
  );
}

function selectionTypeForProduct(product) {
  return isPremiumLargeSaladProduct(product)
    ? "premium_large_salad"
    : "premium_meal";
}

function relationIdFor({ sourceId, sourceProductId, sourceGroupId }) {
  if (!sourceProductId || !sourceGroupId) return null;
  return `menu_option:${sourceId}:${sourceProductId}:${sourceGroupId}`;
}

function parseRelationId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const [type, sourceId, sourceProductId, sourceGroupId, ...rest] = raw.split(":");
  if (
    rest.length ||
    type !== "menu_option" ||
    !mongoose.Types.ObjectId.isValid(sourceId) ||
    !mongoose.Types.ObjectId.isValid(sourceProductId) ||
    !mongoose.Types.ObjectId.isValid(sourceGroupId)
  ) {
    throw error(
      "Invalid premium source relation id",
      "PREMIUM_SOURCE_RELATION_INVALID",
      400
    );
  }
  return { sourceId, sourceProductId, sourceGroupId };
}

function sourceState({ source, product = null, group = null, productGroup = null, optionRelation = null }) {
  const reasons = [];
  if (!source) reasons.push("SOURCE_NOT_FOUND");
  if (source && !isActivePublishedAvailable(source)) {
    reasons.push("SOURCE_NOT_ACTIVE_PUBLISHED_AVAILABLE");
  }
  if (source && !isSubscriptionEnabled(source)) {
    reasons.push("SOURCE_NOT_SUBSCRIPTION_ENABLED");
  }
  if (source && source.categoryId !== undefined && isAddonProduct(source)) {
    reasons.push("ADDON_PRODUCT_NOT_PREMIUM_SOURCE");
  }
  if (source && source.groupId !== undefined) {
    if (!product || !group || !productGroup || !optionRelation) {
      reasons.push("SOURCE_RELATION_MISSING");
    } else {
      if (!isActivePublishedAvailable(product) || !isSubscriptionEnabled(product)) {
        reasons.push("SOURCE_PRODUCT_NOT_READY");
      }
      if (!isActivePublishedAvailable(group)) reasons.push("SOURCE_GROUP_NOT_READY");
      if (!relationReady(productGroup) || !relationReady(optionRelation)) {
        reasons.push("SOURCE_RELATION_UNAVAILABLE");
      }
      if (String(source.groupId) !== String(group._id)) {
        reasons.push("SOURCE_GROUP_MISMATCH");
      }
    }
  }
  return {
    selectable: reasons.length === 0,
    reasonCodes: [...new Set(reasons)],
    issueCode: reasons[0] || null,
  };
}

function linkedMaps(configs) {
  const byKey = new Map();
  const byRelation = new Map();
  for (const config of configs) {
    if (config.status === "archived") continue;
    const key = normalized(config.premiumKey);
    if (key && !byKey.has(key)) byKey.set(key, config);
    const relationKey = [
      config.sourceType,
      id(config.sourceId) || "",
      id(config.sourceProductId) || "",
      id(config.sourceGroupId) || "",
    ].join(":");
    byRelation.set(relationKey, config);
  }
  return { byKey, byRelation };
}

function applyLinkState(row, maps, excludeConfigId = null) {
  const relationKey = [
    row.kind === "product" ? "menu_product" : "menu_option",
    row.sourceId || "",
    row.sourceProductId || "",
    row.sourceGroupId || "",
  ].join(":");
  const config = maps.byRelation.get(relationKey) || maps.byKey.get(normalized(row.key));
  const linked = Boolean(config && String(config._id) !== String(excludeConfigId || ""));
  return {
    ...row,
    linked,
    linkedConfigId: linked ? String(config._id) : null,
    conflictReason: linked ? "SOURCE_ALREADY_LINKED" : null,
  };
}

async function listIndependentSources(query = {}) {
  const kind = String(query.kind || "product").trim().toLowerCase();
  if (!new Set(["product", "option"]).has(kind)) {
    throw error("Invalid premium source kind", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  const status = String(query.status || "all").trim().toLowerCase();
  if (!new Set(["active", "all"]).has(status)) {
    throw error("Invalid source status", "PREMIUM_SOURCE_STATUS_INVALID", 400);
  }
  const page = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || "20", 10) || 20));
  const q = normalized(query.q);
  const excludeConfigId = query.excludeConfigId || null;

  const configs = await PremiumUpgradeConfig.find({}).lean();
  const maps = linkedMaps(configs);
  let rows = [];

  if (kind === "product") {
    const products = await MenuProduct.find({})
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    rows = products.map((product) => {
      const state = sourceState({ source: product });
      return applyLinkState(
        {
          id: String(product._id),
          sourceId: String(product._id),
          kind: "product",
          key: premiumKeyFor(product),
          name: localizedName(product.name),
          imageUrl: product.imageUrl || "",
          sourceProductId: String(product._id),
          sourceGroupId: null,
          sourceProductKey: product.key || null,
          sourceGroupKey: null,
          relationId: `menu_product:${String(product._id)}`,
          group: { id: null, key: "premium" },
          supportedSelectionType: selectionTypeForProduct(product),
          compatibilityKeys: [premiumKeyFor(product)].filter(Boolean),
          premiumCompatibilityKeys: [premiumKeyFor(product)].filter(Boolean),
          ...state,
        },
        maps,
        excludeConfigId
      );
    });
  } else {
    const [options, groups, products, productGroups, optionRelations] = await Promise.all([
      MenuOption.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuOptionGroup.find({}).lean(),
      MenuProduct.find({}).lean(),
      ProductOptionGroup.find({}).lean(),
      ProductGroupOption.find({}).lean(),
    ]);
    const groupById = new Map(groups.map((item) => [String(item._id), item]));
    const productById = new Map(products.map((item) => [String(item._id), item]));
    const productGroupByKey = new Map(
      productGroups.map((item) => [`${item.productId}:${item.groupId}`, item])
    );
    const relationsByOption = new Map();
    for (const relation of optionRelations) {
      const key = String(relation.optionId);
      if (!relationsByOption.has(key)) relationsByOption.set(key, []);
      relationsByOption.get(key).push(relation);
    }

    for (const option of options) {
      const optionRelationsForSource = relationsByOption.get(String(option._id)) || [];
      if (!optionRelationsForSource.length) {
        const group = groupById.get(String(option.groupId)) || null;
        const state = sourceState({ source: option, group });
        rows.push(
          applyLinkState(
            {
              id: String(option._id),
              sourceId: String(option._id),
              kind: "option",
              key: premiumKeyFor(option),
              name: localizedName(option.name),
              imageUrl: option.imageUrl || "",
              sourceProductId: null,
              sourceGroupId: group ? String(group._id) : id(option.groupId),
              sourceProductKey: null,
              sourceGroupKey: group?.key || null,
              relationId: null,
              group: {
                id: group ? String(group._id) : id(option.groupId),
                key: group?.key || null,
              },
              supportedSelectionType: "premium_meal",
              compatibilityKeys: [premiumKeyFor(option)].filter(Boolean),
              premiumCompatibilityKeys: [premiumKeyFor(option)].filter(Boolean),
              ...state,
            },
            maps,
            excludeConfigId
          )
        );
        continue;
      }

      for (const optionRelation of optionRelationsForSource) {
        const product = productById.get(String(optionRelation.productId)) || null;
        const group = groupById.get(String(optionRelation.groupId)) || null;
        const productGroup = productGroupByKey.get(
          `${optionRelation.productId}:${optionRelation.groupId}`
        ) || null;
        const state = sourceState({
          source: option,
          product,
          group,
          productGroup,
          optionRelation,
        });
        const sourceProductId = product ? String(product._id) : id(optionRelation.productId);
        const sourceGroupId = group ? String(group._id) : id(optionRelation.groupId);
        rows.push(
          applyLinkState(
            {
              id: String(option._id),
              sourceId: String(option._id),
              kind: "option",
              key: premiumKeyFor(option),
              name: localizedName(option.name),
              imageUrl: option.imageUrl || "",
              sourceProductId,
              sourceGroupId,
              sourceProductKey: product?.key || null,
              sourceGroupKey: group?.key || null,
              relationId: relationIdFor({
                sourceId: String(option._id),
                sourceProductId,
                sourceGroupId,
              }),
              group: { id: sourceGroupId, key: group?.key || null },
              supportedSelectionType: "premium_meal",
              compatibilityKeys: [premiumKeyFor(option)].filter(Boolean),
              premiumCompatibilityKeys: [premiumKeyFor(option)].filter(Boolean),
              ...state,
            },
            maps,
            excludeConfigId
          )
        );
      }
    }
  }

  if (status === "active") rows = rows.filter((row) => row.selectable);
  if (q) {
    rows = rows.filter((row) =>
      [row.key, row.name?.ar, row.name?.en, row.sourceProductKey, row.sourceGroupKey]
        .map(normalized)
        .some((value) => value.includes(q))
    );
  }

  rows.sort(
    (left, right) =>
      Number(right.selectable) - Number(left.selectable) ||
      Number(left.linked) - Number(right.linked) ||
      String(left.name?.ar || left.name?.en || left.key).localeCompare(
        String(right.name?.ar || right.name?.en || right.key),
        "ar"
      )
  );

  const total = rows.length;
  const skip = (page - 1) * limit;
  return {
    status: true,
    data: rows.slice(skip, skip + limit),
    meta: { total, page, limit, pages: total === 0 ? 0 : Math.ceil(total / limit) },
  };
}

async function resolveIdentity(data = {}) {
  const kind = String(data.kind || "").trim().toLowerCase();
  if (!new Set(["product", "option"]).has(kind)) {
    throw error("kind is required", "PREMIUM_SOURCE_TYPE_MISMATCH", 400);
  }
  if (!mongoose.Types.ObjectId.isValid(String(data.sourceId || ""))) {
    throw error("Premium source was not found", "PREMIUM_SOURCE_NOT_FOUND", 404);
  }

  if (kind === "product") {
    const product = await MenuProduct.findById(data.sourceId).lean();
    if (!product) throw error("Premium source was not found", "PREMIUM_SOURCE_NOT_FOUND", 404);
    const state = sourceState({ source: product });
    if (!state.selectable) {
      throw error(
        "Premium source is not ready for subscriptions",
        "PREMIUM_SOURCE_NOT_SELECTABLE",
        400,
        state
      );
    }
    return {
      sourceType: "menu_product",
      sourceId: product._id,
      sourceProductId: product._id,
      sourceGroupId: null,
      selectionType: selectionTypeForProduct(product),
      premiumKey: premiumKeyFor(product),
      sourceProductKey: product.key || null,
      sourceGroupKey: null,
      sourceDoc: product,
    };
  }

  const option = await MenuOption.findById(data.sourceId).lean();
  if (!option) throw error("Premium source was not found", "PREMIUM_SOURCE_NOT_FOUND", 404);
  const parsed = parseRelationId(data.relationId);
  const sourceProductId = parsed?.sourceProductId || data.sourceProductId;
  const sourceGroupId = parsed?.sourceGroupId || data.sourceGroupId || option.groupId;
  if (
    !mongoose.Types.ObjectId.isValid(String(sourceProductId || "")) ||
    !mongoose.Types.ObjectId.isValid(String(sourceGroupId || ""))
  ) {
    throw error(
      "Premium option requires a product/group relation",
      "PREMIUM_SOURCE_RELATION_INVALID",
      400
    );
  }
  const [product, group, productGroup, optionRelation] = await Promise.all([
    MenuProduct.findById(sourceProductId).lean(),
    MenuOptionGroup.findById(sourceGroupId).lean(),
    ProductOptionGroup.findOne({ productId: sourceProductId, groupId: sourceGroupId }).lean(),
    ProductGroupOption.findOne({
      productId: sourceProductId,
      groupId: sourceGroupId,
      optionId: option._id,
    }).lean(),
  ]);
  const state = sourceState({ source: option, product, group, productGroup, optionRelation });
  if (!state.selectable) {
    throw error(
      "Premium source relation is not ready for subscriptions",
      "PREMIUM_SOURCE_RELATION_INVALID",
      400,
      state
    );
  }
  return {
    sourceType: "menu_option",
    sourceId: option._id,
    sourceProductId: product._id,
    sourceGroupId: group._id,
    selectionType: "premium_meal",
    premiumKey: premiumKeyFor(option),
    sourceProductKey: product.key || null,
    sourceGroupKey: group.key || null,
    sourceDoc: option,
  };
}

async function createIndependentConfig(data = {}, adminId = null) {
  const identity = await resolveIdentity(data);
  if (!identity.premiumKey) {
    throw error("Premium source has no key", "PREMIUM_SOURCE_NOT_SELECTABLE", 400);
  }
  const amount = Number(data.upgradeDeltaHalala);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw error(
      "Invalid upgrade delta halala",
      "PREMIUM_UPGRADE_INVALID_DELTA",
      400
    );
  }
  const currency = String(data.currency || SYSTEM_CURRENCY).trim().toUpperCase();
  if (currency !== SYSTEM_CURRENCY) {
    throw error("Invalid premium currency", "PREMIUM_UPGRADE_INVALID_CURRENCY", 400);
  }
  const conflict = await PremiumUpgradeConfig.findOne({
    status: { $ne: "archived" },
    $or: [
      { premiumKey: identity.premiumKey },
      {
        sourceType: identity.sourceType,
        sourceId: identity.sourceId,
        sourceProductId: identity.sourceProductId || null,
        sourceGroupId: identity.sourceGroupId || null,
      },
    ],
  }).lean();
  if (conflict) {
    throw error("Duplicate premium source", "PREMIUM_SOURCE_CONFLICT", 409);
  }

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
      authoringContract: "independent_premium_authoring.v1",
    },
    sourceSnapshot: {
      key: identity.sourceDoc.key || identity.premiumKey,
      name: localizedName(identity.sourceDoc.name),
      context: {
        productKey: identity.sourceProductKey,
        groupKey: identity.sourceGroupKey,
      },
    },
  });

  return premiumService.getConfigDetail(String(config._id));
}

async function independentReadiness() {
  const configs = await PremiumUpgradeConfig.find({}).lean();
  const rows = await Promise.all(
    configs.map(async (config) => {
      const source = config.sourceType === "menu_product"
        ? await MenuProduct.findById(config.sourceId).lean()
        : await MenuOption.findById(config.sourceId).lean();
      let state = sourceState({ source });
      if (config.sourceType === "menu_option" && source) {
        const [product, group, productGroup, optionRelation] = await Promise.all([
          MenuProduct.findById(config.sourceProductId).lean(),
          MenuOptionGroup.findById(config.sourceGroupId).lean(),
          ProductOptionGroup.findOne({
            productId: config.sourceProductId,
            groupId: config.sourceGroupId,
          }).lean(),
          ProductGroupOption.findOne({
            productId: config.sourceProductId,
            groupId: config.sourceGroupId,
            optionId: config.sourceId,
          }).lean(),
        ]);
        state = sourceState({ source, product, group, productGroup, optionRelation });
      }
      return { config, state };
    })
  );
  const keyCounts = new Map();
  for (const config of configs) {
    const key = normalized(config.premiumKey);
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  const brokenConfigs = rows
    .filter(({ config, state }) => config.status !== "archived" && !state.selectable)
    .map(({ config, state }) => ({
      id: String(config._id),
      currentPremiumKey: config.premiumKey,
      blockingIssueCode: state.issueCode,
      reasonCodes: state.reasonCodes,
      canRelink: true,
    }));
  const duplicateKeys = [...keyCounts.values()].filter((count) => count > 1).length;
  return {
    isReady: brokenConfigs.length === 0 && duplicateKeys === 0,
    diagnostics: {
      totalConfigs: configs.length,
      activeConfigs: configs.filter((item) => item.status === "active").length,
      missingSources: brokenConfigs.filter((item) => item.blockingIssueCode === "SOURCE_NOT_FOUND").length,
      invalidRelations: brokenConfigs.filter((item) => String(item.blockingIssueCode || "").includes("RELATION")).length,
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
        knownKeys: configs.map((item) => item.premiumKey).filter(Boolean),
        configuredKnownKeys: configs.map((item) => item.premiumKey).filter(Boolean),
        missingConfigKeys: [],
      },
      knownSources: rows.map(({ config, state }) => ({
        premiumKey: config.premiumKey,
        resolvable: state.selectable,
        sourceType: config.sourceType,
        sourceId: id(config.sourceId),
        sourceProductId: id(config.sourceProductId),
        sourceGroupId: id(config.sourceGroupId),
        issues: state.reasonCodes,
      })),
      unresolvedSourceKeys: brokenConfigs.map((item) => item.currentPremiumKey),
      brokenConfigs,
    },
  };
}

function installIndependentPremiumAuthoring() {
  if (installed) return;
  installed = true;
  premiumService.getSources = listIndependentSources;
  premiumService.createConfig = createIndependentConfig;
  premiumService.getReadiness = independentReadiness;
}

installIndependentPremiumAuthoring();

module.exports = {
  createIndependentConfig,
  independentReadiness,
  installIndependentPremiumAuthoring,
  listIndependentSources,
  resolveIdentity,
};

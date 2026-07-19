"use strict";

const MenuCategory = require("../../models/MenuCategory");
const MenuProduct = require("../../models/MenuProduct");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuOption = require("../../models/MenuOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const ProductGroupOption = require("../../models/ProductGroupOption");
const { pickLang } = require("../../utils/i18n");
const {
  isCatalogItemUsable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");

const CONTRACT_VERSION = "dashboard_meal_builder_catalog.v1";
const DIRECT_ITEM_TYPES = new Set(["cold_sandwich", "full_meal_product"]);
const DIRECT_CARD_VARIANTS = new Set([
  "ready_meal",
  "ready_meal_customizable",
  "sandwich_card",
]);
const SANDWICH_CARD_VARIANTS = new Set(["sandwich_card"]);
const NON_MEAL_CARD_VARIANTS = new Set([
  "addon",
  "addon_card",
  "hero_builder",
  "compact_builder",
  "compact_product",
]);

function stringId(value) {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}

function serializeDoc(doc) {
  if (!doc) return null;
  const plain = JSON.parse(JSON.stringify(doc));
  return {
    ...plain,
    id: String(doc._id),
    _id: String(doc._id),
  };
}

function serializeStatus(doc = {}, catalogItemsById = new Map()) {
  const active = doc.isActive !== false;
  const visible = doc.isVisible !== false;
  const available = doc.isAvailable !== false;
  const published = Boolean(doc.publishedAt);
  const subscriptionEnabled =
    doc.availableForSubscription !== false &&
    (!Array.isArray(doc.availableFor) ||
      doc.availableFor.length === 0 ||
      doc.availableFor.includes("subscription"));
  const catalogItemId = stringId(doc.catalogItemId);
  const catalogItemAvailable = catalogItemId
    ? isCatalogItemUsable(catalogItemsById.get(catalogItemId))
    : true;
  const reasonCodes = [];
  if (!active) reasonCodes.push("INACTIVE");
  if (!visible) reasonCodes.push("HIDDEN");
  if (!available) reasonCodes.push("UNAVAILABLE");
  if (!published) reasonCodes.push("UNPUBLISHED");
  if (!subscriptionEnabled) reasonCodes.push("NOT_SUBSCRIPTION_ENABLED");
  if (!catalogItemAvailable) reasonCodes.push("CATALOG_ITEM_UNAVAILABLE");

  return {
    active,
    visible,
    available,
    published,
    subscriptionEnabled,
    catalogItemAvailable,
    customerReady: reasonCodes.length === 0,
    reasonCodes,
  };
}

function serializeRelationStatus(relation = {}) {
  const active = relation.isActive !== false;
  const visible = relation.isVisible !== false;
  const available = relation.isAvailable !== false;
  return {
    active,
    visible,
    available,
    effective: active && visible && available,
  };
}

function productCardVariant(product = {}) {
  return String(product?.ui?.cardVariant || "").trim().toLowerCase();
}

function directSelectionType(product = {}) {
  const itemType = String(product.itemType || "").trim().toLowerCase();
  const variant = productCardVariant(product);
  if (itemType === "cold_sandwich" || SANDWICH_CARD_VARIANTS.has(variant)) {
    return "sandwich";
  }
  if (
    itemType === "full_meal_product" ||
    (itemType === "product" && DIRECT_CARD_VARIANTS.has(variant))
  ) {
    return "full_meal_product";
  }
  return null;
}

function relationKey(productId, groupId) {
  return `${String(productId)}:${String(groupId)}`;
}

function classifyProduct({ product, optionGroups, status }) {
  const itemType = String(product.itemType || "").trim().toLowerCase();
  const cardVariant = productCardVariant(product);
  const groupKeys = new Set(
    optionGroups
      .map((entry) => String(entry.group?.key || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const activeGroups = optionGroups.filter(
    (entry) => entry.relationStatus.effective && entry.groupStatus?.customerReady
  );
  const hasProteinGroup = groupKeys.has("protein") || groupKeys.has("proteins");
  const hasCarbGroup = groupKeys.has("carb") || groupKeys.has("carbs");
  const hasBuilderRelations = optionGroups.length > 0;
  const hasActiveBuilderRelations = activeGroups.length > 0;
  const selectionType = directSelectionType(product);
  const directCardCompatible = Boolean(selectionType);
  const composedCardCompatible =
    hasBuilderRelations || product.isCustomizable === true;
  const suggestedSelectionTypes = [];
  if (selectionType) suggestedSelectionTypes.push(selectionType);
  if (composedCardCompatible) suggestedSelectionTypes.push("standard_meal");

  const reasonCodes = [];
  if (!status.customerReady) reasonCodes.push(...status.reasonCodes);
  if (NON_MEAL_CARD_VARIANTS.has(cardVariant)) {
    reasonCodes.push("NON_MEAL_CARD_VARIANT");
  }
  if (!directCardCompatible) reasonCodes.push("NOT_DIRECT_MEAL_PRODUCT");
  if (!composedCardCompatible) reasonCodes.push("NO_BUILDER_RELATIONS");
  if (composedCardCompatible && !hasActiveBuilderRelations) {
    reasonCodes.push("NO_ACTIVE_BUILDER_RELATIONS");
  }

  return {
    canonicalAuthority: "meal_builder_section.selectionType",
    itemType,
    cardVariant,
    suggestedSelectionTypes: [...new Set(suggestedSelectionTypes)],
    directAdd: {
      compatible: directCardCompatible,
      eligible: directCardCompatible && status.customerReady,
      selectionType,
      requiresBuilder: false,
      carbsRequired: false,
    },
    composedMeal: {
      compatible: composedCardCompatible,
      eligible:
        composedCardCompatible &&
        hasActiveBuilderRelations &&
        status.customerReady,
      selectionType: "standard_meal",
      requiresBuilder: true,
      carbsRequired: hasCarbGroup,
      hasProteinGroup,
      hasCarbGroup,
      hasBuilderRelations,
      hasActiveBuilderRelations,
    },
    reasonCodes: [...new Set(reasonCodes)],
  };
}

function serializeOptionNode({ relation, option, catalogItemsById }) {
  const relationPayload = serializeDoc(relation);
  const optionPayload = serializeDoc(option);
  const optionStatus = option
    ? serializeStatus(option, catalogItemsById)
    : null;
  const relationStatus = serializeRelationStatus(relation);
  const defaultExtraPriceHalala = Number(option?.extraPriceHalala || 0);
  const overrideExtraPriceHalala =
    relation.extraPriceHalala === null ||
    relation.extraPriceHalala === undefined
      ? null
      : Number(relation.extraPriceHalala || 0);

  return {
    relation: relationPayload,
    relationStatus,
    option: optionPayload
      ? {
          ...optionPayload,
          labelAr: pickLang(option.name || {}, "ar"),
          labelEn: pickLang(option.name || {}, "en"),
          status: optionStatus,
        }
      : null,
    effectiveStatus: {
      active: relationStatus.active && Boolean(optionStatus?.active),
      visible: relationStatus.visible && Boolean(optionStatus?.visible),
      available: relationStatus.available && Boolean(optionStatus?.available),
      customerReady:
        relationStatus.effective && Boolean(optionStatus?.customerReady),
    },
    pricing: {
      defaultExtraPriceHalala,
      overrideExtraPriceHalala,
      effectiveExtraPriceHalala:
        overrideExtraPriceHalala === null
          ? defaultExtraPriceHalala
          : overrideExtraPriceHalala,
      currency: option?.currency || "SAR",
    },
  };
}

async function getCompleteCatalog({ lang = "en" } = {}) {
  const [categories, products, groups, options, groupRelations, optionRelations] =
    await Promise.all([
      MenuCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuProduct.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuOptionGroup.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      MenuOption.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
      ProductOptionGroup.find({})
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean(),
      ProductGroupOption.find({})
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean(),
    ]);

  const catalogItemsById = await loadCatalogItemsByIdForDocs(products, options);
  const categoriesById = new Map(
    categories.map((category) => [String(category._id), category])
  );
  const productsById = new Map(
    products.map((product) => [String(product._id), product])
  );
  const groupsById = new Map(
    groups.map((group) => [String(group._id), group])
  );
  const optionsById = new Map(
    options.map((option) => [String(option._id), option])
  );
  const groupRelationKeys = new Set(
    groupRelations.map((relation) =>
      relationKey(relation.productId, relation.groupId)
    )
  );
  const optionRelationsByProductGroup = new Map();
  for (const relation of optionRelations) {
    const key = relationKey(relation.productId, relation.groupId);
    if (!optionRelationsByProductGroup.has(key)) {
      optionRelationsByProductGroup.set(key, []);
    }
    optionRelationsByProductGroup.get(key).push(relation);
  }
  const groupRelationsByProduct = new Map();
  for (const relation of groupRelations) {
    const productId = String(relation.productId);
    if (!groupRelationsByProduct.has(productId)) {
      groupRelationsByProduct.set(productId, []);
    }
    groupRelationsByProduct.get(productId).push(relation);
  }

  const productNodes = products.map((product) => {
    const productId = String(product._id);
    const category = categoriesById.get(String(product.categoryId)) || null;
    const productStatus = serializeStatus(product, catalogItemsById);
    const optionGroups = (groupRelationsByProduct.get(productId) || []).map(
      (groupRelation) => {
        const group = groupsById.get(String(groupRelation.groupId)) || null;
        const groupStatus = group
          ? serializeStatus(group, catalogItemsById)
          : null;
        const relationStatus = serializeRelationStatus(groupRelation);
        const optionNodes = (
          optionRelationsByProductGroup.get(
            relationKey(productId, groupRelation.groupId)
          ) || []
        ).map((optionRelation) =>
          serializeOptionNode({
            relation: optionRelation,
            option: optionsById.get(String(optionRelation.optionId)) || null,
            catalogItemsById,
          })
        );

        return {
          relation: serializeDoc(groupRelation),
          relationStatus,
          group: group
            ? {
                ...serializeDoc(group),
                labelAr: pickLang(group.name || {}, "ar"),
                labelEn: pickLang(group.name || {}, "en"),
                status: groupStatus,
              }
            : null,
          groupStatus,
          effectiveStatus: {
            active: relationStatus.active && Boolean(groupStatus?.active),
            visible: relationStatus.visible && Boolean(groupStatus?.visible),
            available:
              relationStatus.available && Boolean(groupStatus?.available),
            customerReady:
              relationStatus.effective && Boolean(groupStatus?.customerReady),
          },
          rules: {
            minSelections: Number(groupRelation.minSelections || 0),
            maxSelections:
              groupRelation.maxSelections === null ||
              groupRelation.maxSelections === undefined
                ? null
                : Number(groupRelation.maxSelections),
            isRequired: groupRelation.isRequired === true,
          },
          options: optionNodes,
          optionCount: optionNodes.length,
        };
      }
    );

    return {
      ...serializeDoc(product),
      label: pickLang(product.name || {}, lang),
      labelAr: pickLang(product.name || {}, "ar"),
      labelEn: pickLang(product.name || {}, "en"),
      category: category ? serializeDoc(category) : null,
      status: productStatus,
      optionGroups,
      optionGroupCount: optionGroups.length,
      optionCount: optionGroups.reduce(
        (sum, group) => sum + group.optionCount,
        0
      ),
      mealPlanner: classifyProduct({
        product,
        optionGroups,
        status: productStatus,
      }),
    };
  });

  const orphanProductIds = products
    .filter((product) => !categoriesById.has(String(product.categoryId)))
    .map((product) => String(product._id));
  const orphanGroupRelationIds = groupRelations
    .filter(
      (relation) =>
        !productsById.has(String(relation.productId)) ||
        !groupsById.has(String(relation.groupId))
    )
    .map((relation) => String(relation._id));
  const orphanOptionRelationIds = optionRelations
    .filter(
      (relation) =>
        !productsById.has(String(relation.productId)) ||
        !groupsById.has(String(relation.groupId)) ||
        !optionsById.has(String(relation.optionId))
    )
    .map((relation) => String(relation._id));
  const unscopedOptionRelationIds = optionRelations
    .filter(
      (relation) =>
        !groupRelationKeys.has(
          relationKey(relation.productId, relation.groupId)
        )
    )
    .map((relation) => String(relation._id));
  const mismatchedOptionGroupRelationIds = optionRelations
    .filter((relation) => {
      const option = optionsById.get(String(relation.optionId));
      return option && String(option.groupId) !== String(relation.groupId);
    })
    .map((relation) => String(relation._id));

  return {
    contractVersion: CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    complete: true,
    filters: {
      includeInactive: true,
      includeHidden: true,
      includeUnavailable: true,
      includeUnpublished: true,
      includeAllChannels: true,
    },
    counts: {
      categories: categories.length,
      products: products.length,
      optionGroups: groups.length,
      options: options.length,
      productOptionGroups: groupRelations.length,
      productGroupOptions: optionRelations.length,
    },
    categories: categories.map((category) => ({
      ...serializeDoc(category),
      label: pickLang(category.name || {}, lang),
      status: serializeStatus(category, catalogItemsById),
    })),
    products: productNodes,
    optionGroups: groups.map((group) => ({
      ...serializeDoc(group),
      label: pickLang(group.name || {}, lang),
      status: serializeStatus(group, catalogItemsById),
    })),
    options: options.map((option) => ({
      ...serializeDoc(option),
      label: pickLang(option.name || {}, lang),
      status: serializeStatus(option, catalogItemsById),
    })),
    relations: {
      productOptionGroups: groupRelations.map((relation) => ({
        ...serializeDoc(relation),
        productId: stringId(relation.productId),
        groupId: stringId(relation.groupId),
        status: serializeRelationStatus(relation),
      })),
      productGroupOptions: optionRelations.map((relation) => ({
        ...serializeDoc(relation),
        productId: stringId(relation.productId),
        groupId: stringId(relation.groupId),
        optionId: stringId(relation.optionId),
        status: serializeRelationStatus(relation),
      })),
    },
    diagnostics: {
      orphanProductIds,
      orphanGroupRelationIds,
      orphanOptionRelationIds,
      unscopedOptionRelationIds,
      mismatchedOptionGroupRelationIds,
      hasOrphans:
        orphanProductIds.length > 0 ||
        orphanGroupRelationIds.length > 0 ||
        orphanOptionRelationIds.length > 0,
      hasRelationIntegrityIssues:
        unscopedOptionRelationIds.length > 0 ||
        mismatchedOptionGroupRelationIds.length > 0,
    },
  };
}

module.exports = {
  CONTRACT_VERSION,
  getCompleteCatalog,
};

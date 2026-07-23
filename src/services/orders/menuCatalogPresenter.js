const { pickLang } = require("../../utils/i18n");
const {
  buildProteinOptionSections,
  getProteinFamilyNameI18n,
  resolveProteinVisualFamilyKey,
} = require("../../config/mealPlannerContract");
const {
  normalizeCategoryUiMetadata,
  normalizeGroupUiMetadata,
  normalizeProductUiMetadata,
} = require("../catalog/catalogKeyUiHelpers");

const SYSTEM_CURRENCY = "SAR";

function localizeName(value, lang) {
  return pickLang(value, lang) || pickLang(value, "en") || pickLang(value, "ar") || "";
}

function localizedPair(value) {
  return {
    ar: pickLang(value, "ar") || "",
    en: pickLang(value, "en") || "",
  };
}

function truthyByDefault(value) {
  return value !== false;
}

// Presentation metadata is stored in MongoDB and authored from the dashboard.
// Do not infer or override it from category/product keys here.
function buildPublicCategoryUi(category) {
  return normalizeCategoryUiMetadata(category.ui);
}

function buildMobilePublicProductUi(product) {
  return { cardSize: normalizeProductUiMetadata(product.ui).cardSize };
}

function buildPublicProductUi(product) {
  return normalizeProductUiMetadata(product.ui);
}

function serializePublicCategory(category, lang, products, { includeUi = false } = {}) {
  const payload = {
    id: String(category._id),
    key: category.key,
    name: localizeName(category.name, lang),
    nameI18n: localizedPair(category.name),
    description: localizeName(category.description, lang),
    descriptionI18n: localizedPair(category.description),
    imageUrl: category.imageUrl || "",
    sortOrder: Number(category.sortOrder || 0),
    products,
  };
  if (includeUi) payload.ui = buildPublicCategoryUi(category);
  return payload;
}

function serializePublicProduct(product, lang, optionGroups, categoryId = product.categoryId, { includePresentationUi = false } = {}) {
  const hasOptionGroups = Array.isArray(optionGroups) && optionGroups.length > 0;
  const isCustomizable = Boolean(product.isCustomizable) && (product.pricingModel === "per_100g" || hasOptionGroups);
  const requiresBuilder = isCustomizable;
  const canAddDirectly = product.pricingModel === "fixed" && !requiresBuilder && !hasOptionGroups;
  return {
    id: String(product._id),
    key: product.key,
    categoryId: String(categoryId),
    name: localizeName(product.name, lang),
    nameI18n: localizedPair(product.name),
    description: localizeName(product.description, lang),
    descriptionI18n: localizedPair(product.description),
    imageUrl: product.imageUrl || "",
    itemType: product.itemType,
    pricingModel: product.pricingModel,
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || SYSTEM_CURRENCY,
    baseUnitGrams: Number(product.baseUnitGrams || 100),
    defaultWeightGrams: Number(product.defaultWeightGrams || 0),
    minWeightGrams: Number(product.minWeightGrams || 0),
    maxWeightGrams: Number(product.maxWeightGrams || 0),
    weightStepGrams: Number(product.weightStepGrams || 50),
    sortOrder: Number(product.sortOrder || 0),
    ui: includePresentationUi
      ? buildPublicProductUi(product)
      : buildMobilePublicProductUi(product),
    isCustomizable,
    requiresBuilder,
    canAddDirectly,
    optionGroups,
  };
}

function serializePublicGroup(relation, group, options, lang) {
  const payload = {
    id: String(group._id),
    groupId: String(group._id),
    key: group.key,
    name: localizeName(group.name, lang),
    nameI18n: localizedPair(group.name),
    minSelections: Number(relation.minSelections || 0),
    maxSelections: relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections),
    isRequired: Boolean(relation.isRequired),
    sortOrder: Number(relation.sortOrder || group.sortOrder || 0),
    ui: normalizeGroupUiMetadata(group.ui),
    options,
  };
  if (group.key === "proteins") {
    const optionSections = buildProteinOptionSections(options, lang);
    if (optionSections.length) payload.optionSections = optionSections;
  }
  return payload;
}

function serializePublicOption(relation, option, lang) {
  const extraPriceHalala = relation.extraPriceHalala === null || relation.extraPriceHalala === undefined
    ? Number(option.extraPriceHalala || 0) : Number(relation.extraPriceHalala || 0);
  const extraWeightUnitGrams = relation.extraWeightUnitGrams === null || relation.extraWeightUnitGrams === undefined
    ? Number(option.extraWeightUnitGrams || 0) : Number(relation.extraWeightUnitGrams || 0);
  const extraWeightPriceHalala = relation.extraWeightPriceHalala === null || relation.extraWeightPriceHalala === undefined
    ? Number(option.extraWeightPriceHalala || 0) : Number(relation.extraWeightPriceHalala || 0);
  const payload = {
    id: String(option._id),
    optionId: String(option._id),
    groupId: String(option.groupId),
    key: option.key,
    name: localizeName(option.name, lang),
    nameI18n: localizedPair(option.name),
    description: localizeName(option.description, lang),
    descriptionI18n: localizedPair(option.description),
    imageUrl: option.imageUrl || "",
    extraPriceHalala,
    extraFeeHalala: extraPriceHalala,
    extraWeightUnitGrams,
    extraWeightPriceHalala,
    calories: Number(option.nutrition?.calories || 0),
    displayCategoryKey: option.displayCategoryKey || "",
    premiumKey: option.premiumKey || "",
    selectionType: option.selectionType || "",
    isPremium: Boolean(option.premiumKey),
    sortOrder: Number(relation.sortOrder || option.sortOrder || 0),
  };
  const proteinFamilyKey = resolveProteinVisualFamilyKey(option);
  if (proteinFamilyKey) {
    payload.proteinFamilyKey = proteinFamilyKey;
    payload.proteinFamilyNameI18n = getProteinFamilyNameI18n(proteinFamilyKey);
    payload.displayCategoryKey = proteinFamilyKey;
  }
  return payload;
}

function serializeStatus(doc = {}) {
  return {
    isActive: truthyByDefault(doc && doc.isActive),
    isVisible: truthyByDefault(doc && doc.isVisible),
    isAvailable: truthyByDefault(doc && doc.isAvailable),
  };
}

function serializeEffectiveStatus(globalDoc = {}, relationDoc = {}) {
  const global = serializeStatus(globalDoc);
  const product = serializeStatus(relationDoc);
  return {
    global,
    product,
    effective: {
      isActive: global.isActive && product.isActive,
      isVisible: global.isVisible && product.isVisible,
      isAvailable: global.isAvailable && product.isAvailable,
    },
  };
}

function serializeDashboardPreviewCategory(category, lang, products) {
  return {
    ...serializePublicCategory(category, lang, products, { includeUi: true }),
    categoryId: String(category._id),
    status: serializeStatus(category),
    isActive: truthyByDefault(category.isActive),
    isVisible: truthyByDefault(category.isVisible),
    isAvailable: truthyByDefault(category.isAvailable),
  };
}

function serializeDashboardPreviewProduct(product, lang, optionGroups, categoryId = product.categoryId) {
  return {
    ...serializePublicProduct(product, lang, optionGroups, categoryId, { includePresentationUi: true }),
    productId: String(product._id),
    categoryId: String(categoryId),
    status: serializeStatus(product),
    isActive: truthyByDefault(product.isActive),
    isVisible: truthyByDefault(product.isVisible),
    isAvailable: truthyByDefault(product.isAvailable),
    isCustomizable: Boolean(product.isCustomizable),
  };
}

function serializeDashboardPreviewGroup(relation, group, options, lang) {
  return {
    ...serializePublicGroup(relation, group, options, lang),
    productGroupId: String(relation._id),
    groupId: String(group._id),
    status: serializeEffectiveStatus(group, relation),
    isActive: truthyByDefault(relation.isActive),
    isVisible: truthyByDefault(relation.isVisible),
    isAvailable: truthyByDefault(relation.isAvailable),
  };
}

function serializeDashboardPreviewOption(relation, option, lang) {
  return {
    ...serializePublicOption(relation, option, lang),
    productOptionId: String(relation._id),
    optionId: String(option._id),
    groupId: String(relation.groupId),
    suggestedGroupId: option.groupId ? String(option.groupId) : null,
    status: serializeEffectiveStatus(option, relation),
    isActive: truthyByDefault(relation.isActive),
    isVisible: truthyByDefault(relation.isVisible),
    isAvailable: truthyByDefault(relation.isAvailable),
  };
}

// Visibility, category placement, linked groups, and ordering are database data.
// Runtime code must not keep a second allowlist keyed by seeded entity names.
function isCustomerVisibleProduct() {
  return true;
}

function isCustomerVisibleGroup() {
  return true;
}

function isCustomerVisibleOption(option) {
  return !Array.isArray(option.ruleTags) || !option.ruleTags.includes("missing_external");
}

function resolvePublicProductCategory(product, categoriesById) {
  return categoriesById.get(String(product.categoryId)) || null;
}

function sortPublicProducts(left, right) {
  return Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
    || String(left.key || "").localeCompare(String(right.key || ""));
}

module.exports = {
  localizeName,
  localizedPair,
  truthyByDefault,
  serializePublicCategory,
  serializePublicProduct,
  serializePublicGroup,
  serializePublicOption,
  serializeDashboardPreviewCategory,
  serializeDashboardPreviewProduct,
  serializeDashboardPreviewGroup,
  serializeDashboardPreviewOption,
  isCustomerVisibleProduct,
  isCustomerVisibleGroup,
  isCustomerVisibleOption,
  resolvePublicProductCategory,
  sortPublicProducts,
};

const { pickLang } = require("../../utils/i18n");
const {
  CUSTOMER_VISIBLE_CARB_KEYS,
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
const CUSTOMER_VISIBLE_CARB_KEY_SET = new Set(CUSTOMER_VISIBLE_CARB_KEYS);
const BASIC_MEAL_PUBLIC_GROUP_KEY_SET = new Set(["carbs", "proteins"]);
const HIDDEN_PUBLIC_PRODUCT_KEYS = new Set(["small_salad"]);
const PUBLIC_PRODUCT_CATEGORY_KEY_OVERRIDES = new Map([
  ["basic_meal", "custom_order"],
  ["green_salad", "light_options"],
  ["fruit_salad", "light_options"],
  ["greek_yogurt", "light_options"],
]);
const RTL_LTR_MEDIA_POSITION = Object.freeze({ ar: "left", en: "right" });
const CTA_LABELS = Object.freeze({
  start_customizing: { ar: "ابدأ التخصيص", en: "Start Customizing" },
  customize: { ar: "اختر الإضافة", en: "Customize" },
  add_to_cart: { ar: "أضف للسلة", en: "Add to Cart" },
});
const CATEGORY_PRESENTATION_BY_KEY = Object.freeze({
  custom_order: { cardVariant: "hero_builder_collection", layout: "vertical_hero_list" },
  light_options: { cardVariant: "compact_builder_collection", layout: "vertical_compact_builder_list" },
  meals: { cardVariant: "meal_collection", layout: "vertical_meal_list" },
  carbs: { cardVariant: "compact_product_collection", layout: "horizontal_or_grid_compact_cards" },
  cold_sandwiches: { cardVariant: "sandwich_collection", layout: "vertical_compact_cards" },
  desserts: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" },
  juices: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" },
  drinks: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" },
  ice_cream: { cardVariant: "addon_collection", layout: "horizontal_or_grid_addon_cards" },
});

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

function buildPublicCategoryUi(category) {
  return {
    ...normalizeCategoryUiMetadata(category.ui),
    ...(CATEGORY_PRESENTATION_BY_KEY[category.key] || {}),
  };
}

function buildMobilePublicProductUi(product) {
  return { cardSize: normalizeProductUiMetadata(product.ui).cardSize };
}

function productUiWithAction(ui, ctaLabel, behaviorHint, priceLabelMode) {
  return {
    ...ui,
    ctaLabel,
    ctaLabelI18n: CTA_LABELS[ctaLabel],
    behaviorHint,
    priceLabelMode,
  };
}

function buildPublicProductUi(product, categoryKey, { hasOptionGroups, requiresBuilder, canAddDirectly }) {
  const baseUi = normalizeProductUiMetadata(product.ui);
  if (categoryKey === "custom_order") {
    return productUiWithAction({
      ...baseUi,
      cardVariant: "hero_builder",
      imageRatio: "wide",
      showDescription: true,
      showPrice: true,
      mediaPositionByLocale: RTL_LTR_MEDIA_POSITION,
    }, "start_customizing", "open_builder", "per_unit_or_from");
  }
  if (categoryKey === "light_options") {
    return productUiWithAction({
      ...baseUi,
      cardVariant: "compact_builder",
      imageRatio: "square",
      showDescription: true,
      showPrice: true,
      mediaPositionByLocale: RTL_LTR_MEDIA_POSITION,
    }, "start_customizing", "open_builder", "final_depends_on_options");
  }
  if (categoryKey === "meals") {
    const customizable = requiresBuilder && hasOptionGroups;
    return productUiWithAction({
      ...baseUi,
      cardVariant: customizable ? "ready_meal_customizable" : "ready_meal",
      imageRatio: "square",
      showDescription: true,
      showPrice: true,
      mediaPositionByLocale: RTL_LTR_MEDIA_POSITION,
    }, customizable ? "customize" : "add_to_cart", customizable ? "customize_optional_addons" : "direct_add", customizable ? "from_price" : "fixed");
  }
  if (categoryKey === "carbs") {
    return productUiWithAction({
      ...baseUi,
      cardVariant: "compact_product",
      imageRatio: "square",
      showPrice: true,
    }, "add_to_cart", "direct_add", "fixed");
  }
  if (categoryKey === "cold_sandwiches") {
    return productUiWithAction({
      ...baseUi,
      cardVariant: "sandwich_card",
      imageRatio: "square",
      showDescription: true,
      showPrice: true,
    }, "add_to_cart", "direct_add", "fixed");
  }
  if (["desserts", "juices", "drinks", "ice_cream"].includes(categoryKey)) {
    return productUiWithAction({
      ...baseUi,
      cardVariant: "addon_card",
      imageRatio: "square",
      showPrice: true,
    }, "add_to_cart", "direct_add", "fixed");
  }
  if (requiresBuilder) {
    return productUiWithAction(baseUi, baseUi.ctaLabel || "customize", "open_builder", product.pricingModel === "per_100g" ? "per_unit" : "final_depends_on_options");
  }
  if (canAddDirectly) {
    return productUiWithAction(baseUi, baseUi.ctaLabel || "add_to_cart", "direct_add", "fixed");
  }
  return baseUi;
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
  const categoryKey = product._publicCategoryKey || "";
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
      ? buildPublicProductUi(product, categoryKey, { hasOptionGroups, requiresBuilder, canAddDirectly })
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
    imageUrl: option.imageUrl || "",
    extraPriceHalala,
    extraWeightUnitGrams,
    extraWeightPriceHalala,
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

function isCustomerVisibleProduct(product, category) {
  if (HIDDEN_PUBLIC_PRODUCT_KEYS.has(product.key)) return false;
  if (category?.key === "carbs") return CUSTOMER_VISIBLE_CARB_KEY_SET.has(product.key);
  return true;
}

function isCustomerVisibleGroup(product, group) {
  if (product?.key === "basic_meal") return BASIC_MEAL_PUBLIC_GROUP_KEY_SET.has(group?.key);
  return true;
}

function isCustomerVisibleOption(option, group) {
  if (group?.key === "carbs") return CUSTOMER_VISIBLE_CARB_KEY_SET.has(option.key);
  return !Array.isArray(option.ruleTags) || !option.ruleTags.includes("missing_external");
}

function resolvePublicProductCategory(product, categoriesById, categoriesByKey) {
  return categoriesById.get(String(product.categoryId))
    || categoriesByKey.get(PUBLIC_PRODUCT_CATEGORY_KEY_OVERRIDES.get(product.key))
    || null;
}

function sortPublicProducts(left, right) {
  if (left.key === "basic_meal") return -1;
  if (right.key === "basic_meal") return 1;
  return left.sortOrder - right.sortOrder;
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

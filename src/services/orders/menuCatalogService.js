const mongoose = require("mongoose");

const BuilderProtein = require("../../models/BuilderProtein");
const MenuAuditLog = require("../../models/MenuAuditLog");
const MenuCategory = require("../../models/MenuCategory");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const MenuVersion = require("../../models/MenuVersion");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const Sandwich = require("../../models/Sandwich");
const Setting = require("../../models/Setting");
const { pickLang } = require("../../utils/i18n");
const {
  assertCatalogItemLinkable,
  filterGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const {
  CUSTOMER_VISIBLE_CARB_KEYS,
  STANDARD_MEAL_PROTEIN_KEYS,
  buildProteinOptionSections,
  getProteinFamilyNameI18n,
  resolveProteinVisualFamilyKey,
} = require("../../config/mealPlannerContract");
const {
  generateUniqueKey,
  isAllowedCategoryCardVariant,
  isAllowedCardVariant,
  isAllowedGroupDisplayStyle,
  normalizeCategoryUiMetadata,
  normalizeGroupUiMetadata,
  normalizeProductUiMetadata,
  normalizeUiMetadata,
} = require("../catalog/catalogKeyUiHelpers");

const SYSTEM_CURRENCY = "SAR";
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const PRODUCT_ITEM_TYPES = [
  "basic_salad",
  "basic_meal",
  "fruit_salad",
  "greek_yogurt",
  "green_salad",
  "cold_sandwich",
  "sourdough",
  "dessert",
  "juice",
  "drink",
  "ice_cream",
  "product",
];
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
const PRODUCT_ITEM_TYPES_CUSTOMIZABLE_BY_DEFAULT = new Set([
  "basic_salad",
  "basic_meal",
  "fruit_salad",
  "greek_yogurt",
  "green_salad",
]);

class MenuValidationError extends Error {
  constructor(message, code = "VALIDATION_ERROR", status = 400, details) {
    super(message);
    this.name = "MenuValidationError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

class MenuNotFoundError extends Error {
  constructor(message = "Menu entity not found", code = "MENU_ENTITY_NOT_FOUND") {
    super(message);
    this.name = "MenuNotFoundError";
    this.code = code;
    this.status = 404;
  }
}

function assertObjectId(value, fieldName = "id") {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw new MenuValidationError(`${fieldName} must be a valid ObjectId`, "INVALID_OBJECT_ID");
  }
  return String(value);
}

function normalizeOptionalObjectId(value, fieldName = "id", fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  return assertObjectId(value, fieldName);
}

async function mirrorCompatibilityImage(Model, id, imageUrl) {
  await Model.updateOne({ _id: id }, { $set: { imageUrl: String(imageUrl || "").trim() } });
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value, fieldName = "key") {
  const key = String(value || "").trim().toLowerCase();
  if (!key) throw new MenuValidationError(`${fieldName} is required`);
  if (!SNAKE_CASE_PATTERN.test(key)) {
    throw new MenuValidationError(`${fieldName} must be snake_case`);
  }
  return key;
}

function normalizeOptionalKey(value, fieldName = "key") {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return normalizeKey(value, fieldName);
}

function assertImmutableKey(body, existing, fieldName = "key") {
  if (!existing || body[fieldName] === undefined) return;
  const nextKey = normalizeKey(body[fieldName], fieldName);
  if (nextKey !== existing[fieldName]) {
    throw new MenuValidationError(`${fieldName} is immutable`, "IMMUTABLE_KEY", 400, { fieldName });
  }
}

function assertImmutableCatalogItemLink(body, existing) {
  if (!existing || !Object.prototype.hasOwnProperty.call(body || {}, "catalogItemId")) return;
  const current = existing.catalogItemId ? String(existing.catalogItemId) : "";
  const next = body.catalogItemId === null || body.catalogItemId === "" || body.catalogItemId === undefined
    ? ""
    : assertObjectId(body.catalogItemId, "catalogItemId");
  if (current && next !== current) {
    throw new MenuValidationError("catalogItemId link is immutable after first assignment", "IMMUTABLE_CATALOG_ITEM_LINK", 400, {
      fieldName: "catalogItemId",
    });
  }
}

function localizedString(value, fieldName, { required = false } = {}) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (required && !trimmed) throw new MenuValidationError(`${fieldName} is required`);
    return { ar: "", en: trimmed };
  }
  if (isPlainObject(value)) {
    const ar = value.ar === undefined || value.ar === null ? "" : String(value.ar).trim();
    const en = value.en === undefined || value.en === null ? "" : String(value.en).trim();
    if (required && !ar && !en) throw new MenuValidationError(`${fieldName} is required`);
    return { ar, en };
  }
  if (required) throw new MenuValidationError(`${fieldName} is required`);
  return { ar: "", en: "" };
}

function optionalLocalizedString(value, fieldName) {
  return value === undefined ? undefined : localizedString(value, fieldName);
}

function normalizeBoolean(value, fieldName, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  throw new MenuValidationError(`${fieldName} must be boolean`);
}

function normalizeNonNegativeInteger(value, fieldName, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new MenuValidationError(`${fieldName} must be an integer >= 0`);
  }
  return parsed;
}

function normalizeNullableNonNegativeInteger(value, fieldName, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  return normalizeNonNegativeInteger(value, fieldName, fallback || 0);
}

function normalizeStringArray(value, fieldName) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new MenuValidationError(`${fieldName} must be an array`);
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeAvailableFor(value, fieldName = "availableFor", fallback = ["one_time", "subscription"]) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.map((item) => String(item || "").trim()).filter(Boolean);
  const allowed = new Set(["one_time", "subscription"]);
  const invalid = normalized.find((item) => !allowed.has(item));
  if (invalid) throw new MenuValidationError(`${fieldName} contains an unsupported channel`);
  return [...new Set(normalized)];
}

function normalizeOptionalString(value, fieldName, fallback = "") {
  if (value === undefined) return fallback;
  if (value === null) return "";
  if (typeof value !== "string") throw new MenuValidationError(`${fieldName} must be a string`);
  return value.trim();
}

function localizeName(value, lang) {
  return pickLang(value, lang) || pickLang(value, "en") || pickLang(value, "ar") || "";
}

function localizedPair(value) {
  return {
    ar: pickLang(value, "ar") || "",
    en: pickLang(value, "en") || "",
  };
}

function serializeDoc(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return { id: String(obj._id), ...obj };
}

function serializeDashboardOption(option) {
  const payload = serializeDoc(option);
  if (!payload) return null;
  delete payload.displayCategoryKey;
  delete payload.proteinFamilyKey;
  delete payload.premiumKey;
  delete payload.selectionType;
  delete payload.ruleTags;
  return payload;
}

function parsePaginationOptions(options = {}) {
  const pageRequested = options.page !== undefined && options.page !== null && String(options.page).trim() !== "";
  const limitRequested = options.limit !== undefined && options.limit !== null && String(options.limit).trim() !== "";
  if (!pageRequested && !limitRequested) return null;

  const page = Math.max(1, Number.parseInt(options.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(options.limit || "25", 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

function truthyByDefault(value) {
  return value !== false;
}

function inferProductCustomizable(product = {}, optionGroups = undefined) {
  if (
    Array.isArray(optionGroups)
    && optionGroups.some((group) => (
      group
      && group.isActive !== false
      && group.isVisible !== false
      && group.isAvailable !== false
    ))
  ) {
    return true;
  }
  if (product.isCustomizable !== undefined && product.isCustomizable !== null) {
    return Boolean(product.isCustomizable);
  }
  if (product.pricingModel === "per_100g") return true;
  return PRODUCT_ITEM_TYPES_CUSTOMIZABLE_BY_DEFAULT.has(String(product.itemType || ""));
}

async function refreshProductCustomizableFromRelations(productId) {
  const product = await MenuProduct.findById(productId).select("pricingModel itemType").lean();
  if (!product) return false;
  const relationCount = await ProductOptionGroup.countDocuments({
    productId,
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  });
  const isCustomizable = relationCount > 0
    || product.pricingModel === "per_100g"
    || PRODUCT_ITEM_TYPES_CUSTOMIZABLE_BY_DEFAULT.has(String(product.itemType || ""));
  await MenuProduct.updateOne({ _id: productId }, { $set: { isCustomizable } });
  return isCustomizable;
}

function customerCatalogQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    publishedAt: { $ne: null },
    ...extra,
  };
}

function availableForChannelQuery(channel) {
  return {
    $or: [
      { availableFor: { $exists: false } },
      { availableFor: [] },
      { availableFor: channel },
    ],
  };
}

function customerRelationQuery(extra = {}) {
  return {
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
    ...extra,
  };
}

function assertCustomerAvailable(doc, code, message, status = 409) {
  if (!doc || doc.isActive === false || doc.isVisible === false || doc.isAvailable === false || !doc.publishedAt) {
    const err = new MenuValidationError(message, code, status);
    throw err;
  }
}

function assertRelationAvailable(doc, code, message, status = 409) {
  if (!doc || doc.isActive === false || doc.isVisible === false || doc.isAvailable === false) {
    throw new MenuValidationError(message, code, status);
  }
}

function buildPublicCategoryUi(category) {
  return {
    ...normalizeCategoryUiMetadata(category.ui),
    ...(CATEGORY_PRESENTATION_BY_KEY[category.key] || {}),
  };
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

function serializePublicCategory(category, lang, products) {
  return {
    id: String(category._id),
    key: category.key,
    name: localizeName(category.name, lang),
    nameI18n: localizedPair(category.name),
    description: localizeName(category.description, lang),
    descriptionI18n: localizedPair(category.description),
    imageUrl: category.imageUrl || "",
    sortOrder: Number(category.sortOrder || 0),
    ui: buildPublicCategoryUi(category),
    products,
  };
}

function serializePublicProduct(product, lang, optionGroups, categoryId = product.categoryId) {
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
    ui: buildPublicProductUi(product, categoryKey, { hasOptionGroups, requiresBuilder, canAddDirectly }),
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
    maxSelections: relation.maxSelections === null || relation.maxSelections === undefined
      ? null
      : Number(relation.maxSelections),
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
    ? Number(option.extraPriceHalala || 0)
    : Number(relation.extraPriceHalala || 0);
  const extraWeightUnitGrams = relation.extraWeightUnitGrams === null || relation.extraWeightUnitGrams === undefined
    ? Number(option.extraWeightUnitGrams || 0)
    : Number(relation.extraWeightUnitGrams || 0);
  const extraWeightPriceHalala = relation.extraWeightPriceHalala === null || relation.extraWeightPriceHalala === undefined
    ? Number(option.extraWeightPriceHalala || 0)
    : Number(relation.extraWeightPriceHalala || 0);
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

function isCustomerVisibleProduct(product, category) {
  if (HIDDEN_PUBLIC_PRODUCT_KEYS.has(product.key)) return false;
  if (category?.key === "carbs") return CUSTOMER_VISIBLE_CARB_KEY_SET.has(product.key);
  return true;
}

function isCustomerVisibleGroup(product, group) {
  if (product?.key === "basic_meal") return BASIC_MEAL_PUBLIC_GROUP_KEY_SET.has(group?.key);
  return true;
}

function isCustomerVisibleOption(option, group, product) {
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

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

async function hasPublishedMenuCatalog() {
  const count = await MenuProduct.countDocuments(customerCatalogQuery(availableForChannelQuery("one_time")));
  return count > 0;
}

async function getPublishedMenu({ lang = "en", branchId = "" } = {}) {
  const productQuery = customerCatalogQuery(availableForChannelQuery("one_time"));
  const categoryQuery = customerCatalogQuery();
  if (branchId) {
    const channelOr = productQuery.$or;
    delete productQuery.$or;
    productQuery.$and = [
      { $or: channelOr },
      { $or: [{ branchAvailability: { $size: 0 } }, { branchAvailability: branchId }] },
    ];
    categoryQuery.$or = [{ "availability.branchIds": { $size: 0 } }, { "availability.branchIds": branchId }];
  }

  const [categories, productRows, groupRelations, optionRelations, groups, optionRows, vatPercentageRaw] = await Promise.all([
    MenuCategory.find(categoryQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuProduct.find(productQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductOptionGroup.find(customerRelationQuery()).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductGroupOption.find(customerRelationQuery()).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuOptionGroup.find(customerCatalogQuery()).lean(),
    MenuOption.find(customerCatalogQuery(availableForChannelQuery("one_time"))).lean(),
    getSettingValue("vat_percentage", 0),
  ]);
  const catalogItemsById = await loadCatalogItemsByIdForDocs(productRows, optionRows);
  const products = filterGloballyAvailable(productRows, catalogItemsById);
  const options = filterGloballyAvailable(optionRows, catalogItemsById);

  const categoryIds = new Set(categories.map((category) => String(category._id)));
  const categoriesById = new Map(categories.map((category) => [String(category._id), category]));
  const categoriesByKey = new Map(categories.map((category) => [category.key, category]));
  const productsByCategory = new Map();
  const productsById = new Map(
    products
      .filter((product) => (
        categoryIds.has(String(product.categoryId))
        && isCustomerVisibleProduct(product, categoriesById.get(String(product.categoryId)))
      ))
      .map((product) => [String(product._id), product])
  );
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const optionRelationsByProductGroup = new Map();

  optionRelations.forEach((relation) => {
    const key = `${relation.productId}:${relation.groupId}`;
    if (!optionRelationsByProductGroup.has(key)) optionRelationsByProductGroup.set(key, []);
    optionRelationsByProductGroup.get(key).push(relation);
  });

  groupRelations.forEach((relation) => {
    const product = productsById.get(String(relation.productId));
    const group = groupsById.get(String(relation.groupId));
    if (product && product.isCustomizable === false) return;
    if (!product || !group || !isCustomerVisibleGroup(product, group)) return;
    const optionRows = (optionRelationsByProductGroup.get(`${relation.productId}:${relation.groupId}`) || [])
      .map((optionRelation) => {
        const option = optionsById.get(String(optionRelation.optionId));
        if (!option || !isCustomerVisibleOption(option, group, product)) return null;
        return serializePublicOption(optionRelation, option, lang);
      })
      .filter(Boolean)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const serializedGroup = serializePublicGroup(relation, group, optionRows, lang);
    const productKey = String(product._id);
    if (!product._publicGroups) product._publicGroups = [];
    product._publicGroups.push(serializedGroup);
    productsById.set(productKey, product);
  });

  productsById.forEach((product) => {
    const publicCategory = resolvePublicProductCategory(product, categoriesById, categoriesByKey);
    if (!publicCategory) return;
    if (String(product.categoryId) !== String(publicCategory._id)) return;
    product._publicCategoryKey = publicCategory.key;
    const categoryId = String(publicCategory._id);
    if (!productsByCategory.has(categoryId)) productsByCategory.set(categoryId, []);
    const groupsForProduct = Array.isArray(product._publicGroups)
      ? product._publicGroups.sort((a, b) => a.sortOrder - b.sortOrder)
      : [];
    productsByCategory.get(categoryId).push(serializePublicProduct(product, lang, groupsForProduct, publicCategory._id));
  });

  const serializedCategories = categories
    .map((category) => {
      const rows = (productsByCategory.get(String(category._id)) || [])
        .sort(sortPublicProducts);
      return serializePublicCategory(category, lang, rows);
    })
    .filter((category) => category.products.length > 0);

  return {
    source: "one_time_order",
    fulfillmentMethod: "pickup",
    currency: SYSTEM_CURRENCY,
    vatIncluded: true,
    vatPercentage: Number(vatPercentageRaw || 0),
    itemTypes: PRODUCT_ITEM_TYPES,
    categories: serializedCategories,
  };
}

async function writeMenuAudit({ entityType, entityId, action, before = null, after = null, actor = {}, meta = {} }) {
  if (!entityId) return;
  await MenuAuditLog.create({
    entityType,
    entityId,
    action,
    before,
    after,
    actorId: actor.userId && mongoose.Types.ObjectId.isValid(actor.userId) ? actor.userId : null,
    actorRole: actor.role || "",
    meta,
  });
}

function buildListQuery({ includeInactive = false, isActive, isVisible, isAvailable, q, published } = {}) {
  const query = {};
  if (isActive !== undefined && isActive !== null && String(isActive).trim() !== "") {
    query.isActive = normalizeBoolean(isActive, "isActive");
  } else if (!includeInactive) {
    query.isActive = true;
  }
  if (isVisible !== undefined && isVisible !== null && String(isVisible).trim() !== "") {
    query.isVisible = normalizeBoolean(isVisible, "isVisible");
  }
  if (isAvailable !== undefined && isAvailable !== null && String(isAvailable).trim() !== "") {
    query.isAvailable = normalizeBoolean(isAvailable, "isAvailable");
  }
  if (published !== undefined && published !== null && String(published).trim() !== "") {
    const showPublished = normalizeBoolean(published, "published");
    query.publishedAt = showPublished ? { $ne: null } : null;
  }
  if (q !== undefined && q !== null && String(q).trim()) {
    const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    query.$or = [{ key: regex }, { "name.ar": regex }, { "name.en": regex }];
  }
  return query;
}

function buildProductFilter(options = {}) {
  const {
    categoryId,
    availableFor,
    itemType,
    search,
  } = options;
  const query = buildListQuery({
    ...options,
    q: options.q || search,
  });

  if (categoryId !== undefined && categoryId !== null && String(categoryId).trim() !== "") {
    if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
      throw new MenuValidationError("Invalid categoryId", "INVALID_CATEGORY_ID", 400);
    }
    query.categoryId = new mongoose.Types.ObjectId(String(categoryId));
  }

  if (availableFor !== undefined && availableFor !== null && String(availableFor).trim() !== "") {
    const channel = String(availableFor).trim();
    if (!["one_time", "subscription"].includes(channel)) {
      throw new MenuValidationError("availableFor contains an unsupported channel");
    }
    query.availableFor = channel;
  }

  if (itemType !== undefined && itemType !== null && String(itemType).trim() !== "") {
    const normalizedItemType = String(itemType).trim();
    if (!PRODUCT_ITEM_TYPES.includes(normalizedItemType)) {
      throw new MenuValidationError(`itemType must be one of: ${PRODUCT_ITEM_TYPES.join(", ")}`);
    }
    query.itemType = normalizedItemType;
  }

  return query;
}

async function listModel(Model, options = {}, extraQuery = {}, serializer = serializeDoc) {
  const query = { ...buildListQuery(options), ...extraQuery };
  const pagination = parsePaginationOptions(options);
  const find = Model.find(query)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  if (!pagination) {
    const rows = await find;
    return rows.map(serializer);
  }

  const [rows, total] = await Promise.all([
    find.skip(pagination.skip).limit(pagination.limit),
    Model.countDocuments(query),
  ]);

  return {
    items: rows.map(serializer),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  };
}

async function listProducts(options = {}) {
  const query = buildProductFilter(options);
  const pagination = parsePaginationOptions(options);
  const find = MenuProduct.find(query)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  if (!pagination) {
    const rows = await find;
    return rows.map(serializeDoc);
  }

  const [rows, total] = await Promise.all([
    find.skip(pagination.skip).limit(pagination.limit),
    MenuProduct.countDocuments(query),
  ]);

  return {
    items: rows.map(serializeDoc),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  };
}

async function listOptions(options = {}) {
  return listModel(
    MenuOption,
    options,
    options && options.groupId ? { groupId: assertObjectId(options.groupId, "groupId") } : {},
    serializeDashboardOption
  );
}

async function getModel(Model, id, extraQuery = {}) {
  assertObjectId(id);
  const row = await Model.findOne({ _id: id, ...extraQuery }).lean();
  if (!row) throw new MenuNotFoundError();
  return serializeDoc(row);
}

function serializeAdminProductSummary(product) {
  const payload = serializeDoc(product);
  payload.isCustomizable = inferProductCustomizable(product);
  return payload;
}

function serializeCategoryDetailV3(category, products) {
  const categoryPayload = serializeDoc(category);
  const categoryProducts = (products || []).filter((product) => (
    String(product.categoryId) === String(category._id)
  ));
  return {
    contractVersion: "dashboard_category_detail.v3",
    category: categoryPayload,
    products: categoryProducts.map(serializeAdminProductSummary),
    assignment: {
      relationOwner: "product.categoryId",
      bulkAssignmentEndpoint: `/api/dashboard/menu/categories/${categoryPayload.id}/products`,
    },
    actions: {
      canBulkAssignProducts: true,
      canReorderProducts: true,
    },
  };
}

function assertDashboardContractVersion(options = {}) {
  const requested = String(options.contractVersion || "").trim().toLowerCase();
  if (!requested || requested === "v3" || requested === "v4") return;
  throw new MenuValidationError(
    "Dashboard menu contract versions v1 and v2 are no longer supported. Use dashboard v3 or v4.",
    "DASHBOARD_CONTRACT_VERSION_UNSUPPORTED",
    410,
    { supportedContractVersions: ["v3", "v4"] }
  );
}

async function getCategoryDetail(id, options = {}) {
  assertDashboardContractVersion(options);
  assertObjectId(id);
  const category = await MenuCategory.findById(id).lean();
  if (!category) throw new MenuNotFoundError();

  const productQuery = {
    categoryId: id,
    ...buildListQuery(options),
  };
  const products = await MenuProduct.find(productQuery)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  return serializeCategoryDetailV3(category, products);
}

async function getProductDetail(id) {
  assertObjectId(id);
  const product = await MenuProduct.findById(id).lean();
  if (!product) throw new MenuNotFoundError("Product not found");

  const [category, activeGroupCount] = await Promise.all([
    product.categoryId ? MenuCategory.findById(product.categoryId).lean() : null,
    ProductOptionGroup.countDocuments({ productId: id, isActive: true }),
  ]);

  const payload = serializeDoc(product);
  payload.isCustomizable = inferProductCustomizable(product, activeGroupCount > 0 ? [{}] : []);

  return {
    contractVersion: "dashboard_product_detail.v3",
    product: payload,
    category: category ? serializeDoc(category) : null,
    groupSummary: {
      linkedGroupCount: activeGroupCount,
      composerEndpoint: `/api/dashboard/menu/products/${id}/composer`,
      linkEndpoint: `/api/dashboard/menu/products/${id}/option-groups`,
    },
  };
}

async function getOptionGroupDetail(id, options = {}) {
  assertDashboardContractVersion(options);
  assertObjectId(id);
  const group = await MenuOptionGroup.findById(id).lean();
  if (!group) throw new MenuNotFoundError();
  const [optionsRows, linkedProductIds] = await Promise.all([
    MenuOption.find({
      groupId: id,
      ...buildListQuery(options),
    }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductOptionGroup.distinct("productId", { groupId: id, isActive: true }),
  ]);

  return {
    contractVersion: "dashboard_option_group_detail.v3",
    optionGroup: serializeDoc(group),
    options: optionsRows.map(serializeDashboardOption),
    usage: {
      linkedProductsCount: linkedProductIds.length,
    },
    actions: {
      canAddOptions: true,
      canReorderOptions: true,
    },
  };
}

async function getOptionDetail(id, options = {}) {
  assertDashboardContractVersion(options);
  assertObjectId(id);
  const option = await MenuOption.findById(id).lean();
  if (!option) throw new MenuNotFoundError();
  const [group, linkedProductIds] = await Promise.all([
    option.groupId ? MenuOptionGroup.findById(option.groupId).lean() : null,
    ProductGroupOption.distinct("productId", { optionId: id, isActive: true }),
  ]);

  return {
    contractVersion: "dashboard_option_detail.v3",
    option: serializeDashboardOption(option),
    optionGroup: group ? serializeDoc(group) : null,
    usage: {
      linkedProductsCount: linkedProductIds.length,
    },
  };
}

function normalizeCategoryPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  assertImmutableKey(body, existing, "key");
  const hasUi = body.ui !== undefined;
  if (
    hasUi
    && (
      !isPlainObject(body.ui)
      || (body.ui.cardVariant !== undefined && !isAllowedCategoryCardVariant(body.ui.cardVariant))
    )
  ) {
    throw new MenuValidationError("ui.cardVariant must be one of the supported public category card variants", "INVALID_CARD_VARIANT");
  }
  return {
    key: body.key === undefined && existing ? existing.key : normalizeOptionalKey(body.key),
    name: body.name === undefined && existing ? existing.name : localizedString(body.name, "name", { required: true }),
    description: optionalLocalizedString(body.description, "description") || (existing ? existing.description : { ar: "", en: "" }),
    imageUrl: body.imageUrl === undefined && existing ? existing.imageUrl : String(body.imageUrl || "").trim(),
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    isVisible: normalizeBoolean(body.isVisible, "isVisible", existing ? truthyByDefault(existing.isVisible) : true),
    isAvailable: normalizeBoolean(body.isAvailable, "isAvailable", existing ? truthyByDefault(existing.isAvailable) : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
    ui: hasUi ? normalizeCategoryUiMetadata(body.ui) : normalizeCategoryUiMetadata(existing && existing.ui),
    availability: {
      branchIds: (body.branchIds === undefined && (!body.availability || body.availability.branchIds === undefined) && existing)
        ? ((existing.availability && existing.availability.branchIds) || [])
        : normalizeStringArray(
          body.branchIds !== undefined ? body.branchIds : body.availability && body.availability.branchIds,
          "branchIds"
        ),
    },
  };
}

function normalizeProductPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  assertImmutableKey(body, existing, "key");
  assertImmutableCatalogItemLink(body, existing);
  const hasUi = body.ui !== undefined;
  if (
    hasUi
    && (
      !isPlainObject(body.ui)
      || (body.ui.cardVariant !== undefined && !isAllowedCardVariant(body.ui.cardVariant))
    )
  ) {
    throw new MenuValidationError("ui.cardVariant must be one of the supported public product card variants", "INVALID_CARD_VARIANT");
  }
  const pricingModel = String(body.pricingModel || (existing && existing.pricingModel) || "fixed").trim();
  if (!["fixed", "per_100g"].includes(pricingModel)) {
    throw new MenuValidationError("pricingModel must be fixed or per_100g");
  }
  const itemType = String(body.itemType || (existing && existing.itemType) || "product").trim();
  if (!PRODUCT_ITEM_TYPES.includes(itemType)) {
    throw new MenuValidationError(`itemType must be one of: ${PRODUCT_ITEM_TYPES.join(", ")}`);
  }
  return {
    categoryId: body.categoryId === undefined && existing ? existing.categoryId : assertObjectId(body.categoryId, "categoryId"),
    catalogItemId: normalizeOptionalObjectId(body.catalogItemId, "catalogItemId", existing ? (existing.catalogItemId || null) : null),
    key: body.key === undefined && existing ? existing.key : normalizeOptionalKey(body.key),
    name: body.name === undefined && existing ? existing.name : localizedString(body.name, "name", { required: true }),
    description: optionalLocalizedString(body.description, "description") || (existing ? existing.description : { ar: "", en: "" }),
    imageUrl: body.imageUrl === undefined && existing ? existing.imageUrl : String(body.imageUrl || "").trim(),
    itemType,
    pricingModel,
    priceHalala: normalizeNonNegativeInteger(body.priceHalala, "priceHalala", existing ? existing.priceHalala : 0),
    baseUnitGrams: normalizeNonNegativeInteger(body.baseUnitGrams, "baseUnitGrams", existing ? existing.baseUnitGrams : 100) || 100,
    defaultWeightGrams: normalizeNonNegativeInteger(body.defaultWeightGrams, "defaultWeightGrams", existing ? existing.defaultWeightGrams : 0),
    minWeightGrams: normalizeNonNegativeInteger(body.minWeightGrams, "minWeightGrams", existing ? existing.minWeightGrams : 0),
    maxWeightGrams: normalizeNonNegativeInteger(body.maxWeightGrams, "maxWeightGrams", existing ? existing.maxWeightGrams : 0),
    weightStepGrams: normalizeNonNegativeInteger(body.weightStepGrams, "weightStepGrams", existing ? existing.weightStepGrams : 50) || 50,
    currency: SYSTEM_CURRENCY,
    availableFor: normalizeAvailableFor(body.availableFor, "availableFor", existing ? (existing.availableFor || []) : ["one_time", "subscription"]),
    isCustomizable: normalizeBoolean(
      body.isCustomizable,
      "isCustomizable",
      existing
        ? inferProductCustomizable(existing)
        : (pricingModel === "per_100g" || PRODUCT_ITEM_TYPES_CUSTOMIZABLE_BY_DEFAULT.has(itemType))
    ),
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    isVisible: normalizeBoolean(body.isVisible, "isVisible", existing ? truthyByDefault(existing.isVisible) : true),
    isAvailable: normalizeBoolean(body.isAvailable, "isAvailable", existing ? truthyByDefault(existing.isAvailable) : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
    ui: hasUi ? normalizeProductUiMetadata(body.ui) : normalizeProductUiMetadata(existing && existing.ui),
    branchAvailability: (body.branchAvailability === undefined && body.branchIds === undefined && existing)
      ? (existing.branchAvailability || [])
      : normalizeStringArray(body.branchAvailability !== undefined ? body.branchAvailability : body.branchIds, "branchAvailability"),
  };
}

function normalizeGroupPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  assertImmutableKey(body, existing, "key");
  const hasUi = body.ui !== undefined;
  if (
    hasUi
    && (
      !isPlainObject(body.ui)
      || (body.ui.displayStyle !== undefined && !isAllowedGroupDisplayStyle(body.ui.displayStyle))
    )
  ) {
    throw new MenuValidationError("ui.displayStyle must be one of: chips, radio_cards, checkbox_grid, dropdown, stepper", "INVALID_DISPLAY_STYLE");
  }
  return {
    key: body.key === undefined && existing ? existing.key : normalizeOptionalKey(body.key),
    name: body.name === undefined && existing ? existing.name : localizedString(body.name, "name", { required: true }),
    description: optionalLocalizedString(body.description, "description") || (existing ? existing.description : { ar: "", en: "" }),
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    isVisible: normalizeBoolean(body.isVisible, "isVisible", existing ? truthyByDefault(existing.isVisible) : true),
    isAvailable: normalizeBoolean(body.isAvailable, "isAvailable", existing ? truthyByDefault(existing.isAvailable) : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
    ui: hasUi ? normalizeGroupUiMetadata(body.ui) : normalizeGroupUiMetadata(existing && existing.ui),
  };
}

function normalizeOptionPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  assertImmutableKey(body, existing, "key");
  assertImmutableCatalogItemLink(body, existing);

  let extraPriceHalala = normalizeNonNegativeInteger(body.extraPriceHalala, "extraPriceHalala", existing ? existing.extraPriceHalala : 0);
  let extraFeeHalala = normalizeNonNegativeInteger(body.extraFeeHalala, "extraFeeHalala", existing ? (existing.extraFeeHalala || 0) : 0);

  if (body.extraPriceHalala !== undefined && body.extraFeeHalala === undefined) {
    extraFeeHalala = extraPriceHalala;
  } else if (body.extraFeeHalala !== undefined && body.extraPriceHalala === undefined) {
    extraPriceHalala = extraFeeHalala;
  }

  return {
    groupId: body.groupId === undefined && existing ? existing.groupId : assertObjectId(body.groupId, "groupId"),
    catalogItemId: normalizeOptionalObjectId(body.catalogItemId, "catalogItemId", existing ? (existing.catalogItemId || null) : null),
    key: body.key === undefined && existing ? existing.key : normalizeOptionalKey(body.key),
    name: body.name === undefined && existing ? existing.name : localizedString(body.name, "name", { required: true }),
    description: optionalLocalizedString(body.description, "description") || (existing ? existing.description : { ar: "", en: "" }),
    imageUrl: body.imageUrl === undefined && existing ? existing.imageUrl : String(body.imageUrl || "").trim(),
    extraPriceHalala,
    extraWeightUnitGrams: normalizeNonNegativeInteger(body.extraWeightUnitGrams, "extraWeightUnitGrams", existing ? existing.extraWeightUnitGrams : 0),
    extraWeightPriceHalala: normalizeNonNegativeInteger(body.extraWeightPriceHalala, "extraWeightPriceHalala", existing ? existing.extraWeightPriceHalala : 0),
    currency: SYSTEM_CURRENCY,
    availableFor: normalizeAvailableFor(body.availableFor, "availableFor", existing ? (existing.availableFor || []) : ["one_time", "subscription"]),
    availableForSubscription: normalizeBoolean(body.availableForSubscription, "availableForSubscription", existing ? truthyByDefault(existing.availableForSubscription) : true),
    extraFeeHalala,
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    isVisible: normalizeBoolean(body.isVisible, "isVisible", existing ? truthyByDefault(existing.isVisible) : true),
    isAvailable: normalizeBoolean(body.isAvailable, "isAvailable", existing ? truthyByDefault(existing.isAvailable) : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
  };
}

function normalizeSelectionRulePayload(body = {}, existing = null, prefix = "") {
  const min = normalizeNonNegativeInteger(body.minSelections, `${prefix}minSelections`, existing ? existing.minSelections : 0);
  const max = normalizeNullableNonNegativeInteger(body.maxSelections, `${prefix}maxSelections`, existing ? existing.maxSelections : null);
  if (max !== null && max < min) {
    throw new MenuValidationError(`${prefix}maxSelections must be null or >= minSelections`, "INVALID_SELECTION_RULES");
  }
  const requiredFallback = existing ? Boolean(existing.isRequired) : min > 0;
  const isRequired = normalizeBoolean(body.isRequired, `${prefix}isRequired`, requiredFallback);
  if (isRequired && min <= 0) {
    throw new MenuValidationError(`${prefix}minSelections must be > 0 when isRequired=true`, "INVALID_SELECTION_RULES");
  }
  return { minSelections: min, maxSelections: max, isRequired };
}

function normalizeProductGroupRelationPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  return {
    productId: body.productId === undefined && existing ? existing.productId : assertObjectId(body.productId, "productId"),
    groupId: body.groupId === undefined && existing ? existing.groupId : assertObjectId(body.groupId || body.id, "groupId"),
    ...normalizeSelectionRulePayload(body, existing),
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    isVisible: normalizeBoolean(body.isVisible, "isVisible", existing ? truthyByDefault(existing.isVisible) : true),
    isAvailable: normalizeBoolean(body.isAvailable, "isAvailable", existing ? truthyByDefault(existing.isAvailable) : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
  };
}

function normalizeProductGroupOptionRelationPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  return {
    productId: body.productId === undefined && existing ? existing.productId : assertObjectId(body.productId, "productId"),
    groupId: body.groupId === undefined && existing ? existing.groupId : assertObjectId(body.groupId, "groupId"),
    optionId: body.optionId === undefined && existing ? existing.optionId : assertObjectId(body.optionId || body.id, "optionId"),
    extraPriceHalala: normalizeNullableNonNegativeInteger(body.extraPriceHalala, "extraPriceHalala", existing ? existing.extraPriceHalala : null),
    extraWeightUnitGrams: normalizeNullableNonNegativeInteger(body.extraWeightUnitGrams, "extraWeightUnitGrams", existing ? existing.extraWeightUnitGrams : null),
    extraWeightPriceHalala: normalizeNullableNonNegativeInteger(body.extraWeightPriceHalala, "extraWeightPriceHalala", existing ? existing.extraWeightPriceHalala : null),
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    isVisible: normalizeBoolean(body.isVisible, "isVisible", existing ? truthyByDefault(existing.isVisible) : true),
    isAvailable: normalizeBoolean(body.isAvailable, "isAvailable", existing ? truthyByDefault(existing.isAvailable) : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
  };
}

function changeAction(payload, fallback = "update") {
  if (Object.prototype.hasOwnProperty.call(payload, "isVisible")) return "visibility_changed";
  if (Object.prototype.hasOwnProperty.call(payload, "isAvailable")) return "availability_changed";
  if (
    Object.prototype.hasOwnProperty.call(payload, "priceHalala")
    || Object.prototype.hasOwnProperty.call(payload, "extraPriceHalala")
    || Object.prototype.hasOwnProperty.call(payload, "extraWeightUnitGrams")
    || Object.prototype.hasOwnProperty.call(payload, "extraWeightPriceHalala")
  ) return "price_changed";
  return fallback;
}

async function createEntity(Model, payload, { entityType, actor }) {
  const row = await Model.create(payload);
  await writeMenuAudit({ entityType, entityId: row._id, action: "create", after: row.toObject(), actor });
  return serializeDoc(row);
}

async function updateEntity(Model, id, payload, { entityType, actor, action = "update", meta = {} }) {
  assertObjectId(id);
  const row = await Model.findById(id);
  if (!row) throw new MenuNotFoundError();
  const before = row.toObject();
  row.set(payload);
  await row.save();
  await writeMenuAudit({ entityType, entityId: row._id, action, before, after: row.toObject(), actor, meta });
  return serializeDoc(row);
}

async function softDeleteEntity(Model, id, { entityType, actor }) {
  assertObjectId(id);
  const row = await Model.findById(id);
  if (!row) throw new MenuNotFoundError();

  if (Model === MenuCategory) {
    const productCount = await MenuProduct.countDocuments({ categoryId: id, isActive: true });
    if (productCount > 0) {
      throw new MenuValidationError(`Cannot delete category with ${productCount} active products`, "CATEGORY_IN_USE", 400, { productCount });
    }
  }

  if (Model === MenuOptionGroup) {
    const relationCount = await ProductOptionGroup.countDocuments({ groupId: id, isActive: true });
    if (relationCount > 0) {
      throw new MenuValidationError(`Cannot delete option group currently linked to ${relationCount} products`, "GROUP_IN_USE", 400, { relationCount });
    }
  }

  const before = row.toObject();
  row.isActive = false;
  await row.save();
  await writeMenuAudit({ entityType, entityId: row._id, action: "soft_delete", before, after: row.toObject(), actor });

  if (Model === MenuProduct) {
    await Promise.all([
      ProductOptionGroup.updateMany({ productId: id }, { $set: { isActive: false } }),
      ProductGroupOption.updateMany({ productId: id }, { $set: { isActive: false } }),
    ]);
  }

  if (Model === MenuOption) {
    await ProductGroupOption.updateMany({ optionId: id }, { $set: { isActive: false } });
  }

  return serializeDoc(row);
}

async function reorder(Model, items = [], { entityType, actor }) {
  if (!Array.isArray(items)) throw new MenuValidationError("items must be an array");
  const ids = items.map((item) => assertObjectId(item.id || item._id, "items[].id"));
  await Promise.all(items.map((item) => Model.updateOne(
    { _id: item.id || item._id },
    { $set: { sortOrder: normalizeNonNegativeInteger(item.sortOrder, "items[].sortOrder", 0) } }
  )));
  await MenuAuditLog.create({
    entityType,
    entityId: ids[0],
    action: "reorder",
    actorId: actor.userId && mongoose.Types.ObjectId.isValid(actor.userId) ? actor.userId : null,
    actorRole: actor.role || "",
    meta: { ids },
  });
  return { updated: ids.length };
}

async function duplicateProduct(productId, actor = {}) {
  assertObjectId(productId);
  const product = await MenuProduct.findById(productId).lean();
  if (!product) throw new MenuNotFoundError("Product not found");

  const [groupRelations, optionRelations] = await Promise.all([
    ProductOptionGroup.find({ productId }).lean(),
    ProductGroupOption.find({ productId }).lean(),
  ]);

  const newKey = await generateUniqueKey({
    name: `${product.key || localizeName(product.name, "en") || "item"}_copy`,
    fallbackPrefix: "item",
    exists: (key) => MenuProduct.exists({ key }),
  });

  try {
    const newProductDoc = await MenuProduct.create({
      ...product,
      _id: new mongoose.Types.ObjectId(),
      key: newKey,
      isActive: false,
      publishedAt: null,
      createdAt: undefined,
      updatedAt: undefined,
    });

    const newProductId = newProductDoc._id;

    const newGroupRelations = groupRelations.map((r) => ({
      ...r,
      _id: new mongoose.Types.ObjectId(),
      productId: newProductId,
    }));

    const newOptionRelations = optionRelations.map((r) => ({
      ...r,
      _id: new mongoose.Types.ObjectId(),
      productId: newProductId,
    }));

    await Promise.all([
      ProductOptionGroup.insertMany(newGroupRelations),
      ProductGroupOption.insertMany(newOptionRelations),
    ]);

    await writeMenuAudit({ 
      entityType: "menu_product", 
      entityId: newProductId, 
      action: "duplicate", 
      actor, 
      meta: { originalProductId: productId } 
    });

    return serializeDoc(newProductDoc);
  } catch (err) {
    if (err.code === 11000) {
      // Return 409 Conflict as requested
      throw new MenuValidationError("Conflict: A product with this key already exists", "DUPLICATE_KEY", 409);
    }
    throw err;
  }
}

function normalizeBulkProductIds(productIds, fieldName = "productIds") {
  if (!Array.isArray(productIds)) throw new MenuValidationError(`${fieldName} must be an array`);
  const ids = [...new Set(productIds.map((item) => assertObjectId(item, `${fieldName}[]`)))];
  if (ids.length === 0) throw new MenuValidationError(`${fieldName} must include at least one product`);
  return ids;
}

async function bulkAssignProductsToCategory(categoryId, body = {}, actor = {}) {
  assertObjectId(categoryId, "categoryId");
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  if (String(body.mode || "assign") !== "assign") {
    throw new MenuValidationError("mode must be assign", "UNSUPPORTED_BULK_ASSIGNMENT_MODE");
  }

  const productIds = normalizeBulkProductIds(body.productIds);
  const category = await MenuCategory.findOne({ _id: categoryId, isActive: true }).lean();
  if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);

  const foundProducts = await MenuProduct.find({ _id: { $in: productIds }, isActive: true }).lean();
  if (foundProducts.length !== productIds.length) {
    throw new MenuValidationError("One or more products do not exist or are inactive", "PRODUCT_NOT_FOUND", 404);
  }

  await MenuProduct.updateMany(
    { _id: { $in: productIds } },
    { $set: { categoryId } }
  );

  await writeMenuAudit({
    entityType: "menu_category",
    entityId: categoryId,
    action: "products_bulk_assigned",
    actor,
    meta: { productIds },
  });

  const assignedProducts = await MenuProduct.find({ _id: { $in: productIds } })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  return {
    contractVersion: "dashboard_category_product_assignment.v3",
    category: serializeDoc(category),
    assignedCount: assignedProducts.length,
    products: assignedProducts.map(serializeAdminProductSummary),
    relationOwner: "product.categoryId",
  };
}

async function bulkUpdateProducts(body = {}, actor = {}) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  const productIds = normalizeBulkProductIds(body.productIds);
  const action = String(body.action || "").trim();
  if (action !== "move_to_category") {
    throw new MenuValidationError("action must be move_to_category", "UNSUPPORTED_PRODUCT_BULK_ACTION");
  }

  const categoryId = assertObjectId(body.categoryId, "categoryId");
  const [category, foundProducts] = await Promise.all([
    MenuCategory.findOne({ _id: categoryId, isActive: true }).lean(),
    MenuProduct.find({ _id: { $in: productIds }, isActive: true }).lean(),
  ]);
  if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
  if (foundProducts.length !== productIds.length) {
    throw new MenuValidationError("One or more products do not exist or are inactive", "PRODUCT_NOT_FOUND", 404);
  }

  await MenuProduct.updateMany(
    { _id: { $in: productIds } },
    { $set: { categoryId } }
  );

  await writeMenuAudit({
    entityType: "menu_product",
    entityId: categoryId,
    action: "bulk_move_to_category",
    actor,
    meta: { productIds, categoryId },
  });

  const products = await MenuProduct.find({ _id: { $in: productIds } })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  return {
    action,
    category: serializeDoc(category),
    count: products.length,
    products: products.map(serializeAdminProductSummary),
    relationOwner: "product.categoryId",
  };
}

async function listProductGroups(productId, options = {}) {
  assertObjectId(productId, "productId");
  const query = { productId, ...buildListQuery(options) };
  const pagination = parsePaginationOptions(options);
  const find = ProductOptionGroup.find(query)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  if (!pagination) {
    const rows = await find;
    return rows.map(serializeDoc);
  }

  const [rows, total] = await Promise.all([
    find.skip(pagination.skip).limit(pagination.limit),
    ProductOptionGroup.countDocuments(query),
  ]);

  return {
    items: rows.map(serializeDoc),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  };
}

function buildDashboardProductComposerValidation({ product, category, linkedOptionGroups }) {
  const errors = [];
  const warnings = [];
  const pushIssue = (target, code, message, extra = {}) => {
    target.push({ code, message, ...extra });
  };

  if (!category) {
    pushIssue(errors, "missing_category", "Product category is missing");
  } else {
    if (category.isActive === false) pushIssue(warnings, "inactive_category", "Product category is inactive");
    if (category.isVisible === false) pushIssue(warnings, "hidden_category", "Product category is hidden");
    if (category.isAvailable === false) pushIssue(warnings, "unavailable_category", "Product category is unavailable");
  }

  if (product.isActive === false) pushIssue(warnings, "inactive_product", "Product is inactive");
  if (product.isVisible === false) pushIssue(warnings, "hidden_product", "Product is hidden");
  if (product.isAvailable === false) pushIssue(warnings, "unavailable_product", "Product is unavailable");
  if (!product.publishedAt) pushIssue(warnings, "unpublished_product", "Product has unpublished changes or has not been published");
  const explicitlyCustomizable = Boolean(product.isCustomizable);
  if (explicitlyCustomizable && linkedOptionGroups.length === 0) {
    pushIssue(warnings, "customizable_without_groups", "Product is marked customizable but has no linked option groups");
  }
  if (!explicitlyCustomizable && linkedOptionGroups.length > 0) {
    pushIssue(warnings, "non_customizable_with_groups", "Product is not customizable but still has linked option groups");
  }

  for (const linkedGroup of linkedOptionGroups) {
    const groupKey = linkedGroup.group?.key || linkedGroup.groupId;
    if (!linkedGroup.group) {
      pushIssue(errors, "missing_linked_group", `Linked option group is missing: ${linkedGroup.groupId}`, {
        groupId: linkedGroup.groupId,
      });
      continue;
    }
    if (linkedGroup.group.isActive === false) pushIssue(warnings, "inactive_linked_group", `Linked option group is inactive: ${groupKey}`, { groupId: linkedGroup.groupId });
    if (linkedGroup.group.isVisible === false) pushIssue(warnings, "hidden_linked_group", `Linked option group is hidden: ${groupKey}`, { groupId: linkedGroup.groupId });
    if (linkedGroup.group.isAvailable === false) pushIssue(warnings, "unavailable_linked_group", `Linked option group is unavailable: ${groupKey}`, { groupId: linkedGroup.groupId });
    if (linkedGroup.group.isActive === false || linkedGroup.group.isVisible === false || linkedGroup.group.isAvailable === false) {
      pushIssue(warnings, "global_group_disabled", "Global option group is disabled and cannot be shown for this product", {
        severity: "warning",
        action: "detach_or_reactivate_global_group",
        groupId: linkedGroup.groupId,
      });
    }
    const activeLinkedOptionsCount = linkedGroup.options.filter((row) => (
      row.isActive !== false
      && row.isVisible !== false
      && row.isAvailable !== false
      && row.option
      && row.option.isActive !== false
      && row.option.isVisible !== false
      && row.option.isAvailable !== false
    )).length;
    if (linkedGroup.isRequired && activeLinkedOptionsCount < linkedGroup.minSelections) {
      pushIssue(errors, "required_group_insufficient_options", `Required option group ${groupKey} has fewer active linked options than minSelections`, {
        severity: "error",
        action: "open_option_pool",
        groupId: linkedGroup.groupId,
        requiredMinSelections: linkedGroup.minSelections,
        activeLinkedOptionsCount,
      });
    }

    for (const linkedOption of linkedGroup.options) {
      const optionKey = linkedOption.option?.key || linkedOption.optionId;
      if (!linkedOption.option) {
        pushIssue(errors, "missing_linked_option", `Linked option is missing: ${linkedOption.optionId}`, {
          groupId: linkedGroup.groupId,
          optionId: linkedOption.optionId,
        });
        continue;
      }
      if (linkedOption.option.isActive === false) pushIssue(warnings, "inactive_linked_option", `Linked option is inactive: ${optionKey}`, { groupId: linkedGroup.groupId, optionId: linkedOption.optionId });
      if (linkedOption.option.isVisible === false) pushIssue(warnings, "hidden_linked_option", `Linked option is hidden: ${optionKey}`, { groupId: linkedGroup.groupId, optionId: linkedOption.optionId });
      if (linkedOption.option.isAvailable === false) pushIssue(warnings, "unavailable_linked_option", `Linked option is unavailable: ${optionKey}`, { groupId: linkedGroup.groupId, optionId: linkedOption.optionId });
      if (linkedOption.option.isActive === false || linkedOption.option.isVisible === false || linkedOption.option.isAvailable === false) {
        pushIssue(warnings, "global_option_disabled", "Global option is disabled and cannot be shown for this product", {
          severity: "warning",
          action: "remove_or_replace_option",
          groupId: linkedGroup.groupId,
          optionId: linkedOption.optionId,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function serializeDashboardLinkedOption(relation, option) {
  const optionPayload = option ? serializeDoc(option) : null;
  const fallbackExtraPriceHalala = optionPayload ? optionPayload.extraPriceHalala : null;
  const fallbackExtraWeightUnitGrams = optionPayload ? optionPayload.extraWeightUnitGrams : null;
  const fallbackExtraWeightPriceHalala = optionPayload ? optionPayload.extraWeightPriceHalala : null;
  const override = {
    extraPriceHalala: relation.extraPriceHalala,
    extraWeightUnitGrams: relation.extraWeightUnitGrams,
    extraWeightPriceHalala: relation.extraWeightPriceHalala,
    effectiveExtraPriceHalala: relation.extraPriceHalala !== null && relation.extraPriceHalala !== undefined
      ? relation.extraPriceHalala
      : fallbackExtraPriceHalala,
    effectiveExtraWeightUnitGrams: relation.extraWeightUnitGrams !== null && relation.extraWeightUnitGrams !== undefined
      ? relation.extraWeightUnitGrams
      : fallbackExtraWeightUnitGrams,
    effectiveExtraWeightPriceHalala: relation.extraWeightPriceHalala !== null && relation.extraWeightPriceHalala !== undefined
      ? relation.extraWeightPriceHalala
      : fallbackExtraWeightPriceHalala,
  };

  return {
    id: String(relation._id),
    productId: String(relation.productId),
    groupId: String(relation.groupId),
    optionId: String(relation.optionId),
    extraPriceHalala: relation.extraPriceHalala,
    extraWeightUnitGrams: relation.extraWeightUnitGrams,
    extraWeightPriceHalala: relation.extraWeightPriceHalala,
    isActive: truthyByDefault(relation.isActive),
    isVisible: truthyByDefault(relation.isVisible),
    isAvailable: truthyByDefault(relation.isAvailable),
    sortOrder: Number(relation.sortOrder || 0),
    relation: serializeDoc(relation),
    override,
    option: optionPayload,
  };
}

function serializeDashboardLinkedGroup(relation, group, options) {
  const payload = {
    id: String(relation._id),
    productId: String(relation.productId),
    groupId: String(relation.groupId),
    minSelections: Number(relation.minSelections || 0),
    maxSelections: relation.maxSelections === null || relation.maxSelections === undefined ? null : Number(relation.maxSelections),
    isRequired: Boolean(relation.isRequired),
    isActive: truthyByDefault(relation.isActive),
    isVisible: truthyByDefault(relation.isVisible),
    isAvailable: truthyByDefault(relation.isAvailable),
    sortOrder: Number(relation.sortOrder || 0),
    relation: serializeDoc(relation),
    group: group ? serializeDoc(group) : null,
    options,
  };

  return payload;
}

function serializePricingFields(source = {}) {
  return {
    extraPriceHalala: source.extraPriceHalala === undefined ? null : source.extraPriceHalala,
    extraWeightUnitGrams: source.extraWeightUnitGrams === undefined ? null : source.extraWeightUnitGrams,
    extraWeightPriceHalala: source.extraWeightPriceHalala === undefined ? null : source.extraWeightPriceHalala,
    currency: source.currency || SYSTEM_CURRENCY,
  };
}

function serializeProductComposerLinkedOptionV3(linkedOption) {
  const option = linkedOption.option || {};
  return {
    relationId: linkedOption.id,
    optionId: linkedOption.optionId,
    key: option.key || "",
    name: option.name || { ar: "", en: "" },
    defaultPricing: serializePricingFields(option),
    overridePricing: serializePricingFields({
      extraPriceHalala: linkedOption.extraPriceHalala,
      extraWeightUnitGrams: linkedOption.extraWeightUnitGrams,
      extraWeightPriceHalala: linkedOption.extraWeightPriceHalala,
      currency: option.currency,
    }),
    effectivePricing: serializePricingFields({
      extraPriceHalala: linkedOption.override.effectiveExtraPriceHalala,
      extraWeightUnitGrams: linkedOption.override.effectiveExtraWeightUnitGrams,
      extraWeightPriceHalala: linkedOption.override.effectiveExtraWeightPriceHalala,
      currency: option.currency,
    }),
    nutrition: option.nutrition || {},
    status: {
      isActive: linkedOption.isActive && option.isActive !== false,
      isVisible: linkedOption.isVisible && option.isVisible !== false,
      isAvailable: linkedOption.isAvailable && option.isAvailable !== false,
    },
    sortOrder: linkedOption.sortOrder,
  };
}

function serializeProductComposerLinkedGroupV3(linkedGroup) {
  const group = linkedGroup.group || {};
  const options = linkedGroup.options.map(serializeProductComposerLinkedOptionV3);
  return {
    relationId: linkedGroup.id,
    groupId: linkedGroup.groupId,
    key: group.key || "",
    name: group.name || { ar: "", en: "" },
    rules: {
      minSelections: linkedGroup.minSelections,
      maxSelections: linkedGroup.maxSelections,
      isRequired: linkedGroup.isRequired,
    },
    status: {
      isActive: linkedGroup.isActive && group.isActive !== false,
      isVisible: linkedGroup.isVisible && group.isVisible !== false,
      isAvailable: linkedGroup.isAvailable && group.isAvailable !== false,
    },
    sortOrder: linkedGroup.sortOrder,
    ui: normalizeGroupUiMetadata(group.ui),
    optionsCount: options.length,
    options,
  };
}

function serializeProductComposerV3({ productPayload, category, linkedOptionGroups, validation }) {
  const product = { ...productPayload };
  delete product.groups;
  delete product.optionGroups;

  return {
    contractVersion: "dashboard_product_composer.v3",
    product,
    category: category ? serializeDoc(category) : null,
    customization: {
      isCustomizable: product.isCustomizable,
      linkedGroups: linkedOptionGroups.map(serializeProductComposerLinkedGroupV3),
    },
    availableActions: {
      canAttachGroups: true,
      canDetachGroups: true,
      canEditRules: true,
      canEditOptionOverrides: true,
    },
    validation,
  };
}

function statusTriple(globalDoc = {}, relationDoc = {}) {
  const global = {
    isActive: truthyByDefault(globalDoc && globalDoc.isActive),
    isVisible: truthyByDefault(globalDoc && globalDoc.isVisible),
    isAvailable: truthyByDefault(globalDoc && globalDoc.isAvailable),
  };
  const product = {
    isActive: truthyByDefault(relationDoc && relationDoc.isActive),
    isVisible: truthyByDefault(relationDoc && relationDoc.isVisible),
    isAvailable: truthyByDefault(relationDoc && relationDoc.isAvailable),
  };
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

function serializeDefaultPricing(source = {}) {
  return {
    extraPriceHalala: Number(source.extraPriceHalala || 0),
    extraWeightUnitGrams: Number(source.extraWeightUnitGrams || 0),
    extraWeightPriceHalala: Number(source.extraWeightPriceHalala || 0),
    currency: source.currency || SYSTEM_CURRENCY,
  };
}

function serializeOverridePricing(source = {}, currency = SYSTEM_CURRENCY) {
  return {
    extraPriceHalala: source.extraPriceHalala === undefined ? null : source.extraPriceHalala,
    extraWeightUnitGrams: source.extraWeightUnitGrams === undefined ? null : source.extraWeightUnitGrams,
    extraWeightPriceHalala: source.extraWeightPriceHalala === undefined ? null : source.extraWeightPriceHalala,
    currency,
  };
}

function serializeEffectivePricing(relation = {}, option = {}) {
  return {
    extraPriceHalala: relation.extraPriceHalala === null || relation.extraPriceHalala === undefined
      ? Number(option.extraPriceHalala || 0)
      : Number(relation.extraPriceHalala || 0),
    extraWeightUnitGrams: relation.extraWeightUnitGrams === null || relation.extraWeightUnitGrams === undefined
      ? Number(option.extraWeightUnitGrams || 0)
      : Number(relation.extraWeightUnitGrams || 0),
    extraWeightPriceHalala: relation.extraWeightPriceHalala === null || relation.extraWeightPriceHalala === undefined
      ? Number(option.extraWeightPriceHalala || 0)
      : Number(relation.extraWeightPriceHalala || 0),
    currency: option.currency || SYSTEM_CURRENCY,
  };
}

function serializeLibraryGroup(group = {}) {
  return {
    id: String(group._id),
    key: group.key || "",
    name: group.name || { ar: "", en: "" },
    description: group.description || { ar: "", en: "" },
    displayStyle: normalizeGroupUiMetadata(group.ui).displayStyle,
    enabled: truthyByDefault(group.isActive) && truthyByDefault(group.isVisible) && truthyByDefault(group.isAvailable),
    sortOrder: Number(group.sortOrder || 0),
  };
}

function serializeLibraryOption(option = {}, group = null) {
  return {
    id: String(option._id),
    key: option.key || "",
    name: option.name || { ar: "", en: "" },
    description: option.description || { ar: "", en: "" },
    imageUrl: option.imageUrl || "",
    suggestedGroupId: option.groupId ? String(option.groupId) : null,
    suggestedGroupKey: group ? group.key : null,
    defaultPricing: serializeDefaultPricing(option),
    nutrition: option.nutrition || {},
    enabled: truthyByDefault(option.isActive) && truthyByDefault(option.isVisible) && truthyByDefault(option.isAvailable),
    sortOrder: Number(option.sortOrder || 0),
  };
}

function serializeProductComposerLinkedOptionV4(linkedOption) {
  const option = linkedOption.option || {};
  return {
    productOptionId: linkedOption.id,
    optionId: linkedOption.optionId,
    key: option.key || "",
    name: option.name || { ar: "", en: "" },
    imageUrl: option.imageUrl || "",
    defaultPricing: serializeDefaultPricing(option),
    overridePricing: serializeOverridePricing({
      extraPriceHalala: linkedOption.extraPriceHalala,
      extraWeightUnitGrams: linkedOption.extraWeightUnitGrams,
      extraWeightPriceHalala: linkedOption.extraWeightPriceHalala,
    }, option.currency),
    effectivePricing: serializeEffectivePricing(linkedOption, option),
    nutrition: option.nutrition || {},
    status: statusTriple(option, linkedOption),
    sortOrder: linkedOption.sortOrder,
  };
}

function serializeProductComposerLinkedGroupV4(linkedGroup, optionPoolAvailableCount = 0) {
  const group = linkedGroup.group || {};
  const options = linkedGroup.options.map(serializeProductComposerLinkedOptionV4);
  return {
    productGroupId: linkedGroup.id,
    groupId: linkedGroup.groupId,
    key: group.key || "",
    name: group.name || { ar: "", en: "" },
    displayStyle: normalizeGroupUiMetadata(group.ui).displayStyle,
    rules: {
      minSelections: linkedGroup.minSelections,
      maxSelections: linkedGroup.maxSelections,
      isRequired: linkedGroup.isRequired,
    },
    status: statusTriple(group, linkedGroup),
    sortOrder: linkedGroup.sortOrder,
    options,
    optionPool: {
      linkedCount: options.length,
      availableCount: optionPoolAvailableCount,
      endpoint: `/api/dashboard/menu/products/${linkedGroup.productId}/option-groups/${linkedGroup.groupId}/option-pool`,
    },
  };
}

function serializeProductComposerV4({ productPayload, category, linkedOptionGroups, validation, optionPoolAvailableCount = 0 }) {
  const groups = linkedOptionGroups.map((group) => serializeProductComposerLinkedGroupV4(group, optionPoolAvailableCount));
  const linkedOptionCount = groups.reduce((sum, group) => sum + group.options.length, 0);
  return {
    contractVersion: "dashboard_product_composer.v4",
    product: {
      id: productPayload.id,
      key: productPayload.key,
      name: productPayload.name || { ar: "", en: "" },
      categoryId: productPayload.categoryId ? String(productPayload.categoryId) : null,
      isCustomizable: Boolean(productPayload.isCustomizable),
      isActive: truthyByDefault(productPayload.isActive),
      isVisible: truthyByDefault(productPayload.isVisible),
      isAvailable: truthyByDefault(productPayload.isAvailable),
    },
    category: category ? {
      id: String(category._id),
      key: category.key || "",
      name: category.name || { ar: "", en: "" },
    } : null,
    customization: {
      enabled: Boolean(productPayload.isCustomizable),
      summary: {
        linkedGroupCount: groups.length,
        linkedOptionCount,
        requiredGroupCount: groups.filter((group) => group.rules.isRequired).length,
      },
      groups,
    },
    availableActions: {
      canEnableCustomization: true,
      canDisableCustomization: true,
      canAttachGroup: true,
      canDetachGroup: true,
      canReplaceGroupOptions: true,
      canPatchOptionOverride: true,
    },
    validation,
  };
}

async function getProductComposer(productId, composerOptions = {}) {
  assertDashboardContractVersion(composerOptions);
  assertObjectId(productId, "productId");
  const product = await MenuProduct.findById(productId).lean();
  if (!product) throw new MenuNotFoundError("Product not found");

  const [category, groupRelations, optionRelations] = await Promise.all([
    product.categoryId ? MenuCategory.findById(product.categoryId).lean() : null,
    ProductOptionGroup.find({ productId }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductGroupOption.find({ productId }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);

  const groupIds = [...new Set(groupRelations.map((relation) => String(relation.groupId)))];
  const optionIds = [...new Set(optionRelations.map((relation) => String(relation.optionId)))];
  const [groups, options] = await Promise.all([
    groupIds.length ? MenuOptionGroup.find({ _id: { $in: groupIds } }).lean() : [],
    optionIds.length ? MenuOption.find({ _id: { $in: optionIds } }).lean() : [],
  ]);

  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const optionsById = new Map(options.map((option) => [String(option._id), option]));
  const optionRelationsByGroup = new Map();
  for (const relation of optionRelations) {
    const groupId = String(relation.groupId);
    if (!optionRelationsByGroup.has(groupId)) optionRelationsByGroup.set(groupId, []);
    optionRelationsByGroup.get(groupId).push(relation);
  }

  const linkedOptionGroups = groupRelations.map((relation) => {
    const groupId = String(relation.groupId);
    const linkedOptions = (optionRelationsByGroup.get(groupId) || [])
      .map((optionRelation) => serializeDashboardLinkedOption(
        optionRelation,
        optionsById.get(String(optionRelation.optionId)) || null
      ))
      .sort((left, right) => left.sortOrder - right.sortOrder);

    return serializeDashboardLinkedGroup(
      relation,
      groupsById.get(groupId) || null,
      linkedOptions
    );
  }).sort((left, right) => left.sortOrder - right.sortOrder);

  const requestedContractVersion = String(composerOptions.contractVersion || "").trim().toLowerCase();
  const productPayload = serializeDoc(product);
  productPayload.isCustomizable = requestedContractVersion === "v4"
    ? Boolean(product.isCustomizable)
    : inferProductCustomizable(product, linkedOptionGroups);

  const validation = buildDashboardProductComposerValidation({
    product,
    category,
    linkedOptionGroups,
  });

  if (requestedContractVersion === "v4") {
    const optionPoolAvailableCount = await MenuOption.countDocuments({
      isActive: true,
      isVisible: { $ne: false },
      isAvailable: { $ne: false },
    });
    return serializeProductComposerV4({
      productPayload,
      category,
      linkedOptionGroups,
      validation,
      optionPoolAvailableCount,
    });
  }

  return serializeProductComposerV3({
    productPayload,
    category,
    linkedOptionGroups,
    validation,
  });
}

async function getCustomizationLibrary(options = {}) {
  const [groups, optionRows] = await Promise.all([
    MenuOptionGroup.find({ ...buildListQuery({ ...options, includeInactive: true }) }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuOption.find({ ...buildListQuery({ ...options, includeInactive: true }) }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  return {
    contractVersion: "dashboard_customization_library.v1",
    groups: groups.map(serializeLibraryGroup),
    options: optionRows.map((option) => serializeLibraryOption(option, groupsById.get(String(option.groupId)) || null)),
  };
}

async function updateProductCustomization(productId, body = {}, actor = {}) {
  assertObjectId(productId, "productId");
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  const product = await MenuProduct.findById(productId);
  if (!product) throw new MenuNotFoundError("Product not found");
  const before = product.toObject();
  const isCustomizable = normalizeBoolean(body.isCustomizable, "isCustomizable", product.isCustomizable);
  product.isCustomizable = isCustomizable;
  await product.save();
  if (!isCustomizable && normalizeBoolean(body.clearRelations, "clearRelations", false)) {
    await Promise.all([
      ProductOptionGroup.deleteMany({ productId }),
      ProductGroupOption.deleteMany({ productId }),
    ]);
  }
  await writeMenuAudit({
    entityType: "menu_product",
    entityId: product._id,
    action: isCustomizable ? "product_customization_enabled" : "product_customization_disabled",
    before,
    after: product.toObject(),
    actor,
    meta: { productId, clearRelations: Boolean(body.clearRelations) },
  });
  return getProductComposer(productId, { contractVersion: "v4" });
}

async function createProductGroup(productId, body, actor = {}) {
  assertObjectId(productId, "productId");
  const payload = normalizeProductGroupRelationPayload({ ...body, productId });
  const [product, group] = await Promise.all([
    MenuProduct.findById(productId).lean(),
    MenuOptionGroup.findById(payload.groupId).lean(),
  ]);
  if (!product) throw new MenuNotFoundError("Product not found");
  if (!group) throw new MenuNotFoundError("Option group not found");

  const existing = await ProductOptionGroup.findOne({ productId, groupId: payload.groupId }).lean();
  const relation = existing
    ? await updateEntity(ProductOptionGroup, existing._id, { ...payload, isActive: true }, {
      entityType: "menu_product_group",
      actor,
      action: "product_group_attached",
      meta: { productId, groupId: payload.groupId },
    })
    : await createEntity(ProductOptionGroup, payload, { entityType: "menu_product_group", actor });

  await MenuProduct.updateOne({ _id: productId }, { $set: { isCustomizable: true } });

  const initialOptionIds = Array.isArray(body.initialOptionIds)
    ? [...new Set(body.initialOptionIds.map((item) => assertObjectId(item, "initialOptionIds[]")))]
    : [];
  const linkAllOptions = normalizeBoolean(body.linkAllOptions, "linkAllOptions", false);
  const optionRows = linkAllOptions
    ? await MenuOption.find({ groupId: payload.groupId, isActive: true }).lean()
    : (initialOptionIds.length ? await MenuOption.find({ _id: { $in: initialOptionIds }, isActive: true }).lean() : []);
  const catalogItemsById = optionRows.length ? await loadCatalogItemsByIdForDocs(optionRows) : new Map();
  const options = filterGloballyAvailable(optionRows, catalogItemsById);
  if (options.length > 0) {
    const optionRelations = options.map((opt) => ({
      productId,
      groupId: payload.groupId,
      optionId: opt._id,
      isActive: true,
      isVisible: true,
      isAvailable: true,
      sortOrder: opt.sortOrder || 0,
    }));
    for (const optionRelation of optionRelations) {
      await ProductGroupOption.updateOne(
        { productId, groupId: payload.groupId, optionId: optionRelation.optionId },
        { $set: optionRelation },
        { upsert: true }
      );
    }
  }
  await writeMenuAudit({
    entityType: "menu_product_group",
    entityId: productId,
    action: "product_group_attached",
    actor,
    meta: { productId, groupId: payload.groupId, optionIds: options.map((item) => String(item._id)), linkAllOptions },
  });

  return relation;
}

async function deleteProductGroup(productId, groupId, actor = {}) {
  assertObjectId(productId);
  assertObjectId(groupId);
  const result = await ProductOptionGroup.deleteOne({ productId, groupId });
  if (result.deletedCount > 0) {
    await ProductGroupOption.deleteMany({ productId, groupId });
    await writeMenuAudit({ entityType: "menu_product_group", entityId: productId, action: "product_group_detached", actor, meta: { productId, groupId } });
  }
  return { deleted: result.deletedCount };
}

async function updateProductGroup(productId, groupId, body, actor = {}, action = null) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  const existing = await ProductOptionGroup.findOne({ productId, groupId }).lean();
  if (!existing) throw new MenuNotFoundError("Product group relation not found");
  const payload = normalizeProductGroupRelationPayload({ ...body, productId, groupId }, existing);
  const updated = await updateEntity(ProductOptionGroup, existing._id, payload, {
    entityType: "menu_product_group",
    actor,
    action: action || changeAction(payload, "product_group_rules_changed"),
    meta: { productId, groupId },
  });
  return updated;
}

async function updateProductGroupSelectionRules(productId, groupId, body, actor = {}) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  const existing = await ProductOptionGroup.findOne({ productId, groupId }).lean();
  if (!existing) throw new MenuNotFoundError("Product group relation not found");
  const payload = normalizeSelectionRulePayload(body, existing);
  return updateEntity(ProductOptionGroup, existing._id, payload, {
    entityType: "menu_product_group",
    actor,
    action: "product_group_rules_changed",
    meta: { productId, groupId },
  });
}

async function listProductGroupOptions(productId, groupId, options = {}) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  const query = { productId, groupId, ...buildListQuery(options) };
  const pagination = parsePaginationOptions(options);
  const find = ProductGroupOption.find(query)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  if (!pagination) {
    const rows = await find;
    return rows.map(serializeDoc);
  }

  const [rows, total] = await Promise.all([
    find.skip(pagination.skip).limit(pagination.limit),
    ProductGroupOption.countDocuments(query),
  ]);

  return {
    items: rows.map(serializeDoc),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  };
}

function normalizeOptionIds(value = [], fieldName = "optionIds") {
  if (!Array.isArray(value)) throw new MenuValidationError(`${fieldName} must be an array`);
  return [...new Set(value.map((item) => assertObjectId(item, `${fieldName}[]`)))];
}

async function replaceProductGroupOptions(productId, groupId, body = {}, actor = {}) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  const optionIds = normalizeOptionIds(body.optionIds || []);
  const preserveOverrides = normalizeBoolean(body.preserveOverrides, "preserveOverrides", true);
  const [product, groupRelation, options] = await Promise.all([
    MenuProduct.findById(productId).lean(),
    ProductOptionGroup.findOne({ productId, groupId }).lean(),
    optionIds.length ? MenuOption.find({ _id: { $in: optionIds }, isActive: true }).lean() : [],
  ]);
  if (!product) throw new MenuNotFoundError("Product not found");
  if (!groupRelation) throw new MenuValidationError("Product group relation does not exist", "RELATION_NOT_FOUND", 404);
  if (options.length !== optionIds.length) {
    throw new MenuValidationError("One or more options do not exist or are globally disabled", "OPTION_NOT_ALLOWED", 400);
  }
  const catalogItemsById = await loadCatalogItemsByIdForDocs(options);
  const globallyAvailableOptions = filterGloballyAvailable(options, catalogItemsById);
  if (globallyAvailableOptions.length !== options.length) {
    throw new MenuValidationError("One or more options are linked to unavailable catalog items", "OPTION_NOT_AVAILABLE", 409);
  }
  const existingRelations = await ProductGroupOption.find({ productId, groupId }).lean();
  const existingByOptionId = new Map(existingRelations.map((row) => [String(row.optionId), row]));
  const optionIdSet = new Set(optionIds);

  await ProductGroupOption.deleteMany({ productId, groupId, optionId: { $nin: optionIds } });
  for (const option of options) {
    const optionId = String(option._id);
    const existing = existingByOptionId.get(optionId);
    const overrideFields = preserveOverrides && existing
      ? {
        extraPriceHalala: existing.extraPriceHalala,
        extraWeightUnitGrams: existing.extraWeightUnitGrams,
        extraWeightPriceHalala: existing.extraWeightPriceHalala,
      }
      : {
        extraPriceHalala: null,
        extraWeightUnitGrams: null,
        extraWeightPriceHalala: null,
      };
    await ProductGroupOption.updateOne(
      { productId, groupId, optionId },
      {
        $set: {
          productId,
          groupId,
          optionId,
          ...overrideFields,
          isActive: existing ? truthyByDefault(existing.isActive) : true,
          isVisible: existing ? truthyByDefault(existing.isVisible) : true,
          isAvailable: existing ? truthyByDefault(existing.isAvailable) : true,
          sortOrder: existing ? Number(existing.sortOrder || 0) : Number(option.sortOrder || 0),
        },
      },
      { upsert: true }
    );
  }

  await writeMenuAudit({
    entityType: "menu_product_group_option",
    entityId: productId,
    action: "product_group_options_replaced",
    actor,
    meta: {
      productId,
      groupId,
      optionIds,
      preserveOverrides,
      removedOptionIds: existingRelations.map((row) => String(row.optionId)).filter((id) => !optionIdSet.has(id)),
    },
  });

  return getProductComposer(productId, { contractVersion: "v4" });
}

async function getProductGroupOptionPool(productId, groupId, queryOptions = {}) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  const includeDisabled = normalizeBoolean(queryOptions.includeDisabled, "includeDisabled", false);
  const onlySuggested = normalizeBoolean(queryOptions.onlySuggested, "onlySuggested", false);
  const suggestedGroupId = queryOptions.suggestedGroupId
    ? assertObjectId(queryOptions.suggestedGroupId, "suggestedGroupId")
    : groupId;
  const optionQuery = includeDisabled ? {} : { isActive: true };
  const search = queryOptions.search || queryOptions.q;
  if (search !== undefined && search !== null && String(search).trim()) {
    const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    optionQuery.$or = [{ key: regex }, { "name.ar": regex }, { "name.en": regex }];
  }
  if (onlySuggested) optionQuery.groupId = suggestedGroupId;

  const [product, group, relation, optionRows, linkedRelations] = await Promise.all([
    MenuProduct.findById(productId).lean(),
    MenuOptionGroup.findById(groupId).lean(),
    ProductOptionGroup.findOne({ productId, groupId }).lean(),
    MenuOption.find(optionQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductGroupOption.find({ productId, groupId }).lean(),
  ]);
  if (!product) throw new MenuNotFoundError("Product not found");
  if (!group) throw new MenuNotFoundError("Option group not found");
  if (!relation) throw new MenuValidationError("Product group relation does not exist", "RELATION_NOT_FOUND", 404);

  const groupsById = new Map([[String(group._id), group]]);
  if (!groupsById.has(String(suggestedGroupId))) {
    const suggestedGroup = await MenuOptionGroup.findById(suggestedGroupId).lean();
    if (suggestedGroup) groupsById.set(String(suggestedGroup._id), suggestedGroup);
  }
  const linkedByOptionId = new Map(linkedRelations.map((row) => [String(row.optionId), row]));
  return {
    contractVersion: "dashboard_product_group_option_pool.v4",
    productId,
    groupId,
    group: {
      id: String(group._id),
      key: group.key || "",
      name: group.name || { ar: "", en: "" },
    },
    options: optionRows.map((option) => {
      const optionId = String(option._id);
      const linked = linkedByOptionId.get(optionId) || null;
      const suggestedGroup = groupsById.get(String(option.groupId)) || null;
      return {
        optionId,
        key: option.key || "",
        name: option.name || { ar: "", en: "" },
        isLinked: Boolean(linked),
        productOptionId: linked ? String(linked._id) : null,
        suggestedGroupId: option.groupId ? String(option.groupId) : null,
        suggestedGroupKey: suggestedGroup ? suggestedGroup.key : null,
        defaultPricing: serializeDefaultPricing(option),
        overridePricing: linked ? serializeOverridePricing(linked, option.currency) : serializeOverridePricing({}, option.currency),
        effectivePricing: linked ? serializeEffectivePricing(linked, option) : serializeDefaultPricing(option),
        nutrition: option.nutrition || {},
        status: statusTriple(option, linked || {}),
      };
    }),
  };
}

async function createProductGroupOption(productId, groupId, body, actor = {}) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  const relation = await ProductOptionGroup.findOne({ productId, groupId }).lean();
  if (!relation) throw new MenuValidationError("Product group relation does not exist", "RELATION_NOT_FOUND", 404);
  const payload = normalizeProductGroupOptionRelationPayload({ ...body, productId, groupId });
  const option = await MenuOption.findOne({ _id: payload.optionId, isActive: true }).lean();
  if (!option) throw new MenuValidationError("Option does not exist or is globally disabled", "OPTION_NOT_ALLOWED", 400);
  const existing = await ProductGroupOption.findOne({ productId, groupId, optionId: payload.optionId }).lean();
  if (existing) {
    return updateEntity(ProductGroupOption, existing._id, { ...payload, isActive: true }, {
      entityType: "menu_product_group_option",
      actor,
      action: "product_group_option_attached",
      meta: { productId, groupId, optionId: payload.optionId },
    });
  }
  const row = await createEntity(ProductGroupOption, payload, { entityType: "menu_product_group_option", actor });
  await writeMenuAudit({
    entityType: "menu_product_group_option",
    entityId: row.id,
    action: "product_group_option_attached",
    actor,
    meta: { productId, groupId, optionId: payload.optionId },
  });
  return row;
}

async function deleteProductGroupOption(productId, groupId, optionId, actor = {}) {
  assertObjectId(productId);
  assertObjectId(groupId);
  assertObjectId(optionId);
  const result = await ProductGroupOption.deleteOne({ productId, groupId, optionId });
  if (result.deletedCount > 0) {
    await writeMenuAudit({ entityType: "menu_product_group_option", entityId: productId, action: "product_group_option_detached", actor, meta: { productId, groupId, optionId } });
  }
  return { deleted: result.deletedCount };
}

async function updateProductGroupOption(productId, groupId, optionId, body, actor = {}, action = null) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  assertObjectId(optionId, "optionId");
  
  const existing = await ProductGroupOption.findOne({ productId, groupId, optionId }).lean();
  if (!existing) throw new MenuNotFoundError("Product group option relation not found");

  const payload = normalizeProductGroupOptionRelationPayload({ ...body, productId, groupId, optionId }, existing);
  
  // Use findOneAndUpdate as requested for atomic update and explicit query
  const updated = await ProductGroupOption.findOneAndUpdate(
    { productId, groupId, optionId },
    { $set: payload },
    { new: true }
  ).lean();

  if (!updated) throw new MenuNotFoundError("Product group option relation not found during update");

  await writeMenuAudit({
    entityType: "menu_product_group_option",
    entityId: updated._id,
    action: action || changeAction(payload, "product_group_option_override_changed"),
    before: existing,
    after: updated,
    actor,
    meta: { productId, groupId, optionId },
  });

  return serializeDoc(updated);
}

async function updateEntityField(Model, id, fieldName, value, { entityType, actor, action }) {
  assertObjectId(id);
  if (!["isVisible", "isAvailable"].includes(fieldName)) {
    throw new MenuValidationError("Unsupported field update");
  }
  const existing = await Model.findById(id).lean();
  if (!existing) throw new MenuNotFoundError();
  return updateEntity(Model, id, {
    [fieldName]: normalizeBoolean(value, fieldName, truthyByDefault(existing[fieldName])),
  }, { entityType, actor, action });
}

async function publishMenu({ actor = {}, notes = "" } = {}) {
  const publishedAt = new Date();
  await Promise.all([
    MenuCategory.updateMany({ isActive: true }, { $set: { publishedAt } }),
    MenuProduct.updateMany({ isActive: true }, { $set: { publishedAt } }),
    MenuOptionGroup.updateMany({ isActive: true }, { $set: { publishedAt } }),
    MenuOption.updateMany({ isActive: true }, { $set: { publishedAt } }),
  ]);
  const [publicSnapshot, dashboardCatalog] = await Promise.all([
    getPublishedMenu({ lang: "en" }).catch(() => ({})),
    buildDashboardCatalogSnapshot(),
  ]);
  const snapshot = {
    ...publicSnapshot,
    dashboardCatalog,
  };
  await MenuVersion.updateMany({ status: "published" }, { $set: { status: "archived" } });
  const version = await MenuVersion.create({
    status: "published",
    publishedAt,
    publishedBy: actor.userId && mongoose.Types.ObjectId.isValid(actor.userId) ? actor.userId : null,
    notes: String(notes || ""),
    snapshot,
  });
  await MenuProduct.updateMany({ isActive: true }, { $set: { versionId: version._id } });
  await writeMenuAudit({ entityType: "menu_version", entityId: version._id, action: "publish", after: version.toObject(), actor });
  return serializeDoc(version);
}

async function buildDashboardCatalogSnapshot() {
  const [categories, products, optionGroups, options, productGroups, productGroupOptions] = await Promise.all([
    MenuCategory.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuProduct.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuOptionGroup.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuOption.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductOptionGroup.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductGroupOption.find({}).sort({ sortOrder: 1, createdAt: -1 }).lean(),
  ]);

  return {
    version: 1,
    capturedAt: new Date(),
    categories: categories.map(serializeDoc),
    products: products.map(serializeDoc),
    optionGroups: optionGroups.map(serializeDoc),
    options: options.map(serializeDoc),
    productGroups: productGroups.map(serializeDoc),
    productGroupOptions: productGroupOptions.map(serializeDoc),
  };
}

async function listMenuVersions(options = {}) {
  const pagination = parsePaginationOptions(options);
  const find = MenuVersion.find({})
    .sort({ createdAt: -1 })
    .lean();

  if (!pagination) {
    const rows = await find.limit(Math.min(100, Math.max(1, Number(options.limit || 20))));
    return rows.map(serializeDoc);
  }

  const [rows, total] = await Promise.all([
    find.skip(pagination.skip).limit(pagination.limit),
    MenuVersion.countDocuments({}),
  ]);

  return {
    items: rows.map(serializeDoc),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.ceil(total / pagination.limit),
    },
  };
}

async function rollbackMenuVersion(versionId, { confirm = false, actor = {} } = {}) {
  if (!confirm) throw new MenuValidationError("أرسل confirm: true في الـ body", "ROLLBACK_CONFIRMATION_REQUIRED");
  assertObjectId(versionId);
  const version = await MenuVersion.findById(versionId).lean();
  if (!version) throw new MenuNotFoundError("Version not found");

  const snapshot = version.snapshot || {};
  if (snapshot.dashboardCatalog) {
    return restoreDashboardCatalogSnapshot(snapshot.dashboardCatalog, { versionId, actor });
  }

  if (!snapshot.categories) {
    throw new MenuValidationError("Version snapshot is incomplete or invalid", "ROLLBACK_INVALID_SNAPSHOT");
  }

  // Deep restore logic:
  // For each category/product/option in snapshot, we update its state in the DB.
  // Entities NOT in snapshot are marked as unpublished (publishedAt: null).
  
  await Promise.all([
    MenuCategory.updateMany({}, { $set: { publishedAt: null } }),
    MenuProduct.updateMany({}, { $set: { publishedAt: null } }),
    MenuOptionGroup.updateMany({}, { $set: { publishedAt: null } }),
    MenuOption.updateMany({}, { $set: { publishedAt: null } }),
  ]);

  const publishedAt = new Date();

  for (const cat of snapshot.categories || []) {
    await MenuCategory.updateOne({ _id: cat.id }, { 
      $set: { 
        publishedAt,
        isActive: true,
        sortOrder: cat.sortOrder,
        name: cat.nameI18n,
        description: cat.descriptionI18n || (typeof cat.description === "string" ? { en: cat.description, ar: "" } : cat.description)
      } 
    });

    for (const prod of cat.products || []) {
      await MenuProduct.updateOne({ _id: prod.id }, {
        $set: {
          publishedAt,
          isActive: true,
          categoryId: cat.id,
          priceHalala: prod.priceHalala,
          sortOrder: prod.sortOrder
        }
      });

      for (const group of prod.optionGroups || []) {
        await ProductOptionGroup.updateOne(
          { productId: prod.id, groupId: group.id },
          { 
            $set: { 
              isActive: true, 
              minSelections: group.minSelections, 
              maxSelections: group.maxSelections,
              isRequired: group.isRequired,
              sortOrder: group.sortOrder
            } 
          },
          { upsert: true }
        );

        for (const opt of group.options || []) {
          await MenuOption.updateOne({ _id: opt.id }, {
            $set: {
              publishedAt,
              isActive: true,
              groupId: group.id
            }
          });

          await ProductGroupOption.updateOne(
            { productId: prod.id, groupId: group.id, optionId: opt.id },
            {
              $set: {
                isActive: true,
                extraPriceHalala: opt.extraPriceHalala,
                extraWeightUnitGrams: opt.extraWeightUnitGrams,
                extraWeightPriceHalala: opt.extraWeightPriceHalala,
                sortOrder: opt.sortOrder
              }
            },
            { upsert: true }
          );
        }
      }
    }
  }

  return {
    ok: true,
    versionId: String(versionId),
    restoredFrom: "public_snapshot",
    restored: {
      categories: (snapshot.categories || []).length,
      products: (snapshot.categories || []).flatMap((category) => category.products || []).length,
    },
  };
}

function snapshotId(row) {
  return String(row && (row.id || row._id) || "");
}

function stripSnapshotMetadata(row) {
  const next = { ...(row || {}) };
  delete next.id;
  delete next._id;
  delete next.__v;
  delete next.createdAt;
  delete next.updatedAt;
  return next;
}

async function restoreModelSnapshot(Model, rows, publishedAt, { publishable = true } = {}) {
  const ids = rows.map(snapshotId).filter(Boolean);
  if (publishable) {
    await Model.updateMany(
      { _id: { $nin: ids } },
      { $set: { isActive: false, isVisible: false, isAvailable: false, publishedAt: null } }
    );
  }

  for (const row of rows) {
    const id = snapshotId(row);
    if (!id) continue;
    const payload = stripSnapshotMetadata(row);
    if (publishable && payload.publishedAt) payload.publishedAt = publishedAt;
    await Model.updateOne(
      { _id: id },
      { $set: payload, $setOnInsert: { _id: new mongoose.Types.ObjectId(id) } },
      { upsert: true }
    );
  }
}

async function restoreRelationSnapshot(Model, rows) {
  await Model.deleteMany({});
  if (!rows.length) return;
  await Model.insertMany(rows.map((row) => ({
    _id: new mongoose.Types.ObjectId(snapshotId(row)),
    ...stripSnapshotMetadata(row),
  })));
}

async function restoreDashboardCatalogSnapshot(snapshot, { versionId, actor = {} } = {}) {
  const requiredArrays = ["categories", "products", "optionGroups", "options", "productGroups", "productGroupOptions"];
  const invalid = requiredArrays.filter((key) => !Array.isArray(snapshot[key]));
  if (invalid.length) {
    throw new MenuValidationError("Version dashboard snapshot is incomplete or invalid", "ROLLBACK_INVALID_SNAPSHOT", 400, { invalid });
  }

  const publishedAt = new Date();
  await restoreModelSnapshot(MenuCategory, snapshot.categories, publishedAt);
  await restoreModelSnapshot(MenuProduct, snapshot.products, publishedAt);
  await restoreModelSnapshot(MenuOptionGroup, snapshot.optionGroups, publishedAt);
  await restoreModelSnapshot(MenuOption, snapshot.options, publishedAt);
  await restoreRelationSnapshot(ProductOptionGroup, snapshot.productGroups);
  await restoreRelationSnapshot(ProductGroupOption, snapshot.productGroupOptions);

  const restored = {
    categories: snapshot.categories.length,
    products: snapshot.products.length,
    optionGroups: snapshot.optionGroups.length,
    options: snapshot.options.length,
    productGroups: snapshot.productGroups.length,
    productGroupOptions: snapshot.productGroupOptions.length,
  };

  await writeMenuAudit({
    entityType: "menu_version",
    entityId: versionId,
    action: "rollback_restore",
    actor,
    meta: { restored, snapshotVersion: snapshot.version || 0 },
  });

  return {
    ok: true,
    versionId: String(versionId),
    restoredFrom: "dashboard_catalog_snapshot",
    restored,
  };
}

async function getMenuDiff() {
  const lastVersion = await MenuVersion.findOne({ status: "published" }).sort({ createdAt: -1 }).lean();
  const currentSnapshot = await getPublishedMenu({ lang: "en" }).catch(() => ({}));
  
  const lastSnapshot = lastVersion ? lastVersion.snapshot : { categories: [] };
  
  // Basic diff logic: compare product counts and keys
  const lastProducts = new Set((lastSnapshot.categories || []).flatMap(c => c.products || []).map(p => p.key));
  const currentProducts = new Set((currentSnapshot.categories || []).flatMap(c => c.products || []).map(p => p.key));
  
  const added = [...currentProducts].filter(x => !lastProducts.has(x));
  const removed = [...lastProducts].filter(x => !currentProducts.has(x));
  
  return {
    lastVersionId: lastVersion ? lastVersion._id : null,
    addedProducts: added,
    removedProducts: removed,
    changedCount: added.length + removed.length
  };
}

async function validateMenuCatalogInternal() {
  const [categories, products, groups, options, groupRelations, optionRelations] = await Promise.all([
    MenuCategory.find({}).lean(),
    MenuProduct.find({}).lean(),
    MenuOptionGroup.find({}).lean(),
    MenuOption.find({}).lean(),
    ProductOptionGroup.find({}).lean(),
    ProductGroupOption.find({}).lean(),
  ]);

  const errors = [];
  const warnings = [];
  const summary = {
    categories: categories.length,
    products: products.length,
    groups: groups.length,
    options: options.length,
    activeProducts: products.filter((p) => p.isActive).length,
  };

  const productsByKey = new Map();
  const productsById = new Map();
  products.forEach((p) => {
    productsById.set(String(p._id), p);
    if (p.isActive) {
      if (productsByKey.has(p.key)) {
        errors.push(`Duplicate active product key: ${p.key}`);
      }
      productsByKey.set(p.key, p);
    }
  });

  const categoriesByKey = new Map();
  categories.forEach((c) => {
    if (c.isActive) {
      if (categoriesByKey.has(c.key)) {
        errors.push(`Duplicate active category key: ${c.key}`);
      }
      categoriesByKey.set(c.key, c);
    }
  });

  const groupsById = new Map(groups.map((g) => [String(g._id), g]));
  const optionsById = new Map(options.map((o) => [String(o._id), o]));

  const requiredCustomKeys = ["basic_salad", "basic_meal", "fruit_salad", "greek_yogurt"];
  requiredCustomKeys.forEach((key) => {
    const p = productsByKey.get(key);
    if (!p) {
      errors.push(`Missing required custom product: ${key}`);
    } else if (!p.isActive) {
      warnings.push(`Required custom product is inactive: ${key}`);
    } else {
      if (key === "basic_salad" || key === "basic_meal") {
        if (p.pricingModel !== "per_100g") errors.push(`Product ${key} must have pricingModel per_100g`);
        if (!Number.isInteger(p.priceHalala) || p.priceHalala <= 0) errors.push(`Product ${key} must have integer priceHalala > 0`);
        if (p.baseUnitGrams <= 0) errors.push(`Product ${key} must have baseUnitGrams > 0`);
      } else {
        if (p.pricingModel !== "fixed") errors.push(`Product ${key} must have pricingModel fixed`);
        if (!Number.isInteger(p.priceHalala) || p.priceHalala <= 0) errors.push(`Product ${key} must have integer priceHalala > 0`);
      }
    }
  });

  products.forEach((p) => {
    if (p.isActive) {
      if (p.pricingModel === "fixed" && p.priceHalala <= 0) {
        errors.push(`Active fixed product ${p.key} must have priceHalala > 0`);
      }
      if (p.pricingModel === "per_100g" && (p.priceHalala <= 0 || p.baseUnitGrams <= 0)) {
        errors.push(`Active per_100g product ${p.key} must have priceHalala > 0 and baseUnitGrams > 0`);
      }
    }
  });

  const groupRelationsByProduct = new Map();
  groupRelations.forEach((r) => {
    const p = productsById.get(String(r.productId));
    const g = groupsById.get(String(r.groupId));
    if (!p) errors.push(`ProductOptionGroup references non-existent product: ${r.productId}`);
    if (!g) errors.push(`ProductOptionGroup references non-existent group: ${r.groupId}`);

    if (p && g && r.isActive) {
      if (!p.isActive) errors.push(`Active group relation for inactive product: ${p.key}`);
      if (!g.isActive) errors.push(`Active group relation for inactive group: ${g.key}`);

      if (r.minSelections < 0) errors.push(`Group ${g.key} on ${p.key} has invalid minSelections: ${r.minSelections}`);
      if (r.maxSelections !== null && r.maxSelections < r.minSelections) {
        errors.push(`Group ${g.key} on ${p.key} has maxSelections < minSelections`);
      }
      if (r.isRequired && (r.maxSelections !== null && r.maxSelections <= 0)) {
        errors.push(`Group ${g.key} on ${p.key} isRequired but maxSelections <= 0`);
      }

      if (!groupRelationsByProduct.has(String(p._id))) groupRelationsByProduct.set(String(p._id), []);
      groupRelationsByProduct.get(String(p._id)).push(r);
    }
  });

  const optionsByGroup = new Map();
  options.forEach((o) => {
    if (o.isActive) {
      const gId = String(o.groupId);
      if (!optionsByGroup.has(gId)) optionsByGroup.set(gId, new Set());
      if (optionsByGroup.get(gId).has(o.key)) {
        errors.push(`Duplicate active option key ${o.key} in group ${gId}`);
      }
      optionsByGroup.get(gId).add(o.key);
    }
  });

  const optionRelationsByProductGroup = new Map();
  optionRelations.forEach((r) => {
    const key = `${r.productId}:${r.groupId}:${r.optionId}`;
    if (r.isActive) {
      if (optionRelationsByProductGroup.has(key)) {
        errors.push(`Duplicate active ProductGroupOption for ${key}`);
      }
      optionRelationsByProductGroup.set(key, r);

      const p = productsById.get(String(r.productId));
      const g = groupsById.get(String(r.groupId));
      const o = optionsById.get(String(r.optionId));

      if (!p) errors.push(`ProductGroupOption references non-existent product: ${r.productId}`);
      if (!g) errors.push(`ProductGroupOption references non-existent group: ${r.groupId}`);
      if (!o) errors.push(`ProductGroupOption references non-existent option: ${r.optionId}`);

      if (o && String(o.groupId) !== String(r.groupId)) {
        errors.push(`Option ${o.key} does not belong to group ${g ? g.key : r.groupId}`);
      }

      if (r.extraPriceHalala !== null && (!Number.isInteger(r.extraPriceHalala) || r.extraPriceHalala < 0)) {
        errors.push(`Option ${o ? o.key : r.optionId} on ${p ? p.key : r.productId} has invalid extraPriceHalala`);
      }
      if (r.extraWeightUnitGrams !== null && (!Number.isInteger(r.extraWeightUnitGrams) || r.extraWeightUnitGrams < 0)) {
        errors.push(`Option ${o ? o.key : r.optionId} on ${p ? p.key : r.productId} has invalid extraWeightUnitGrams`);
      }
      if (r.extraWeightPriceHalala !== null && (!Number.isInteger(r.extraWeightPriceHalala) || r.extraWeightPriceHalala < 0)) {
        errors.push(`Option ${o ? o.key : r.optionId} on ${p ? p.key : r.productId} has invalid extraWeightPriceHalala`);
      }

      const unit = r.extraWeightUnitGrams !== null ? r.extraWeightUnitGrams : (o ? o.extraWeightUnitGrams : 0);
      const price = r.extraWeightPriceHalala !== null ? r.extraWeightPriceHalala : (o ? o.extraWeightPriceHalala : 0);

      if (price > 0 && unit <= 0) {
        warnings.push(`Option ${o ? o.key : r.optionId} on ${p ? p.key : r.productId} has extraWeightPrice but unit is 0`);
      }
      if (unit > 0 && price <= 0) {
        warnings.push(`Option ${o ? o.key : r.optionId} on ${p ? p.key : r.productId} has extraWeightUnit but price is 0`);
      }
    }
  });

  groupRelations.filter((r) => r.isActive && r.isRequired).forEach((r) => {
    const activeOptionsCount = optionRelations.filter((or) => (
      or.isActive &&
      String(or.productId) === String(r.productId) &&
      String(or.groupId) === String(r.groupId)
    )).length;

    if (activeOptionsCount < r.minSelections) {
      const p = productsById.get(String(r.productId));
      const g = groupsById.get(String(r.groupId));
      errors.push(`Required group ${g ? g.key : r.groupId} on ${p ? p.key : r.productId} only has ${activeOptionsCount} active options, but minSelections is ${r.minSelections}`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}

module.exports = {
  PRODUCT_ITEM_TYPES,
  MenuNotFoundError,
  MenuValidationError,
  getPublishedMenu,
  hasPublishedMenuCatalog,
  listCategories: (options) => listModel(MenuCategory, options),
  listProducts,
  listOptionGroups: (options) => listModel(MenuOptionGroup, options),
  listOptions,
  getCategory: getCategoryDetail,
  getProduct: getProductDetail,
  getProductComposer,
  getCustomizationLibrary,
  updateProductCustomization,
  getOptionGroup: getOptionGroupDetail,
  getOption: getOptionDetail,
  createCategory: async (body, actor) => {
    const payload = normalizeCategoryPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "category",
        exists: (key) => MenuCategory.exists({ key }),
      });
    }
    return createEntity(MenuCategory, payload, { entityType: "menu_category", actor });
  },
  createProduct: async (body, actor) => {
    const payload = normalizeProductPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "item",
        exists: (key) => MenuProduct.exists({ key }),
      });
    }
    const category = await MenuCategory.findOne({ _id: payload.categoryId, isActive: true }).lean();
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
    if (payload.catalogItemId) await assertCatalogItemLinkable(payload.catalogItemId);
    return createEntity(MenuProduct, payload, { entityType: "menu_product", actor });
  },
  createOptionGroup: async (body, actor) => {
    const payload = normalizeGroupPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "group",
        exists: (key) => MenuOptionGroup.exists({ key }),
      });
    }
    return createEntity(MenuOptionGroup, payload, { entityType: "menu_option_group", actor });
  },
  createOption: async (body, actor) => {
    const payload = normalizeOptionPayload(body);
    if (!payload.key) {
      payload.key = await generateUniqueKey({
        name: payload.name,
        fallbackPrefix: "option",
        exists: (key) => MenuOption.exists({ groupId: payload.groupId, key }),
      });
    }
    if (payload.catalogItemId) await assertCatalogItemLinkable(payload.catalogItemId);
    const option = await createEntity(MenuOption, payload, { entityType: "menu_option", actor });
    return serializeDashboardOption(option);
  },
  updateCategory: async (id, body, actor) => {
    const existing = await MenuCategory.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    const payload = normalizeCategoryPayload(body, existing);
    return updateEntity(MenuCategory, id, payload, { entityType: "menu_category", actor, action: changeAction(payload) });
  },
  updateProduct: async (id, body, actor) => {
    const existing = await MenuProduct.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    let existingForPayload = existing;
    if (body?.isCustomizable === undefined && existing.isCustomizable !== true) {
      const activeGroupCount = await ProductOptionGroup.countDocuments({
        productId: id,
        isActive: true,
        isVisible: { $ne: false },
        isAvailable: { $ne: false },
      });
      if (activeGroupCount > 0) existingForPayload = { ...existing, isCustomizable: true };
    }
    const payload = normalizeProductPayload(body, existingForPayload);
    const category = await MenuCategory.findOne({ _id: payload.categoryId, isActive: true }).lean();
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
    if (payload.catalogItemId && String(payload.catalogItemId) !== String(existing.catalogItemId || "")) {
      await assertCatalogItemLinkable(payload.catalogItemId);
    }
    const product = await updateEntity(MenuProduct, id, payload, { entityType: "menu_product", actor, action: changeAction(payload) });
    if (payload.isCustomizable === false) {
      await Promise.all([
        ProductOptionGroup.updateMany({ productId: id }, { $set: { isActive: false, isVisible: false, isAvailable: false } }),
        ProductGroupOption.updateMany({ productId: id }, { $set: { isActive: false, isVisible: false, isAvailable: false } }),
      ]);
    }
    await mirrorCompatibilityImage(Sandwich, id, payload.imageUrl);
    return product;
  },
  updateOptionGroup: async (id, body, actor) => {
    const existing = await MenuOptionGroup.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    const payload = normalizeGroupPayload(body, existing);
    return updateEntity(MenuOptionGroup, id, payload, { entityType: "menu_option_group", actor, action: changeAction(payload) });
  },
  updateOption: async (id, body, actor) => {
    const existing = await MenuOption.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    const payload = normalizeOptionPayload(body, existing);
    if (payload.catalogItemId && String(payload.catalogItemId) !== String(existing.catalogItemId || "")) {
      await assertCatalogItemLinkable(payload.catalogItemId);
    }
    const option = await updateEntity(MenuOption, id, payload, { entityType: "menu_option", actor, action: changeAction(payload) });
    await mirrorCompatibilityImage(BuilderProtein, id, payload.imageUrl);
    return serializeDashboardOption(option);
  },
  updateCategoryVisibility: (id, body, actor) => updateEntityField(MenuCategory, id, "isVisible", body.isVisible, { entityType: "menu_category", actor, action: "visibility_changed" }),
  updateCategoryAvailability: (id, body, actor) => updateEntityField(MenuCategory, id, "isAvailable", body.isAvailable, { entityType: "menu_category", actor, action: "availability_changed" }),
  updateProductVisibility: (id, body, actor) => updateEntityField(MenuProduct, id, "isVisible", body.isVisible, { entityType: "menu_product", actor, action: "visibility_changed" }),
  updateProductAvailabilityState: (id, body, actor) => updateEntityField(MenuProduct, id, "isAvailable", body.isAvailable, { entityType: "menu_product", actor, action: "availability_changed" }),
  updateOptionGroupVisibility: (id, body, actor) => updateEntityField(MenuOptionGroup, id, "isVisible", body.isVisible, { entityType: "menu_option_group", actor, action: "visibility_changed" }),
  updateOptionGroupAvailability: (id, body, actor) => updateEntityField(MenuOptionGroup, id, "isAvailable", body.isAvailable, { entityType: "menu_option_group", actor, action: "availability_changed" }),
  updateOptionVisibility: (id, body, actor) => updateEntityField(MenuOption, id, "isVisible", body.isVisible, { entityType: "menu_option", actor, action: "visibility_changed" }),
  updateOptionAvailability: (id, body, actor) => updateEntityField(MenuOption, id, "isAvailable", body.isAvailable, { entityType: "menu_option", actor, action: "availability_changed" }),
  deleteCategory: (id, actor) => softDeleteEntity(MenuCategory, id, { entityType: "menu_category", actor }),
  deleteProduct: (id, actor) => softDeleteEntity(MenuProduct, id, { entityType: "menu_product", actor }),
  deleteOptionGroup: (id, actor) => softDeleteEntity(MenuOptionGroup, id, { entityType: "menu_option_group", actor }),
  deleteOption: (id, actor) => softDeleteEntity(MenuOption, id, { entityType: "menu_option", actor }),
  reorderCategories: (items, actor) => reorder(MenuCategory, items, { entityType: "menu_category", actor }),
  reorderProducts: (items, actor) => reorder(MenuProduct, items, { entityType: "menu_product", actor }),
  reorderOptionGroups: (items, actor) => reorder(MenuOptionGroup, items, { entityType: "menu_option_group", actor }),
  reorderOptions: (items, actor) => reorder(MenuOption, items, { entityType: "menu_option", actor }),
  duplicateProduct,
  listProductGroups,
  createProductGroup,
  updateProductGroup,
  deleteProductGroup,
  updateProductGroupSelectionRules,
  updateProductGroupVisibility: (productId, groupId, body, actor) => updateProductGroup(productId, groupId, { isVisible: body.isVisible }, actor, "visibility_changed"),
  updateProductGroupAvailability: (productId, groupId, body, actor) => updateProductGroup(productId, groupId, { isAvailable: body.isAvailable }, actor, "availability_changed"),
  listProductGroupOptions,
  replaceProductGroupOptions,
  getProductGroupOptionPool,
  createProductGroupOption,
  updateProductGroupOption,
  deleteProductGroupOption,
  updateProductGroupOptionVisibility: (productId, groupId, optionId, body, actor) => updateProductGroupOption(productId, groupId, optionId, { isVisible: body.isVisible }, actor, "visibility_changed"),
  updateProductGroupOptionAvailability: (productId, groupId, optionId, body, actor) => updateProductGroupOption(productId, groupId, optionId, { isAvailable: body.isAvailable }, actor, "availability_changed"),
  toggleOption: async (id, actor) => {
    const existing = await MenuOption.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    return updateEntity(MenuOption, id, { isActive: !existing.isActive }, { entityType: "menu_option", actor, action: "toggle_active" });
  },
  bulkAssignProductsToCategory,
  bulkUpdateProducts,
  publishMenu,
  validateMenu: validateMenuCatalogInternal,
  listVersions: listMenuVersions,
  rollbackMenu: rollbackMenuVersion,
  diffMenu: getMenuDiff,
  listAuditLogs: async (options = {}) => {
    const pagination = parsePaginationOptions(options);
    const find = MenuAuditLog.find({})
      .sort({ createdAt: -1 })
      .lean();

    if (!pagination) {
      const rows = await find.limit(Math.min(200, Math.max(1, Number(options.limit || 50))));
      return rows.map(serializeDoc);
    }

    const [rows, total] = await Promise.all([
      find.skip(pagination.skip).limit(pagination.limit),
      MenuAuditLog.countDocuments({}),
    ]);

    return {
      items: rows.map(serializeDoc),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  },
};

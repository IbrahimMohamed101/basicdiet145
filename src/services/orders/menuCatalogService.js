const mongoose = require("mongoose");
const {
  availableForChannelQuery,
} = require("../subscription/subscriptionMenuEligibilityPolicyService");

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
const {
  assertCatalogItemLinkable,
  filterGloballyAvailable,
  loadCatalogItemsByIdForDocs,
} = require("../catalog/catalogAvailabilityService");
const { VAT_PERCENTAGE } = require("../../config/vat");
const {
  generateUniqueKey,
  isAllowedCategoryCardVariant,
  isAllowedCardVariant,
  isAllowedProductCardSize,
  isAllowedGroupDisplayStyle,
  normalizeCategoryUiMetadata,
  normalizeGroupUiMetadata,
  normalizeProductUiMetadata,
  normalizeUiMetadata,
} = require("../catalog/catalogKeyUiHelpers");
const {
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
  isCustomerVisibleOption: isPresenterCustomerVisibleOption,
  resolvePublicProductCategory,
  sortPublicProducts,
} = require("./menuCatalogPresenter");
const { validateMenuCatalog } = require("./menuCatalogValidationService");
const {
  CUSTOMER_VISIBLE_CARB_KEYS,
} = require("../../config/mealPlannerContract");
const SYSTEM_CURRENCY = "SAR";
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const CUSTOMER_VISIBLE_CARB_KEY_SET = new Set(CUSTOMER_VISIBLE_CARB_KEYS);
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

function serializeDoc(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  if (obj.categoryId !== undefined && obj.priceHalala !== undefined) {
    obj.ui = normalizeProductUiMetadata(obj.ui);
  }
  return { id: String(obj._id), ...obj };
}

function serializeDashboardOption(option) {
  return menuCatalogAdminService.serializeDashboardOption(option);
}

function isCustomerVisibleOption(option, group, product) {
  if (group?.key === "carbs") {
    return CUSTOMER_VISIBLE_CARB_KEY_SET.has(option?.key);
  }
  return isPresenterCustomerVisibleOption(option, group, product);
}

function parsePaginationOptions(options = {}) {
  const pageRequested = options.page !== undefined && options.page !== null && String(options.page).trim() !== "";
  const limitRequested = options.limit !== undefined && options.limit !== null && String(options.limit).trim() !== "";
  if (!pageRequested && !limitRequested) return null;

  const page = Math.max(1, Number.parseInt(options.page || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(options.limit || "25", 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
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
  return false;
}

async function refreshProductCustomizableFromRelations(productId) {
  const product = await MenuProduct.findById(productId).select("pricingModel").lean();
  if (!product) return false;
  const relationCount = await ProductOptionGroup.countDocuments({
    productId,
    isActive: true,
    isVisible: { $ne: false },
    isAvailable: { $ne: false },
  });
  const isCustomizable = relationCount > 0
    || product.pricingModel === "per_100g";
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

  const [categories, productRows, groupRelations, optionRelations, groups, optionRows] = await Promise.all([
    MenuCategory.find(categoryQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuProduct.find(productQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductOptionGroup.find(customerRelationQuery()).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductGroupOption.find(customerRelationQuery()).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuOptionGroup.find(customerCatalogQuery()).lean(),
    MenuOption.find(customerCatalogQuery(availableForChannelQuery("one_time"))).lean(),
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
    const rawOptionRelations = optionRelationsByProductGroup.get(`${relation.productId}:${relation.groupId}`) || [];
    let mismatchedOptionRelationCount = 0;
    const optionRows = rawOptionRelations
      .map((optionRelation) => {
        const option = optionsById.get(String(optionRelation.optionId));
        if (option && String(option.groupId) !== String(optionRelation.groupId)) {
          mismatchedOptionRelationCount += 1;
          return null;
        }
        if (!option || !isCustomerVisibleOption(option, group, product)) return null;
        return serializePublicOption(optionRelation, option, lang);
      })
      .filter(Boolean)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (rawOptionRelations.length > 0 && mismatchedOptionRelationCount === rawOptionRelations.length && optionRows.length === 0) return;
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
    vatPercentage: VAT_PERCENTAGE,
    categories: serializedCategories,
  };
}

function getDashboardMenuPreview(options) {
  return menuCatalogAdminService.getDashboardMenuPreview(options);
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

function buildListQuery(options) {
  return menuCatalogAdminService.buildListQuery(options);
}

function buildProductFilter(options) {
  return menuCatalogAdminService.buildProductFilter(options);
}

function listModel(Model, options, extraQuery, serializer) {
  return menuCatalogAdminService.listModel(Model, options, extraQuery, serializer);
}

function serializeDashboardPickerProduct(row) {
  return menuCatalogAdminService.serializeDashboardPickerProduct(row);
}

function listProducts(options) {
  return menuCatalogAdminService.listProducts(options);
}

function listOptions(options) {
  return menuCatalogAdminService.listOptions(options);
}

function getModel(Model, id, extraQuery) {
  return menuCatalogAdminService.getModel(Model, id, extraQuery);
}

function serializeAdminProductSummary(product) {
  return menuCatalogAdminService.serializeAdminProductSummary(product);
}

function serializeCategoryDetailV3(category, products) {
  return menuCatalogAdminService.serializeCategoryDetailV3(category, products);
}

function assertDashboardContractVersion(options) {
  return menuCatalogAdminService.assertDashboardContractVersion(options);
}

function getCategoryDetail(id, options) {
  return menuCatalogAdminService.getCategoryDetail(id, options);
}

function getProductDetail(id) {
  return menuCatalogAdminService.getProductDetail(id);
}

function getOptionGroupDetail(id, options) {
  return menuCatalogAdminService.getOptionGroupDetail(id, options);
}

function getOptionDetail(id, options) {
  return menuCatalogAdminService.getOptionDetail(id, options);
}

function normalizeCategoryPayload(body, existing) {
  return menuCatalogAdminService.normalizeCategoryPayload(body, existing);
}

function normalizeProductPayload(body, existing) {
  return menuCatalogAdminService.normalizeProductPayload(body, existing);
}

function normalizeGroupPayload(body, existing) {
  return menuCatalogAdminService.normalizeGroupPayload(body, existing);
}

function normalizeOptionPayload(body, existing) {
  return menuCatalogAdminService.normalizeOptionPayload(body, existing);
}

function normalizeSelectionRulePayload(body, existing, prefix) {
  return menuCatalogAdminService.normalizeSelectionRulePayload(body, existing, prefix);
}

function normalizeProductGroupRelationPayload(body, existing) {
  return menuCatalogAdminService.normalizeProductGroupRelationPayload(body, existing);
}

function normalizeProductGroupOptionRelationPayload(body, existing) {
  return menuCatalogAdminService.normalizeProductGroupOptionRelationPayload(body, existing);
}

function changeAction(payload, fallback) {
  return menuCatalogAdminService.changeAction(payload, fallback);
}

function createEntity(Model, payload, options) {
  return menuCatalogAdminService.createEntity(Model, payload, options);
}

function updateEntity(Model, id, payload, options) {
  return menuCatalogAdminService.updateEntity(Model, id, payload, options);
}

function softDeleteEntity(Model, id, options) {
  return menuCatalogAdminService.softDeleteEntity(Model, id, options);
}

function reorder(Model, items, options) {
  return menuCatalogAdminService.reorder(Model, items, options);
}

function duplicateProduct(productId, actor) {
  return menuCatalogAdminService.duplicateProduct(productId, actor);
}

function normalizeBulkProductIds(productIds, fieldName) {
  return menuCatalogAdminService.normalizeBulkProductIds(productIds, fieldName);
}

function bulkAssignProductsToCategory(categoryId, body, actor) {
  return menuCatalogAdminService.bulkAssignProductsToCategory(categoryId, body, actor);
}

function bulkUpdateProducts(body, actor) {
  return menuCatalogAdminService.bulkUpdateProducts(body, actor);
}

function listProductGroups(productId, options) {
  return menuCatalogAdminService.listProductGroups(productId, options);
}

function serializeDefaultPricing(source) {
  return menuCatalogAdminService.serializeDefaultPricing(source);
}

function serializeOverridePricing(source, currency) {
  return menuCatalogAdminService.serializeOverridePricing(source, currency);
}

function serializeEffectivePricing(relation, option) {
  return menuCatalogAdminService.serializeEffectivePricing(relation, option);
}

function statusTriple(globalDoc, relationDoc) {
  return menuCatalogAdminService.statusTriple(globalDoc, relationDoc);
}

function serializeLibraryGroup(group) {
  return menuCatalogAdminService.serializeLibraryGroup(group);
}

function serializeLibraryOption(option, group) {
  return menuCatalogAdminService.serializeLibraryOption(option, group);
}

function getProductComposer(productId, composerOptions) {
  return menuCatalogAdminService.getProductComposer(productId, composerOptions);
}

function getCustomizationLibrary(options) {
  return menuCatalogAdminService.getCustomizationLibrary(options);
}

function updateProductCustomization(productId, body, actor) {
  return menuCatalogAdminService.updateProductCustomization(productId, body, actor);
}

function createProductGroup(productId, body, actor) {
  return menuCatalogAdminService.createProductGroup(productId, body, actor);
}

function deleteProductGroup(productId, groupId, actor) {
  return menuCatalogAdminService.deleteProductGroup(productId, groupId, actor);
}

function updateProductGroup(productId, groupId, body, actor, action) {
  return menuCatalogAdminService.updateProductGroup(productId, groupId, body, actor, action);
}

function updateProductGroupSelectionRules(productId, groupId, body, actor) {
  return menuCatalogAdminService.updateProductGroupSelectionRules(productId, groupId, body, actor);
}

function listProductGroupOptions(productId, groupId, options) {
  return menuCatalogAdminService.listProductGroupOptions(productId, groupId, options);
}

function normalizeOptionIds(value, fieldName) {
  return menuCatalogAdminService.normalizeOptionIds(value, fieldName);
}

function replaceProductGroupOptions(productId, groupId, body, actor) {
  return menuCatalogAdminService.replaceProductGroupOptions(productId, groupId, body, actor);
}

function getProductGroupOptionPool(productId, groupId, queryOptions) {
  return menuCatalogAdminService.getProductGroupOptionPool(productId, groupId, queryOptions);
}

function createProductGroupOption(productId, groupId, body, actor) {
  return menuCatalogAdminService.createProductGroupOption(productId, groupId, body, actor);
}

function deleteProductGroupOption(productId, groupId, optionId, actor) {
  return menuCatalogAdminService.deleteProductGroupOption(productId, groupId, optionId, actor);
}

function updateProductGroupOption(productId, groupId, optionId, body, actor, action) {
  return menuCatalogAdminService.updateProductGroupOption(productId, groupId, optionId, body, actor, action);
}

function updateEntityField(Model, id, fieldName, value, options) {
  return menuCatalogAdminService.updateEntityField(Model, id, fieldName, value, options);
}

const { createMenuCatalogAdminService } = require("./menuCatalogAdminService");
const menuCatalogAdminService = createMenuCatalogAdminService({
  mongoose,
  MenuCategory,
  MenuProduct,
  MenuOptionGroup,
  MenuOption,
  ProductOptionGroup,
  ProductGroupOption,
  MenuAuditLog,
  BuilderProtein,
  Sandwich,
  Setting,
  SYSTEM_CURRENCY,
  VAT_PERCENTAGE,
  assertCatalogItemLinkable,
  filterGloballyAvailable,
  loadCatalogItemsByIdForDocs,
  generateUniqueKey,
  isAllowedCategoryCardVariant,
  isAllowedCardVariant,
  isAllowedProductCardSize,
  isAllowedGroupDisplayStyle,
  normalizeCategoryUiMetadata,
  normalizeGroupUiMetadata,
  normalizeProductUiMetadata,
  normalizeUiMetadata,
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
  validateMenuCatalog,
  MenuValidationError,
  MenuNotFoundError,
  assertObjectId,
  normalizeOptionalObjectId,
  mirrorCompatibilityImage,
  isPlainObject,
  normalizeKey,
  normalizeOptionalKey,
  assertImmutableKey,
  assertImmutableCatalogItemLink,
  localizedString,
  optionalLocalizedString,
  normalizeBoolean,
  normalizeNonNegativeInteger,
  normalizeNullableNonNegativeInteger,
  normalizeStringArray,
  normalizeAvailableFor,
  normalizeOptionalString,
  serializeDoc,
  parsePaginationOptions,
  inferProductCustomizable,
  refreshProductCustomizableFromRelations,
  customerCatalogQuery,
  availableForChannelQuery,
  customerRelationQuery,
  assertCustomerAvailable,
  assertRelationAvailable,
  getSettingValue,
  writeMenuAudit,
});

const { createMenuReleaseService } = require("./menuReleaseService");
const menuReleaseService = createMenuReleaseService({
  getPublishedMenu,
  writeMenuAudit,
  serializeDoc,
  parsePaginationOptions,
  assertObjectId,
  MenuValidationError,
  MenuNotFoundError,
});

module.exports = {
  MenuNotFoundError,
  MenuValidationError,
  getPublishedMenu,
  getDashboardMenuPreview,
  hasPublishedMenuCatalog,
  listCategories: (options) => menuCatalogAdminService.listCategories(options),
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
  createCategory: (body, actor) => menuCatalogAdminService.createCategory(body, actor),
  createProduct: (body, actor) => menuCatalogAdminService.createProduct(body, actor),
  createOptionGroup: (body, actor) => menuCatalogAdminService.createOptionGroup(body, actor),
  createOption: (body, actor) => menuCatalogAdminService.createOption(body, actor),
  updateCategory: (id, body, actor) => menuCatalogAdminService.updateCategory(id, body, actor),
  updateProduct: (id, body, actor) => menuCatalogAdminService.updateProduct(id, body, actor),
  updateOptionGroup: (id, body, actor) => menuCatalogAdminService.updateOptionGroup(id, body, actor),
  updateOption: (id, body, actor) => menuCatalogAdminService.updateOption(id, body, actor),
  updateCategoryVisibility: (id, body, actor) => menuCatalogAdminService.updateCategoryVisibility(id, body, actor),
  updateCategoryAvailability: (id, body, actor) => menuCatalogAdminService.updateCategoryAvailability(id, body, actor),
  updateProductVisibility: (id, body, actor) => menuCatalogAdminService.updateProductVisibility(id, body, actor),
  updateProductAvailabilityState: (id, body, actor) => menuCatalogAdminService.updateProductAvailabilityState(id, body, actor),
  updateOptionGroupVisibility: (id, body, actor) => menuCatalogAdminService.updateOptionGroupVisibility(id, body, actor),
  updateOptionGroupAvailability: (id, body, actor) => menuCatalogAdminService.updateOptionGroupAvailability(id, body, actor),
  updateOptionVisibility: (id, body, actor) => menuCatalogAdminService.updateOptionVisibility(id, body, actor),
  updateOptionAvailability: (id, body, actor) => menuCatalogAdminService.updateOptionAvailability(id, body, actor),
  deleteCategory: (id, actor) => menuCatalogAdminService.deleteCategory(id, actor),
  deleteProduct: (id, actor) => menuCatalogAdminService.deleteProduct(id, actor),
  deleteOptionGroup: (id, actor) => menuCatalogAdminService.deleteOptionGroup(id, actor),
  deleteOption: (id, actor) => menuCatalogAdminService.deleteOption(id, actor),
  reorderCategories: (items, actor) => menuCatalogAdminService.reorderCategories(items, actor),
  reorderProducts: (items, actor) => menuCatalogAdminService.reorderProducts(items, actor),
  reorderOptionGroups: (items, actor) => menuCatalogAdminService.reorderOptionGroups(items, actor),
  reorderOptions: (items, actor) => menuCatalogAdminService.reorderOptions(items, actor),
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
    const updated = await updateEntity(MenuOption, id, { isActive: !existing.isActive }, { entityType: "menu_option", actor, action: "toggle_active" });
    return serializeDashboardOption(updated);
  },
  bulkAssignProductsToCategory,
  bulkUpdateProducts,
  publishMenu: menuReleaseService.publishMenu,
  validateMenu: validateMenuCatalog,
  listVersions: menuReleaseService.listMenuVersions,
  rollbackMenu: menuReleaseService.rollbackMenuVersion,
  diffMenu: menuReleaseService.getMenuDiff,
  listAuditLogs: (options) => menuCatalogAdminService.listAuditLogs(options),
};

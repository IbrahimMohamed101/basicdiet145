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
  isCustomerVisibleOption,
  resolvePublicProductCategory,
  sortPublicProducts,
} = require("./menuCatalogPresenter");
const { validateMenuCatalog } = require("./menuCatalogValidationService");

const SYSTEM_CURRENCY = "SAR";
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
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

function getProductComposer(productId, composerOptions) {
  return menuCatalogAdminService.getProductComposer(productId, composerOptions);
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

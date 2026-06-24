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
  const updated = await updateEntity(Model, id, {
    [fieldName]: normalizeBoolean(value, fieldName, truthyByDefault(existing[fieldName])),
  }, { entityType, actor, action });
  if (Model === MenuOption) {
    return serializeDashboardOption(updated);
  }
  return serializeDoc(updated);
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

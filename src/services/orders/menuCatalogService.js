const mongoose = require("mongoose");

const MenuAuditLog = require("../../models/MenuAuditLog");
const MenuCategory = require("../../models/MenuCategory");
const MenuOption = require("../../models/MenuOption");
const MenuOptionGroup = require("../../models/MenuOptionGroup");
const MenuProduct = require("../../models/MenuProduct");
const MenuVersion = require("../../models/MenuVersion");
const ProductGroupOption = require("../../models/ProductGroupOption");
const ProductOptionGroup = require("../../models/ProductOptionGroup");
const Setting = require("../../models/Setting");
const { pickLang } = require("../../utils/i18n");

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
  constructor(message = "Menu entity not found") {
    super(message);
    this.name = "MenuNotFoundError";
    this.code = "MENU_ENTITY_NOT_FOUND";
    this.status = 404;
  }
}

function assertObjectId(value, fieldName = "id") {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw new MenuValidationError(`${fieldName} must be a valid ObjectId`, "INVALID_OBJECT_ID");
  }
  return String(value);
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

function serializePublicCategory(category, lang, products) {
  return {
    id: String(category._id),
    key: category.key,
    name: localizeName(category.name, lang),
    nameI18n: localizedPair(category.name),
    description: localizeName(category.description, lang),
    imageUrl: category.imageUrl || "",
    sortOrder: Number(category.sortOrder || 0),
    products,
  };
}

function serializePublicProduct(product, lang, optionGroups) {
  return {
    id: String(product._id),
    key: product.key,
    categoryId: String(product.categoryId),
    name: localizeName(product.name, lang),
    nameI18n: localizedPair(product.name),
    description: localizeName(product.description, lang),
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
    optionGroups,
  };
}

function serializePublicGroup(relation, group, options, lang) {
  return {
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
    options,
  };
}

function serializePublicOption(relation, option, lang) {
  const extraPriceHalala = relation.extraPriceHalala === null || relation.extraPriceHalala === undefined
    ? Number(option.extraPriceHalala || 0)
    : Number(relation.extraPriceHalala || 0);
  const extraWeightPriceHalala = relation.extraWeightPriceHalala === null || relation.extraWeightPriceHalala === undefined
    ? Number(option.extraWeightPriceHalala || 0)
    : Number(relation.extraWeightPriceHalala || 0);
  return {
    id: String(option._id),
    optionId: String(option._id),
    groupId: String(option.groupId),
    key: option.key,
    name: localizeName(option.name, lang),
    nameI18n: localizedPair(option.name),
    imageUrl: option.imageUrl || "",
    extraPriceHalala,
    extraWeightUnitGrams: Number(option.extraWeightUnitGrams || 0),
    extraWeightPriceHalala,
    sortOrder: Number(relation.sortOrder || option.sortOrder || 0),
  };
}

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

async function hasPublishedMenuCatalog() {
  const count = await MenuProduct.countDocuments({ isActive: true, publishedAt: { $ne: null } });
  return count > 0;
}

async function getPublishedMenu({ lang = "en", branchId = "" } = {}) {
  const productQuery = { isActive: true, publishedAt: { $ne: null } };
  const categoryQuery = { isActive: true, publishedAt: { $ne: null } };
  if (branchId) {
    productQuery.$or = [{ branchAvailability: { $size: 0 } }, { branchAvailability: branchId }];
    categoryQuery.$or = [{ "availability.branchIds": { $size: 0 } }, { "availability.branchIds": branchId }];
  }

  const [categories, products, groupRelations, optionRelations, groups, options, vatPercentageRaw] = await Promise.all([
    MenuCategory.find(categoryQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuProduct.find(productQuery).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductOptionGroup.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    ProductGroupOption.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean(),
    MenuOptionGroup.find({ isActive: true, publishedAt: { $ne: null } }).lean(),
    MenuOption.find({ isActive: true, publishedAt: { $ne: null } }).lean(),
    getSettingValue("vat_percentage", 0),
  ]);

  const categoryIds = new Set(categories.map((category) => String(category._id)));
  const productsByCategory = new Map();
  const productsById = new Map(
    products
      .filter((product) => categoryIds.has(String(product.categoryId)))
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
    if (!product || !group) return;
    const optionRows = (optionRelationsByProductGroup.get(`${relation.productId}:${relation.groupId}`) || [])
      .map((optionRelation) => {
        const option = optionsById.get(String(optionRelation.optionId));
        if (!option || String(option.groupId) !== String(group._id)) return null;
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
    const categoryId = String(product.categoryId);
    if (!productsByCategory.has(categoryId)) productsByCategory.set(categoryId, []);
    const groupsForProduct = Array.isArray(product._publicGroups)
      ? product._publicGroups.sort((a, b) => a.sortOrder - b.sortOrder)
      : [];
    productsByCategory.get(categoryId).push(serializePublicProduct(product, lang, groupsForProduct));
  });

  const serializedCategories = categories
    .map((category) => {
      const rows = (productsByCategory.get(String(category._id)) || [])
        .sort((a, b) => a.sortOrder - b.sortOrder);
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

function buildListQuery({ includeInactive = false, isActive, q, published } = {}) {
  const query = {};
  if (isActive !== undefined && isActive !== null && String(isActive).trim() !== "") {
    query.isActive = normalizeBoolean(isActive, "isActive");
  } else if (!includeInactive) {
    query.isActive = true;
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

async function listModel(Model, options = {}, extraQuery = {}) {
  const rows = await Model.find({ ...buildListQuery(options), ...extraQuery })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  return rows.map(serializeDoc);
}

async function getModel(Model, id, extraQuery = {}) {
  assertObjectId(id);
  const row = await Model.findOne({ _id: id, ...extraQuery }).lean();
  if (!row) throw new MenuNotFoundError();
  return serializeDoc(row);
}

function normalizeCategoryPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  return {
    key: body.key === undefined && existing ? existing.key : normalizeKey(body.key),
    name: body.name === undefined && existing ? existing.name : localizedString(body.name, "name", { required: true }),
    description: optionalLocalizedString(body.description, "description") || (existing ? existing.description : { ar: "", en: "" }),
    imageUrl: body.imageUrl === undefined && existing ? existing.imageUrl : String(body.imageUrl || "").trim(),
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
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
    key: body.key === undefined && existing ? existing.key : normalizeKey(body.key),
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
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
    branchAvailability: (body.branchAvailability === undefined && body.branchIds === undefined && existing)
      ? (existing.branchAvailability || [])
      : normalizeStringArray(body.branchAvailability !== undefined ? body.branchAvailability : body.branchIds, "branchAvailability"),
  };
}

function normalizeGroupPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  return {
    key: body.key === undefined && existing ? existing.key : normalizeKey(body.key),
    name: body.name === undefined && existing ? existing.name : localizedString(body.name, "name", { required: true }),
    description: optionalLocalizedString(body.description, "description") || (existing ? existing.description : { ar: "", en: "" }),
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
  };
}

function normalizeOptionPayload(body = {}, existing = null) {
  if (!isPlainObject(body)) throw new MenuValidationError("Request body must be an object");
  return {
    groupId: body.groupId === undefined && existing ? existing.groupId : assertObjectId(body.groupId, "groupId"),
    key: body.key === undefined && existing ? existing.key : normalizeKey(body.key),
    name: body.name === undefined && existing ? existing.name : localizedString(body.name, "name", { required: true }),
    description: optionalLocalizedString(body.description, "description") || (existing ? existing.description : { ar: "", en: "" }),
    imageUrl: body.imageUrl === undefined && existing ? existing.imageUrl : String(body.imageUrl || "").trim(),
    extraPriceHalala: normalizeNonNegativeInteger(body.extraPriceHalala, "extraPriceHalala", existing ? existing.extraPriceHalala : 0),
    extraWeightUnitGrams: normalizeNonNegativeInteger(body.extraWeightUnitGrams, "extraWeightUnitGrams", existing ? existing.extraWeightUnitGrams : 0),
    extraWeightPriceHalala: normalizeNonNegativeInteger(body.extraWeightPriceHalala, "extraWeightPriceHalala", existing ? existing.extraWeightPriceHalala : 0),
    currency: SYSTEM_CURRENCY,
    isActive: normalizeBoolean(body.isActive, "isActive", existing ? existing.isActive : true),
    sortOrder: normalizeNonNegativeInteger(body.sortOrder, "sortOrder", existing ? existing.sortOrder : 0),
  };
}

async function createEntity(Model, payload, { entityType, actor }) {
  const row = await Model.create(payload);
  await writeMenuAudit({ entityType, entityId: row._id, action: "create", after: row.toObject(), actor });
  return serializeDoc(row);
}

async function updateEntity(Model, id, payload, { entityType, actor }) {
  assertObjectId(id);
  const row = await Model.findById(id);
  if (!row) throw new MenuNotFoundError();
  const before = row.toObject();
  row.set(payload);
  await row.save();
  await writeMenuAudit({ entityType, entityId: row._id, action: "update", before, after: row.toObject(), actor });
  return serializeDoc(row);
}

async function softDeleteEntity(Model, id, { entityType, actor }) {
  assertObjectId(id);
  const row = await Model.findById(id);
  if (!row) throw new MenuNotFoundError();
  const before = row.toObject();
  row.isActive = false;
  await row.save();
  await writeMenuAudit({ entityType, entityId: row._id, action: "soft_delete", before, after: row.toObject(), actor });
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

async function setProductGroups(productId, groups = [], actor = {}) {
  assertObjectId(productId, "productId");
  const product = await MenuProduct.findById(productId).lean();
  if (!product) throw new MenuNotFoundError("Product not found");
  if (!Array.isArray(groups)) throw new MenuValidationError("groups must be an array");
  const normalized = groups.map((item) => ({
    productId,
    groupId: assertObjectId(item.groupId || item.id, "groups[].groupId"),
    minSelections: normalizeNonNegativeInteger(item.minSelections, "groups[].minSelections", 0),
    maxSelections: normalizeNullableNonNegativeInteger(item.maxSelections, "groups[].maxSelections", null),
    isRequired: normalizeBoolean(item.isRequired, "groups[].isRequired", Number(item.minSelections || 0) > 0),
    isActive: normalizeBoolean(item.isActive, "groups[].isActive", true),
    sortOrder: normalizeNonNegativeInteger(item.sortOrder, "groups[].sortOrder", 0),
  }));
  const groupIds = normalized.map((item) => item.groupId);
  const found = await MenuOptionGroup.countDocuments({ _id: { $in: groupIds } });
  if (found !== groupIds.length) throw new MenuValidationError("One or more groups do not exist");
  await ProductOptionGroup.deleteMany({ productId });
  await ProductOptionGroup.insertMany(normalized);
  await writeMenuAudit({ entityType: "menu_product_group", entityId: productId, action: "replace", after: normalized, actor });
  return normalized;
}

async function setProductGroupOptions(productId, groupId, options = [], actor = {}) {
  assertObjectId(productId, "productId");
  assertObjectId(groupId, "groupId");
  if (!Array.isArray(options)) throw new MenuValidationError("options must be an array");
  const relation = await ProductOptionGroup.findOne({ productId, groupId }).lean();
  if (!relation) throw new MenuValidationError("Product group relation does not exist", "RELATION_NOT_FOUND", 404);
  const normalized = options.map((item) => ({
    productId,
    groupId,
    optionId: assertObjectId(item.optionId || item.id, "options[].optionId"),
    extraPriceHalala: normalizeNullableNonNegativeInteger(item.extraPriceHalala, "options[].extraPriceHalala", null),
    extraWeightPriceHalala: normalizeNullableNonNegativeInteger(item.extraWeightPriceHalala, "options[].extraWeightPriceHalala", null),
    isActive: normalizeBoolean(item.isActive, "options[].isActive", true),
    sortOrder: normalizeNonNegativeInteger(item.sortOrder, "options[].sortOrder", 0),
  }));
  const optionIds = normalized.map((item) => item.optionId);
  const found = await MenuOption.countDocuments({ _id: { $in: optionIds }, groupId });
  if (found !== optionIds.length) throw new MenuValidationError("One or more options do not belong to this group");
  await ProductGroupOption.deleteMany({ productId, groupId });
  await ProductGroupOption.insertMany(normalized);
  await writeMenuAudit({ entityType: "menu_product_group_option", entityId: productId, action: "replace", after: normalized, actor, meta: { groupId } });
  return normalized;
}

async function publishMenu({ actor = {}, notes = "" } = {}) {
  const publishedAt = new Date();
  await Promise.all([
    MenuCategory.updateMany({ isActive: true }, { $set: { publishedAt } }),
    MenuProduct.updateMany({ isActive: true }, { $set: { publishedAt } }),
    MenuOptionGroup.updateMany({ isActive: true }, { $set: { publishedAt } }),
    MenuOption.updateMany({ isActive: true }, { $set: { publishedAt } }),
  ]);
  const snapshot = await getPublishedMenu({ lang: "en" }).catch(() => ({}));
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

module.exports = {
  PRODUCT_ITEM_TYPES,
  MenuNotFoundError,
  MenuValidationError,
  getPublishedMenu,
  hasPublishedMenuCatalog,
  listCategories: (options) => listModel(MenuCategory, options),
  listProducts: (options) => listModel(MenuProduct, options),
  listOptionGroups: (options) => listModel(MenuOptionGroup, options),
  listOptions: (options) => listModel(MenuOption, options, options && options.groupId ? { groupId: assertObjectId(options.groupId, "groupId") } : {}),
  getCategory: (id) => getModel(MenuCategory, id),
  getProduct: (id) => getModel(MenuProduct, id),
  getOptionGroup: (id) => getModel(MenuOptionGroup, id),
  getOption: (id) => getModel(MenuOption, id),
  createCategory: (body, actor) => createEntity(MenuCategory, normalizeCategoryPayload(body), { entityType: "menu_category", actor }),
  createProduct: async (body, actor) => {
    const payload = normalizeProductPayload(body);
    const category = await MenuCategory.findOne({ _id: payload.categoryId, isActive: true }).lean();
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
    return createEntity(MenuProduct, payload, { entityType: "menu_product", actor });
  },
  createOptionGroup: (body, actor) => createEntity(MenuOptionGroup, normalizeGroupPayload(body), { entityType: "menu_option_group", actor }),
  createOption: (body, actor) => createEntity(MenuOption, normalizeOptionPayload(body), { entityType: "menu_option", actor }),
  updateCategory: async (id, body, actor) => {
    const existing = await MenuCategory.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    return updateEntity(MenuCategory, id, normalizeCategoryPayload(body, existing), { entityType: "menu_category", actor });
  },
  updateProduct: async (id, body, actor) => {
    const existing = await MenuProduct.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    const payload = normalizeProductPayload(body, existing);
    const category = await MenuCategory.findOne({ _id: payload.categoryId, isActive: true }).lean();
    if (!category) throw new MenuValidationError("categoryId does not reference an active category", "CATEGORY_NOT_FOUND", 404);
    return updateEntity(MenuProduct, id, payload, { entityType: "menu_product", actor });
  },
  updateOptionGroup: async (id, body, actor) => {
    const existing = await MenuOptionGroup.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    return updateEntity(MenuOptionGroup, id, normalizeGroupPayload(body, existing), { entityType: "menu_option_group", actor });
  },
  updateOption: async (id, body, actor) => {
    const existing = await MenuOption.findById(assertObjectId(id)).lean();
    if (!existing) throw new MenuNotFoundError();
    return updateEntity(MenuOption, id, normalizeOptionPayload(body, existing), { entityType: "menu_option", actor });
  },
  deleteCategory: (id, actor) => softDeleteEntity(MenuCategory, id, { entityType: "menu_category", actor }),
  deleteProduct: (id, actor) => softDeleteEntity(MenuProduct, id, { entityType: "menu_product", actor }),
  deleteOptionGroup: (id, actor) => softDeleteEntity(MenuOptionGroup, id, { entityType: "menu_option_group", actor }),
  deleteOption: (id, actor) => softDeleteEntity(MenuOption, id, { entityType: "menu_option", actor }),
  reorderCategories: (items, actor) => reorder(MenuCategory, items, { entityType: "menu_category", actor }),
  reorderProducts: (items, actor) => reorder(MenuProduct, items, { entityType: "menu_product", actor }),
  setProductGroups,
  setProductGroupOptions,
  publishMenu,
  listAuditLogs: async (options = {}) => {
    const rows = await MenuAuditLog.find({})
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, Number(options.limit || 50))))
      .lean();
    return rows.map(serializeDoc);
  },
};

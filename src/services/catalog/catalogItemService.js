const mongoose = require("mongoose");

const CatalogItem = require("../../models/CatalogItem");
const MenuCategory = require("../../models/MenuCategory");
const MenuOption = require("../../models/MenuOption");
const MenuProduct = require("../../models/MenuProduct");
const ProductGroupOption = require("../../models/ProductGroupOption");
const { generateUniqueKey } = require("./catalogKeyUiHelpers");

const ITEM_KINDS = Object.freeze([
  "product",
  "protein",
  "carb",
  "salad_ingredient",
  "sandwich",
  "addon",
  "drink",
  "dessert",
  "other",
]);

class CatalogItemError extends Error {
  constructor(message, code = "CATALOG_ITEM_ERROR", status = 400, details) {
    super(message);
    this.name = "CatalogItemError";
    this.code = code;
    this.status = status;
    this.messageAr = details && details.messageAr;
    if (details !== undefined) this.details = details;
  }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assertObjectId(value, fieldName = "id") {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw new CatalogItemError(`${fieldName} must be a valid ObjectId`, "INVALID_OBJECT_ID", 400);
  }
  return String(value);
}

function localizedString(value, fieldName, { required = false } = {}) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (required && !trimmed) throw new CatalogItemError(`${fieldName} is required`, "CATALOG_ITEM_VALIDATION_ERROR", 400);
    return { ar: "", en: trimmed };
  }
  if (isPlainObject(value)) {
    const ar = value.ar === undefined || value.ar === null ? "" : String(value.ar).trim();
    const en = value.en === undefined || value.en === null ? "" : String(value.en).trim();
    if (required && !ar && !en) throw new CatalogItemError(`${fieldName} is required`, "CATALOG_ITEM_VALIDATION_ERROR", 400);
    return { ar, en };
  }
  if (required) throw new CatalogItemError(`${fieldName} is required`, "CATALOG_ITEM_VALIDATION_ERROR", 400);
  return { ar: "", en: "" };
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  throw new CatalogItemError("Boolean field is invalid", "CATALOG_ITEM_VALIDATION_ERROR", 400);
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CatalogItemError("nutrition values must be numbers >= 0", "CATALOG_ITEM_VALIDATION_ERROR", 400);
  }
  return parsed;
}

function normalizeNutrition(value = {}, existing = {}) {
  const source = isPlainObject(value) ? value : {};
  const previous = isPlainObject(existing) ? existing : {};
  return {
    calories: normalizeNonNegativeNumber(source.calories, previous.calories || 0),
    proteinGrams: normalizeNonNegativeNumber(source.proteinGrams, previous.proteinGrams || 0),
    carbsGrams: normalizeNonNegativeNumber(source.carbsGrams, previous.carbsGrams || 0),
    fatGrams: normalizeNonNegativeNumber(source.fatGrams, previous.fatGrams || 0),
  };
}

function normalizeItemKind(value, fallback = "product") {
  const normalized = String(value || fallback || "product").trim();
  if (!ITEM_KINDS.includes(normalized)) {
    throw new CatalogItemError(`itemKind must be one of: ${ITEM_KINDS.join(", ")}`, "CATALOG_ITEM_VALIDATION_ERROR", 400);
  }
  return normalized;
}

function normalizePayload(body = {}, existing = null) {
  if (!isPlainObject(body)) {
    throw new CatalogItemError("Request body must be an object", "CATALOG_ITEM_VALIDATION_ERROR", 400);
  }
  if (existing && Object.prototype.hasOwnProperty.call(body, "key") && String(body.key || "").trim() !== existing.key) {
    throw new CatalogItemError("key is immutable", "IMMUTABLE_KEY", 400, { fieldName: "key" });
  }
  return {
    nameI18n: body.nameI18n === undefined && existing
      ? existing.nameI18n
      : localizedString(body.nameI18n || body.name, "nameI18n", { required: true }),
    descriptionI18n: body.descriptionI18n === undefined && body.description === undefined && existing
      ? existing.descriptionI18n
      : localizedString(body.descriptionI18n || body.description, "descriptionI18n"),
    imageUrl: body.imageUrl === undefined && existing ? existing.imageUrl : String(body.imageUrl || "").trim(),
    itemKind: normalizeItemKind(body.itemKind, existing ? existing.itemKind : "product"),
    nutrition: body.nutrition === undefined && existing
      ? normalizeNutrition(existing.nutrition)
      : normalizeNutrition(body.nutrition, existing && existing.nutrition),
    isActive: normalizeBoolean(body.isActive, existing ? existing.isActive : true),
    isAvailable: normalizeBoolean(body.isAvailable, existing ? existing.isAvailable : true),
  };
}

function serialize(row, counts = {}) {
  if (!row) return null;
  const obj = typeof row.toObject === "function" ? row.toObject() : { ...row };
  return {
    id: String(obj._id),
    key: obj.key,
    nameI18n: obj.nameI18n || { ar: "", en: "" },
    descriptionI18n: obj.descriptionI18n || { ar: "", en: "" },
    imageUrl: obj.imageUrl || "",
    itemKind: obj.itemKind || "product",
    nutrition: obj.nutrition || {},
    isActive: obj.isActive !== false,
    isAvailable: obj.isAvailable !== false,
    linkedProductsCount: Number(counts.linkedProductsCount || 0),
    linkedOptionsCount: Number(counts.linkedOptionsCount || 0),
    usageCount: Number(counts.usageCount || counts.linkedProductsCount || 0) + Number(counts.linkedOptionsCount || 0),
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

function buildListQuery(options = {}) {
  const query = {};
  if (options.itemKind) query.itemKind = String(options.itemKind).trim();
  if (options.isActive !== undefined && options.isActive !== null && String(options.isActive).trim() !== "") {
    query.isActive = normalizeBoolean(options.isActive);
  }
  if (options.isAvailable !== undefined && options.isAvailable !== null && String(options.isAvailable).trim() !== "") {
    query.isAvailable = normalizeBoolean(options.isAvailable);
  }
  const search = String(options.search || options.q || "").trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    query.$or = [{ key: regex }, { "nameI18n.ar": regex }, { "nameI18n.en": regex }];
  }
  return query;
}

async function countUsageForIds(ids) {
  const [productCounts, optionCounts] = await Promise.all([
    MenuProduct.aggregate([
      { $match: { catalogItemId: { $in: ids } } },
      { $group: { _id: "$catalogItemId", count: { $sum: 1 } } },
    ]),
    MenuOption.aggregate([
      { $match: { catalogItemId: { $in: ids } } },
      { $group: { _id: "$catalogItemId", count: { $sum: 1 } } },
    ]),
  ]);
  const map = new Map();
  for (const row of productCounts) {
    const key = String(row._id);
    map.set(key, { ...(map.get(key) || {}), linkedProductsCount: row.count });
  }
  for (const row of optionCounts) {
    const key = String(row._id);
    map.set(key, { ...(map.get(key) || {}), linkedOptionsCount: row.count });
  }
  return map;
}

async function listCatalogItems(options = {}) {
  const query = buildListQuery(options);
  const rows = await CatalogItem.find(query).sort({ itemKind: 1, key: 1, createdAt: -1 }).lean();
  const counts = await countUsageForIds(rows.map((row) => row._id));
  return rows.map((row) => serialize(row, counts.get(String(row._id))));
}

async function getCatalogItem(id) {
  assertObjectId(id);
  const row = await CatalogItem.findById(id).lean();
  if (!row) throw new CatalogItemError("CatalogItem not found", "CATALOG_ITEM_NOT_FOUND", 404);
  const [counts, linkedProducts, linkedOptions] = await Promise.all([
    countUsageForIds([row._id]),
    MenuProduct.find({ catalogItemId: row._id }).select("_id key name categoryId isActive isVisible isAvailable").lean(),
    MenuOption.find({ catalogItemId: row._id }).select("_id key name groupId isActive isVisible isAvailable").lean(),
  ]);
  const optionIds = linkedOptions.map((option) => option._id);
  const categoryIds = linkedProducts.map((product) => product.categoryId).filter(Boolean);
  const [productGroupOptions, categories] = await Promise.all([
    optionIds.length ? ProductGroupOption.find({ optionId: { $in: optionIds } }).select("_id productId groupId optionId isActive isVisible isAvailable").lean() : [],
    categoryIds.length ? MenuCategory.find({ _id: { $in: categoryIds } }).select("_id key name isActive isVisible isAvailable").lean() : [],
  ]);
  return {
    ...serialize(row, counts.get(String(row._id))),
    linkedProducts: linkedProducts.map((product) => ({ id: String(product._id), ...product, _id: undefined })),
    linkedOptions: linkedOptions.map((option) => ({ id: String(option._id), ...option, _id: undefined })),
    productGroupOptions: productGroupOptions.map((relation) => ({ id: String(relation._id), ...relation, _id: undefined })),
    categories: categories.map((category) => ({ id: String(category._id), ...category, _id: undefined })),
  };
}

async function createCatalogItem(body = {}) {
  const payload = normalizePayload(body);
  const key = await generateUniqueKey({
    name: payload.nameI18n,
    fallbackPrefix: payload.itemKind || "catalog_item",
    exists: (candidate) => CatalogItem.exists({ key: candidate }),
  });
  try {
    const row = await CatalogItem.create({ ...payload, key });
    return serialize(row);
  } catch (err) {
    if (err && err.code === 11000) {
      throw new CatalogItemError("CatalogItem key already exists", "CATALOG_ITEM_KEY_EXISTS", 409);
    }
    throw err;
  }
}

async function updateCatalogItem(id, body = {}) {
  assertObjectId(id);
  const row = await CatalogItem.findById(id);
  if (!row) throw new CatalogItemError("CatalogItem not found", "CATALOG_ITEM_NOT_FOUND", 404);
  const beforeKind = row.itemKind;
  const payload = normalizePayload(body, row.toObject());
  if (body.itemKind !== undefined && payload.itemKind !== beforeKind) {
    const usage = await countUsageForIds([row._id]);
    const counts = usage.get(String(row._id)) || {};
    if (Number(counts.linkedProductsCount || 0) + Number(counts.linkedOptionsCount || 0) > 0) {
      throw new CatalogItemError("Cannot change itemKind while CatalogItem is linked", "CATALOG_ITEM_IN_USE", 409);
    }
  }
  row.set(payload);
  try {
    await row.save();
    const counts = await countUsageForIds([row._id]);
    return serialize(row, counts.get(String(row._id)));
  } catch (err) {
    if (err && err.code === 11000) {
      throw new CatalogItemError("CatalogItem key already exists", "CATALOG_ITEM_KEY_EXISTS", 409);
    }
    throw err;
  }
}

module.exports = {
  CatalogItemError,
  createCatalogItem,
  getCatalogItem,
  listCatalogItems,
  updateCatalogItem,
};

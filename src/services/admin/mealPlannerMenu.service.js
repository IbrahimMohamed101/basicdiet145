const mongoose = require("mongoose");
const Addon = require("../../models/Addon");
const BuilderCarb = require("../../models/BuilderCarb");
const BuilderCategory = require("../../models/BuilderCategory");
const BuilderProtein = require("../../models/BuilderProtein");
const SaladIngredient = require("../../models/SaladIngredient");
const Sandwich = require("../../models/Sandwich");
const {
  MEAL_PLANNER_CATEGORY_DEFINITIONS,
  MEAL_SELECTION_TYPES,
  PROTEIN_FAMILY_KEYS,
  SALAD_INGREDIENT_GROUP_KEYS,
  STANDARD_CARB_CATEGORY_KEY,
  SYSTEM_CURRENCY,
} = require("../../config/mealPlannerContract");
const {
  invalidateMealPlannerCatalogCache,
} = require("../subscription/mealPlannerCatalogService");

const ADDON_CATEGORIES = Object.freeze(["juice", "snack", "small_salad"]);
const PROTEIN_DISPLAY_CATEGORY_KEYS = Object.freeze(["chicken", "beef", "fish", "eggs", "other", "premium"]);
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

class ValidationError extends Error {
  constructor(details) {
    super("Validation failed");
    this.name = "ValidationError";
    this.status = 400;
    this.details = Array.isArray(details) ? details : [String(details)];
  }
}

class NotFoundError extends Error {
  constructor() {
    super("Item not found");
    this.name = "NotFoundError";
    this.status = 404;
  }
}

function validateObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ValidationError("id is not a valid ObjectId");
  }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function localizedString(value, fieldName, { required = false } = {}) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (required && !trimmed) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return { ar: "", en: trimmed };
  }

  if (isPlainObject(value)) {
    const ar = value.ar === undefined || value.ar === null ? "" : String(value.ar).trim();
    const en = value.en === undefined || value.en === null ? "" : String(value.en).trim();
    if (required && !ar && !en) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return { ar, en };
  }

  if (required) {
    throw new ValidationError(`${fieldName} is required`);
  }
  return { ar: "", en: "" };
}

function optionalLocalizedString(value, fieldName) {
  if (value === undefined || value === null) return { ar: "", en: "" };
  return localizedString(value, fieldName);
}

function validateName(value) {
  return localizedString(value, "name", { required: true });
}

function validatePositiveNumber(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError(`${fieldName} must be a positive number`);
  }
  return parsed;
}

function validateNonNegativeNumber(value, fieldName, { defaultValue = 0 } = {}) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${fieldName} must be a number >= 0`);
  }
  return parsed;
}

function validateEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function normalizeKey(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed || undefined;
}

function normalizeRuleTags(value, defaultValue = []) {
  if (value === undefined || value === null) return defaultValue;
  if (!Array.isArray(value)) {
    throw new ValidationError("ruleTags must be an array");
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function serializeDoc(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  return {
    id: String(obj._id),
    ...obj,
  };
}

async function ensureBuilderCategory({ key, dimension }) {
  const definition = MEAL_PLANNER_CATEGORY_DEFINITIONS.find(
    (item) => item.key === key && item.dimension === dimension
  );
  if (!definition) {
    throw new ValidationError(`${dimension} category is not configured: ${key}`);
  }

  return BuilderCategory.findOneAndUpdate(
    { key, dimension },
    {
      $set: {
        name: definition.name,
        description: definition.description || { ar: "", en: "" },
        rules: definition.rules || {},
        sortOrder: definition.sortOrder,
        isActive: true,
      },
    },
    { upsert: true, new: true }
  );
}

async function assertUniquePremiumKey(premiumKey, excludeId) {
  const existing = await BuilderProtein.findOne({
    premiumKey,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).lean();

  if (existing) {
    throw new ValidationError("premiumKey must be unique");
  }
}

function normalizeProteinPayload(body, { premium, existing = null } = {}) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be an object");
  }

  const name = validateName(body.name);
  const description = optionalLocalizedString(body.description, "description");
  const sortOrder = validatePositiveNumber(body.sortOrder, "sortOrder");
  const proteinFamilyKey = validateEnum(String(body.proteinFamilyKey || "").trim(), PROTEIN_FAMILY_KEYS, "proteinFamilyKey");
  const selectionType = premium
    ? MEAL_SELECTION_TYPES.PREMIUM_MEAL
    : MEAL_SELECTION_TYPES.STANDARD_MEAL;

  if (body.selectionType !== undefined && body.selectionType !== selectionType) {
    throw new ValidationError(`selectionType must be ${selectionType}`);
  }

  const isPremium = premium;
  const displayCategoryKey = premium
    ? "premium"
    : validateEnum(normalizeKey(body.displayCategoryKey) || proteinFamilyKey, PROTEIN_DISPLAY_CATEGORY_KEYS.filter((key) => key !== "premium"), "displayCategoryKey");
  const ruleTags = normalizeRuleTags(body.ruleTags, premium ? ["premium"] : []);
  const extraFeeHalala = premium
    ? validatePositiveNumber(body.extraFeeHalala, "extraFeeHalala")
    : validateNonNegativeNumber(body.extraFeeHalala, "extraFeeHalala");

  let premiumKey = undefined;
  if (premium) {
    premiumKey = normalizeKey(body.premiumKey);
    if (!premiumKey) {
      throw new ValidationError("premiumKey is required if isPremium is true");
    }
    if (!SNAKE_CASE_PATTERN.test(premiumKey)) {
      throw new ValidationError("premiumKey must be a unique snake_case string");
    }
  } else if (body.premiumKey !== undefined && body.premiumKey !== null && String(body.premiumKey).trim()) {
    throw new ValidationError("premiumKey is only allowed for premium proteins");
  }

  return {
    key: normalizeKey(body.key) || existing?.key,
    name,
    description,
    displayCategoryKey,
    proteinFamilyKey,
    selectionType,
    isPremium,
    premiumKey,
    extraFeeHalala,
    currency: SYSTEM_CURRENCY,
    ruleTags,
    availableForSubscription: body.availableForSubscription === undefined ? true : Boolean(body.availableForSubscription),
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    sortOrder,
  };
}

function normalizeCarbPayload(body, { existing = null } = {}) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be an object");
  }
  return {
    key: normalizeKey(body.key) || existing?.key,
    name: validateName(body.name),
    description: optionalLocalizedString(body.description, "description"),
    displayCategoryKey: STANDARD_CARB_CATEGORY_KEY,
    availableForSubscription: body.availableForSubscription === undefined ? true : Boolean(body.availableForSubscription),
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    sortOrder: validatePositiveNumber(body.sortOrder, "sortOrder"),
  };
}

function normalizeSandwichPayload(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be an object");
  }
  if (body.selectionType !== undefined && body.selectionType !== MEAL_SELECTION_TYPES.SANDWICH) {
    throw new ValidationError(`selectionType must be ${MEAL_SELECTION_TYPES.SANDWICH}`);
  }

  return {
    name: validateName(body.name),
    description: optionalLocalizedString(body.description, "description"),
    imageUrl: body.imageUrl === undefined || body.imageUrl === null ? "" : String(body.imageUrl).trim(),
    calories: validateNonNegativeNumber(body.calories, "calories"),
    selectionType: MEAL_SELECTION_TYPES.SANDWICH,
    categoryKey: "sandwich",
    pricingModel: "included",
    priceHalala: 0,
    proteinFamilyKey: validateEnum(String(body.proteinFamilyKey || "").trim(), PROTEIN_FAMILY_KEYS, "proteinFamilyKey"),
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    sortOrder: validatePositiveNumber(body.sortOrder, "sortOrder"),
  };
}

function normalizeAddonPayload(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be an object");
  }
  const priceHalala = validateNonNegativeNumber(body.priceHalala, "priceHalala");
  const priceSar = priceHalala / 100;

  return {
    name: validateName(body.name),
    description: optionalLocalizedString(body.description, "description"),
    imageUrl: body.imageUrl === undefined || body.imageUrl === null ? "" : String(body.imageUrl).trim(),
    category: validateEnum(String(body.category || "").trim(), ADDON_CATEGORIES, "category"),
    priceHalala,
    priceSar,
    priceLabel: `${priceSar} SAR`,
    currency: SYSTEM_CURRENCY,
    type: "one_time",
    billingMode: "flat_once",
    pricingModel: "one_time",
    billingUnit: "item",
    kind: "item",
    price: priceSar,
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    sortOrder: validatePositiveNumber(body.sortOrder, "sortOrder"),
  };
}

function normalizeSaladIngredientPayload(body) {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be an object");
  }
  const groupKeys = Array.from(SALAD_INGREDIENT_GROUP_KEYS);
  return {
    groupKey: validateEnum(String(body.groupKey || "").trim(), groupKeys, "groupKey"),
    name: validateName(body.name),
    calories: validateNonNegativeNumber(body.calories, "calories"),
    price: validateNonNegativeNumber(body.price, "price"),
    maxQuantity: body.maxQuantity === undefined ? undefined : validatePositiveNumber(body.maxQuantity, "maxQuantity"),
    isActive: body.isActive === undefined ? true : Boolean(body.isActive),
    sortOrder: validatePositiveNumber(body.sortOrder, "sortOrder"),
  };
}

async function list(Model, query, includeInactive) {
  const rows = await Model.find(includeInactive ? query : { ...query, isActive: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  return rows.map(serializeDoc);
}

async function create(Model, payload) {
  const row = await Model.create(payload);
  await invalidateMealPlannerCatalogCache();
  return serializeDoc(row);
}

async function update(Model, id, payload) {
  validateObjectId(id);
  const row = await Model.findById(id);
  if (!row) {
    throw new NotFoundError();
  }
  row.set(payload);
  await row.save();
  await invalidateMealPlannerCatalogCache();
  return serializeDoc(row);
}

async function softDelete(Model, id) {
  validateObjectId(id);
  const row = await Model.findByIdAndUpdate(id, { $set: { isActive: false } }, { new: true });
  if (!row) {
    throw new NotFoundError();
  }
  await invalidateMealPlannerCatalogCache();
  return serializeDoc(row);
}

async function softDeleteWhere(Model, id, extraQuery) {
  validateObjectId(id);
  const row = await Model.findOneAndUpdate(
    { _id: id, ...extraQuery },
    { $set: { isActive: false } },
    { new: true }
  );
  if (!row) {
    throw new NotFoundError();
  }
  await invalidateMealPlannerCatalogCache();
  return serializeDoc(row);
}

async function listStandardProteins({ includeInactive = false } = {}) {
  return list(BuilderProtein, { isPremium: false }, includeInactive);
}

async function createStandardProtein(body) {
  const payload = normalizeProteinPayload(body, { premium: false });
  const category = await ensureBuilderCategory({ key: payload.displayCategoryKey, dimension: "protein" });
  return create(BuilderProtein, { ...payload, displayCategoryId: category._id });
}

async function updateStandardProtein(id, body) {
  validateObjectId(id);
  const existing = await BuilderProtein.findById(id);
  if (!existing || existing.isPremium) {
    throw new NotFoundError();
  }
  const payload = normalizeProteinPayload(body, { premium: false, existing });
  const category = await ensureBuilderCategory({ key: payload.displayCategoryKey, dimension: "protein" });
  return update(BuilderProtein, id, { ...payload, displayCategoryId: category._id });
}

async function listPremiumProteins({ includeInactive = false } = {}) {
  return list(BuilderProtein, { isPremium: true }, includeInactive);
}

async function createPremiumProtein(body) {
  const payload = normalizeProteinPayload(body, { premium: true });
  await assertUniquePremiumKey(payload.premiumKey);
  const category = await ensureBuilderCategory({ key: "premium", dimension: "protein" });
  return create(BuilderProtein, { ...payload, displayCategoryId: category._id });
}

async function updatePremiumProtein(id, body) {
  validateObjectId(id);
  const existing = await BuilderProtein.findById(id);
  if (!existing || !existing.isPremium) {
    throw new NotFoundError();
  }
  const payload = normalizeProteinPayload(body, { premium: true, existing });
  await assertUniquePremiumKey(payload.premiumKey, id);
  const category = await ensureBuilderCategory({ key: "premium", dimension: "protein" });
  return update(BuilderProtein, id, { ...payload, displayCategoryId: category._id });
}

async function listCarbs({ includeInactive = false } = {}) {
  return list(BuilderCarb, { displayCategoryKey: STANDARD_CARB_CATEGORY_KEY }, includeInactive);
}

async function createCarb(body) {
  const payload = normalizeCarbPayload(body);
  const category = await ensureBuilderCategory({ key: STANDARD_CARB_CATEGORY_KEY, dimension: "carb" });
  return create(BuilderCarb, { ...payload, displayCategoryId: category._id });
}

async function updateCarb(id, body) {
  validateObjectId(id);
  const existing = await BuilderCarb.findById(id);
  if (!existing || existing.displayCategoryKey !== STANDARD_CARB_CATEGORY_KEY) {
    throw new NotFoundError();
  }
  const payload = normalizeCarbPayload(body, { existing });
  const category = await ensureBuilderCategory({ key: STANDARD_CARB_CATEGORY_KEY, dimension: "carb" });
  return update(BuilderCarb, id, { ...payload, displayCategoryId: category._id });
}

module.exports = {
  ValidationError,
  NotFoundError,
  listStandardProteins,
  createStandardProtein,
  updateStandardProtein,
  deleteStandardProtein: (id) => softDeleteWhere(BuilderProtein, id, { isPremium: false }),
  listPremiumProteins,
  createPremiumProtein,
  updatePremiumProtein,
  deletePremiumProtein: (id) => softDeleteWhere(BuilderProtein, id, { isPremium: true }),
  listSandwiches: ({ includeInactive = false } = {}) => list(Sandwich, {}, includeInactive),
  createSandwich: (body) => create(Sandwich, normalizeSandwichPayload(body)),
  updateSandwich: (id, body) => update(Sandwich, id, normalizeSandwichPayload(body)),
  deleteSandwich: (id) => softDelete(Sandwich, id),
  listCarbs,
  createCarb,
  updateCarb,
  deleteCarb: (id) => softDeleteWhere(BuilderCarb, id, { displayCategoryKey: STANDARD_CARB_CATEGORY_KEY }),
  listAddons: ({ includeInactive = false } = {}) => list(Addon, { kind: "item", billingMode: "flat_once" }, includeInactive),
  createAddon: (body) => create(Addon, normalizeAddonPayload(body)),
  updateAddon: (id, body) => update(Addon, id, normalizeAddonPayload(body)),
  deleteAddon: (id) => softDelete(Addon, id),
  listSaladIngredients: ({ includeInactive = false } = {}) => list(SaladIngredient, {}, includeInactive),
  createSaladIngredient: (body) => create(SaladIngredient, normalizeSaladIngredientPayload(body)),
  updateSaladIngredient: (id, body) => update(SaladIngredient, id, normalizeSaladIngredientPayload(body)),
  deleteSaladIngredient: (id) => softDelete(SaladIngredient, id),
};

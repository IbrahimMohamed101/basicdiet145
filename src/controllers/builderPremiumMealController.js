const BuilderProtein = require("../models/BuilderProtein");
const BuilderCategory = require("../models/BuilderCategory");
const PremiumUpgradeConfig = require("../models/PremiumUpgradeConfig");
const MenuOption = require("../models/MenuOption");
const MenuProduct = require("../models/MenuProduct");
const { getRequestLang } = require("../utils/i18n");
const validateObjectId = require("../utils/validateObjectId");
const errorResponse = require("../utils/errorResponse");
const { resolveManagedImageFromRequest } = require("../services/adminImageService");
const { archiveDocument } = require("../services/catalog/catalogArchiveGuardService");
const {
  normalizeOptionalString,
  parseBooleanField,
  parseLocalizedFieldFromBody,
} = require("../utils/requestFields");
const {
  normalizeProteinFamilyKey: normalizeProteinFamilyKeyFromContract,
} = require("../config/mealPlannerContract");
const {
  listActiveReadyPremiumUpgradeConfigs,
  resolveConfigHealth,
} = require("../services/subscription/premiumUpgradeConfigService");

const SYSTEM_CURRENCY = "SAR";
const PREMIUM_MEAL_IMAGE_FOLDER = "premium-meals";
const ALLOWED_PROTEIN_FAMILIES = new Set(["chicken", "beef", "fish", "eggs", "other", "seafood"]);

const CUSTOM_PREMIUM_SALAD_KEY = "custom_premium_salad";
const SOURCE_TYPE_TO_KIND = Object.freeze({
  menu_option: "option",
  menu_product: "product",
});
const SOURCE_TYPE_TO_SOURCE_MODEL = Object.freeze({
  menu_option: "MenuOption",
  menu_product: "MenuProduct",
  builder_protein: "BuilderProtein",
});

function normalizePremiumKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLocalized(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ar: typeof value.ar === "string" ? value.ar : "",
      en: typeof value.en === "string" ? value.en : "",
    };
  }
  if (typeof value === "string") {
    return { ar: "", en: value };
  }
  return { ar: "", en: "" };
}

function localizedText(value, lang) {
  const localized = normalizeLocalized(value);
  return localized[lang] || localized.en || localized.ar || "";
}

function normalizeNutritionForDto(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    calories: Number(source.calories || 0),
    proteinGrams: Number(source.proteinGrams || 0),
    carbGrams: Number(source.carbGrams || 0),
    fatGrams: Number(source.fatGrams || 0),
  };
}

function buildConfigPremiumMealEntry(config, sourceDoc, { health = null, lang = "en", diagnostics = null } = {}) {
  const configId = String(config._id);
  const sourceId = config.sourceId ? String(config.sourceId) : (sourceDoc?._id ? String(sourceDoc._id) : "");
  const sourceType = String(config.sourceType || "");
  const kind = SOURCE_TYPE_TO_KIND[sourceType] || "";
  const sourceName = normalizeLocalized(sourceDoc?.name || config.sourceSnapshot?.name);
  const sourceDescription = normalizeLocalized(sourceDoc?.description || config.sourceSnapshot?.description);
  const premiumKey = normalizePremiumKey(config.premiumKey || sourceDoc?.premiumKey || sourceDoc?.key);
  const priceHalala = Number(config.upgradeDeltaHalala || 0);
  const currency = String(config.currency || SYSTEM_CURRENCY).toUpperCase();
  const isReady = (health?.status || "ready") === "ready";
  const entry = {
    _id: configId,
    id: configId,
    configId,
    revision: Number(config.revision || 0),
    sourceId,
    sourceModel: SOURCE_TYPE_TO_SOURCE_MODEL[sourceType] || "",
    sourceType,
    kind,
    selectionType: config.selectionType || (sourceType === "menu_product" ? "premium_large_salad" : "premium_meal"),
    premiumKey,
    key: premiumKey,
    name: sourceName,
    description: sourceDescription,
    imageUrl: String(sourceDoc?.imageUrl || config.sourceSnapshot?.context?.imageUrl || ""),
    nutrition: normalizeNutritionForDto(sourceDoc?.nutrition),
    extraFeeHalala: priceHalala,
    priceHalala,
    extraFeeSar: priceHalala / 100,
    priceSar: priceHalala / 100,
    priceLabel: `${priceHalala / 100} ${currency}`,
    currency,
    isPremium: true,
    isActive: isReady,
    availableForSubscription: isReady,
    sortOrder: Number(config.sortOrder || 0),
    health: health?.status || "ready",
    issueCode: health?.code || null,
    managementSource: "premium_upgrade_config",
    legacy: false,
    type: config.selectionType || "",
    sourceKey: sourceDoc?.key || sourceDoc?.premiumKey || config.sourceSnapshot?.key || premiumKey,
    sourceName,
    sourceProductId: config.sourceProductId ? String(config.sourceProductId) : (sourceType === "menu_product" ? sourceId : null),
    sourceGroupId: config.sourceGroupId ? String(config.sourceGroupId) : null,
    sourceGroupKey: config.sourceSnapshot?.context?.groupKey || null,
    sourceProductKey: config.sourceSnapshot?.context?.productKey || (sourceType === "menu_product" ? (sourceDoc?.key || premiumKey) : null),
    ui: {
      title: localizedText(sourceName, lang),
      subtitle: localizedText(sourceDescription, lang),
      ctaLabel: "Select",
      selectionStyle: sourceType === "menu_product" ? "builder" : "option",
    },
  };

  if (entry.selectionType === "premium_large_salad") {
    entry.legacyAliases = [CUSTOM_PREMIUM_SALAD_KEY];
  }
  if (diagnostics) {
    entry.diagnostics = diagnostics;
  }
  return entry;
}

function buildLegacyPremiumMealEntry(row) {
  const id = String(row._id);
  const premiumKey = normalizePremiumKey(row.premiumKey || row.key || id);
  const priceHalala = Number(row.extraFeeHalala || 0);
  const currency = String(row.currency || SYSTEM_CURRENCY).toUpperCase();
  return {
    ...row,
    _id: id,
    id,
    configId: null,
    revision: 0,
    sourceId: id,
    sourceModel: SOURCE_TYPE_TO_SOURCE_MODEL.builder_protein,
    sourceType: "builder_protein",
    kind: "option",
    selectionType: row.selectionType || "premium_meal",
    premiumKey,
    key: premiumKey,
    name: normalizeLocalized(row.name),
    description: normalizeLocalized(row.description),
    imageUrl: row.imageUrl || "",
    nutrition: normalizeNutritionForDto(row.nutrition),
    extraFeeHalala: priceHalala,
    priceHalala,
    extraFeeSar: priceHalala / 100,
    priceSar: priceHalala / 100,
    priceLabel: `${priceHalala / 100} ${currency}`,
    currency,
    isPremium: true,
    isActive: row.isActive !== false,
    availableForSubscription: row.availableForSubscription !== false,
    sortOrder: Number(row.sortOrder || 0),
    health: "ready",
    managementSource: "legacy_builder_protein",
    legacy: true,
    displayCategoryId: row.displayCategoryId ? String(row.displayCategoryId) : null,
  };
}

async function buildUnifiedPremiumMealRows({ includeLegacy = true, lang = "en" } = {}) {
  const readyRows = await listActiveReadyPremiumUpgradeConfigs();
  const mapped = [];
  const handledKeys = new Set();
  const handledSources = new Set();

  for (const { config, sourceDoc, health } of readyRows) {
    const premiumKey = normalizePremiumKey(config.premiumKey);
    const sourceIdentity = `${config.sourceType}:${String(config.sourceId || "")}`;
    if (!premiumKey || handledKeys.has(premiumKey) || handledSources.has(sourceIdentity)) continue;
    mapped.push(buildConfigPremiumMealEntry(config, sourceDoc, { health, lang }));
    handledKeys.add(premiumKey);
    handledSources.add(sourceIdentity);
  }

  if (!includeLegacy) return mapped;

  const legacyRows = await BuilderProtein.find({
    isPremium: true,
    isActive: true,
    isArchived: { $ne: true },
    availableForSubscription: { $ne: false },
  }).sort({ sortOrder: 1, createdAt: -1 }).lean();

  for (const row of legacyRows) {
    const legacyKey = normalizePremiumKey(row.premiumKey || row.key);
    const sourceIdentity = `builder_protein:${String(row._id)}`;
    if ((legacyKey && handledKeys.has(legacyKey)) || handledSources.has(sourceIdentity)) continue;
    mapped.push(buildLegacyPremiumMealEntry(row));
    if (legacyKey) handledKeys.add(legacyKey);
    handledSources.add(sourceIdentity);
  }

  return mapped.sort((left, right) => {
    const bySort = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    if (bySort !== 0) return bySort;
    return String(left.key || "").localeCompare(String(right.key || ""));
  });
}

async function loadConfigSource(config) {
  if (!config) return null;
  if (config.sourceType === "menu_option") {
    return MenuOption.findById(config.sourceId).lean();
  }
  if (config.sourceType === "menu_product") {
    return MenuProduct.findById(config.sourceId).lean();
  }
  return null;
}

async function findConfigBackedRowByIdOrSourceId(id, { lang = "en" } = {}) {
  let config = await PremiumUpgradeConfig.findById(id).lean();
  if (!config) {
    const configsBySource = await PremiumUpgradeConfig.find({
      sourceId: id,
      status: "active",
      isEnabled: true,
      isVisible: true,
    }).lean();
    if (configsBySource.length === 1) {
      config = configsBySource[0];
    } else if (configsBySource.length > 1) {
      const err = new Error("Premium source id matches multiple configured upgrades");
      err.status = 409;
      err.code = "AMBIGUOUS_PREMIUM_SOURCE";
      throw err;
    }
  }
  if (!config) return null;

  const sourceDoc = await loadConfigSource(config);
  const health = await resolveConfigHealth(config, { sourceDoc });
  const isSelectable = config.status === "active"
    && config.isEnabled === true
    && config.isVisible === true
    && health.status === "ready";
  if (!isSelectable) return null;
  return buildConfigPremiumMealEntry(config, sourceDoc, {
    health,
    lang,
    diagnostics: { resolvedBy: String(config._id) === String(id) ? "config_id" : "source_id" },
  });
}

async function rejectConfigBackedMutationIfNeeded(id, res) {
  const exists = await PremiumUpgradeConfig.exists({ _id: id });
  if (!exists) return false;
  errorResponse(
    res,
    409,
    "UNSUPPORTED_CONFIG_BACKED_ROW",
    "This premium meal is managed by PremiumUpgradeConfig; use the premium upgrade management API for config-backed rows"
  );
  return true;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeLocalizedRequired(input, fieldName) {
  const parsed = parseLocalizedFieldFromBody(input, fieldName, { allowString: true })
    ?? input[fieldName];

  if (typeof parsed === "string") {
    const en = parsed.trim();
    if (!en) {
      throw { status: 400, code: "INVALID", message: `${fieldName} must have at least one non-empty value in ar or en` };
    }
    return { ar: "", en };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an object with ar/en or a non-empty string` };
  }

  const ar = parsed.ar === undefined || parsed.ar === null ? "" : String(parsed.ar).trim();
  const en = parsed.en === undefined || parsed.en === null ? "" : String(parsed.en).trim();
  if (!ar && !en) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must have at least one non-empty value in ar or en` };
  }
  return { ar, en };
}

function normalizeLocalizedOptional(input, fieldName) {
  const parsed = parseLocalizedFieldFromBody(input, fieldName, { allowString: true })
    ?? input[fieldName];

  if (parsed === undefined || parsed === null) {
    return { ar: "", en: "" };
  }

  if (typeof parsed === "string") {
    return { ar: "", en: parsed.trim() };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an object with ar/en or a string` };
  }

  return {
    ar: parsed.ar === undefined || parsed.ar === null ? "" : String(parsed.ar).trim(),
    en: parsed.en === undefined || parsed.en === null ? "" : String(parsed.en).trim(),
  };
}

function normalizeSortOrder(value, fieldName = "sortOrder") {
  const parsed = Number(value);
  if (!isNonNegativeInteger(parsed)) {
    throw { status: 400, code: "INVALID", message: `${fieldName} must be an integer >= 0` };
  }
  return parsed;
}

function normalizeProteinFamilyKey(value) {
  const normalized = normalizeProteinFamilyKeyFromContract(normalizeOptionalString(value).toLowerCase());
  if (!ALLOWED_PROTEIN_FAMILIES.has(normalized)) {
    throw { status: 400, code: "INVALID", message: "proteinFamilyKey must be one of: chicken, beef, fish, eggs, other" };
  }
  return normalized;
}

function normalizeRuleTags(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  let tags = value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      tags = parsed;
    } catch (_err) {
      tags = value.split(",");
    }
  }

  if (!Array.isArray(tags)) {
    throw { status: 400, code: "INVALID", message: "ruleTags must be an array of strings" };
  }

  return tags
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeNutrition(payload) {
  const source = payload && payload.nutrition && typeof payload.nutrition === "object"
    ? payload.nutrition
    : payload || {};

  const calories = Number(source.calories ?? 0);
  const proteinGrams = Number(source.proteinGrams ?? 0);
  const carbGrams = Number(source.carbGrams ?? 0);
  const fatGrams = Number(source.fatGrams ?? 0);

  const values = { calories, proteinGrams, carbGrams, fatGrams };
  for (const [key, raw] of Object.entries(values)) {
    if (!Number.isFinite(raw) || raw < 0) {
      throw { status: 400, code: "INVALID", message: `${key} must be a number >= 0` };
    }
  }

  return values;
}

async function resolveValidatedDisplayCategory(input) {
  const id = normalizeOptionalString(input);
  if (!id) {
    throw { status: 400, code: "INVALID", message: "displayCategoryId is required" };
  }
  validateObjectId(id, "displayCategoryId");

  const category = await BuilderCategory.findById(id).lean();
  if (!category) {
    throw { status: 400, code: "INVALID_CATEGORY", message: "Builder category not found" };
  }
  if (category.dimension !== "protein") {
    throw { status: 400, code: "INVALID_CATEGORY", message: "displayCategoryId must reference a protein builder category" };
  }

  return {
    displayCategoryId: String(category._id),
    displayCategoryKey: String(category.key || "").trim().toLowerCase(),
  };
}

async function validatePremiumMealPayloadOrThrow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw { status: 400, code: "INVALID", message: "Request body must be an object" };
  }

  const name = normalizeLocalizedRequired(payload, "name");
  const description = normalizeLocalizedOptional(payload, "description");
  const { displayCategoryId, displayCategoryKey } = await resolveValidatedDisplayCategory(payload.displayCategoryId);
  const proteinFamilyKey = normalizeProteinFamilyKey(payload.proteinFamilyKey);
  const currency = payload.currency === undefined ? SYSTEM_CURRENCY : normalizeOptionalString(payload.currency).toUpperCase();
  if (!currency) {
    throw { status: 400, code: "INVALID", message: "currency must be a non-empty string" };
  }
  if (currency !== SYSTEM_CURRENCY) {
    throw { status: 400, code: "INVALID", message: `currency must be ${SYSTEM_CURRENCY}` };
  }

  const premiumCreditCost = Number(payload.premiumCreditCost ?? 0);
  if (!isNonNegativeInteger(premiumCreditCost)) {
    throw { status: 400, code: "INVALID", message: "premiumCreditCost must be an integer >= 0" };
  }

  const extraFeeHalala = Number(payload.extraFeeHalala ?? 0);
  if (!isNonNegativeInteger(extraFeeHalala)) {
    throw { status: 400, code: "INVALID", message: "extraFeeHalala must be an integer >= 0" };
  }

  const availableForSubscription = parseBooleanField(
    payload.availableForSubscription,
    "availableForSubscription",
    { defaultValue: true }
  );
  const isActive = parseBooleanField(payload.isActive, "isActive", { defaultValue: true });
  const sortOrder = payload.sortOrder === undefined ? 0 : normalizeSortOrder(payload.sortOrder, "sortOrder");
  const ruleTags = normalizeRuleTags(payload.ruleTags);
  const nutrition = normalizeNutrition(payload);

  return {
    name,
    description,
    displayCategoryId,
    displayCategoryKey,
    proteinFamilyKey,
    ruleTags,
    isPremium: true,
    premiumCreditCost,
    extraFeeHalala,
    currency,
    availableForSubscription,
    isActive,
    sortOrder,
    nutrition,
  };
}

async function listBuilderPremiumMeals(req, res) {
  const lang = getRequestLang(req);
  const data = await buildUnifiedPremiumMealRows({ includeLegacy: true, lang });
  return res.status(200).json({ status: true, data });
}

async function listBuilderPremiumMealsAdmin(req, res) {
  const lang = getRequestLang(req);
  const data = await buildUnifiedPremiumMealRows({ includeLegacy: true, lang });
  return res.status(200).json({
    status: true,
    data,
  });
}

async function getBuilderPremiumMealAdmin(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  let configBackedRow;
  try {
    configBackedRow = await findConfigBackedRowByIdOrSourceId(id, { lang: getRequestLang(req) });
  } catch (err) {
    return errorResponse(res, err.status || 500, err.code || "ERROR", err.message);
  }
  if (configBackedRow) {
    return res.status(200).json({ status: true, data: configBackedRow });
  }

  const row = await BuilderProtein.findOne({ _id: id, isPremium: true }).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }

  return res.status(200).json({
    status: true,
    data: {
      ...buildLegacyPremiumMealEntry(row),
      diagnostics: { resolvedBy: "legacy_builder_protein_id" },
    },
  });
}

async function createBuilderPremiumMeal(req, res) {
  try {
    const payload = await validatePremiumMealPayloadOrThrow(req.body || {});
    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: PREMIUM_MEAL_IMAGE_FOLDER,
    });

    const row = await BuilderProtein.create({
      ...payload,
      imageUrl: imageState.imageUrl,
    });

    return res.status(201).json({ status: true, data: { id: row.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    throw err;
  }
}

async function updateBuilderPremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    if (await rejectConfigBackedMutationIfNeeded(id, res)) return;
    const payload = await validatePremiumMealPayloadOrThrow(req.body || {});
    const existing = await BuilderProtein.findOne({ _id: id, isPremium: true });
    if (!existing) {
      return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
    }

    const imageState = await resolveManagedImageFromRequest({
      body: req.body,
      file: req.file,
      folder: PREMIUM_MEAL_IMAGE_FOLDER,
      currentImageUrl: existing.imageUrl,
    });

    existing.set({
      ...payload,
      imageUrl: imageState.imageUrl,
      isPremium: true,
    });
    await existing.save();

    return res.status(200).json({ status: true, data: { id: existing.id } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message, err.details);
    }
    throw err;
  }
}

async function deleteBuilderPremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  if (await rejectConfigBackedMutationIfNeeded(id, res)) return;
  const row = await BuilderProtein.findOne({ _id: id, isPremium: true });
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }
  await archiveDocument(row);
  return res.status(200).json({ status: true, data: { id: row.id, isActive: false, isArchived: true, archivedAt: row.archivedAt } });
}

async function toggleBuilderPremiumMealActive(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  if (await rejectConfigBackedMutationIfNeeded(id, res)) return;
  const row = await BuilderProtein.findOne({ _id: id, isPremium: true });
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }

  row.isActive = !row.isActive;
  await row.save();

  return res.status(200).json({ status: true, data: { id: row.id, isActive: row.isActive } });
}

async function updateBuilderPremiumMealSortOrder(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  try {
    if (await rejectConfigBackedMutationIfNeeded(id, res)) return;
    const sortOrder = normalizeSortOrder(req.body && req.body.sortOrder, "sortOrder");
    const row = await BuilderProtein.findOneAndUpdate(
      { _id: id, isPremium: true },
      { sortOrder },
      { new: true, runValidators: true }
    );
    if (!row) {
      return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
    }
    return res.status(200).json({ status: true, data: { id: row.id, sortOrder: row.sortOrder } });
  } catch (err) {
    if (err && err.status) {
      return errorResponse(res, err.status, err.code, err.message);
    }
    throw err;
  }
}

async function cloneBuilderPremiumMeal(req, res) {
  const { id } = req.params;
  try {
    validateObjectId(id, "id");
  } catch (err) {
    return errorResponse(res, err.status, err.code, err.message);
  }

  if (await rejectConfigBackedMutationIfNeeded(id, res)) return;
  const row = await BuilderProtein.findOne({ _id: id, isPremium: true }).lean();
  if (!row) {
    return errorResponse(res, 404, "NOT_FOUND", "Premium meal not found");
  }

  const cloned = await BuilderProtein.create({
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl || "",
    displayCategoryId: row.displayCategoryId,
    displayCategoryKey: row.displayCategoryKey,
    proteinFamilyKey: row.proteinFamilyKey,
    ruleTags: Array.isArray(row.ruleTags) ? row.ruleTags : [],
    isPremium: true,
    premiumCreditCost: Number(row.premiumCreditCost || 0),
    extraFeeHalala: Number(row.extraFeeHalala || 0),
    currency: row.currency || SYSTEM_CURRENCY,
    availableForSubscription: row.availableForSubscription !== false,
    isActive: row.isActive !== false,
    sortOrder: Number(row.sortOrder || 0),
    nutrition: row.nutrition || {},
  });

  return res.status(201).json({ status: true, data: { id: cloned.id } });
}

module.exports = {
  listBuilderPremiumMeals,
  listBuilderPremiumMealsAdmin,
  getBuilderPremiumMealAdmin,
  createBuilderPremiumMeal,
  updateBuilderPremiumMeal,
  deleteBuilderPremiumMeal,
  toggleBuilderPremiumMealActive,
  updateBuilderPremiumMealSortOrder,
  cloneBuilderPremiumMeal,
  validatePremiumMealPayloadOrThrow,
};

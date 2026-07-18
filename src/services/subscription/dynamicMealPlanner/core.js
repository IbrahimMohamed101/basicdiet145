const crypto = require("crypto");
const { pickLang } = require("../../../utils/i18n");
const { isLinkedDocGloballyAvailable } = require("../../catalog/catalogAvailabilityService");
const {
  CONTRACT_VERSION,
  SYSTEM_CURRENCY,
  SECTION_TYPES,
  SOURCE_KINDS,
  MAX_SECTIONS,
  MAX_PICKER_LIMIT,
  DynamicMealPlannerError,
} = require("./constants");

function stringId(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function uniqueIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(stringId).filter(Boolean))];
}

function localized(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ar: "", en: "" };
  return { ar: String(value.ar || "").trim(), en: String(value.en || "").trim() };
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function slugify(value, fallback = "section") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new DynamicMealPlannerError(
      "Meal Planner numeric fields must be integers greater than or equal to zero",
      "MEAL_PLANNER_INVALID_NUMBER",
      400,
      { value }
    );
  }
  return parsed;
}

function nullableNonNegativeInteger(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  return nonNegativeInteger(value, 0);
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return fallback;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    output[key] = canonicalize(value[key]);
  }
  return output;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function isPremiumDynamicSection(section = {}) {
  return section.sourceKind === "premium_visual"
    || section.metadata?.premiumDynamic === true
    || String(section.key || "").toLowerCase() === "premium";
}

function normalizeSection(section = {}, index = 0) {
  const titleOverride = localized(section.titleOverride || section.title || section.nameI18n || {});
  const key = slugify(section.key || section.sectionKey || titleOverride.en || titleOverride.ar, `section_${index + 1}`);
  const premiumDynamic = isPremiumDynamicSection({ ...section, key });
  const sectionType = String(section.sectionType || section.type || "product_list").trim();
  if (!SECTION_TYPES.has(sectionType)) {
    throw new DynamicMealPlannerError("Unsupported Meal Planner section type", "MEAL_PLANNER_INVALID_SECTION_TYPE", 400, { sectionType, index });
  }
  let sourceKind = String(section.sourceKind || section.source?.kind || "").trim();
  if (!sourceKind) sourceKind = premiumDynamic ? "premium_visual" : (sectionType === "option_group" ? "visual_family" : "product_list");
  if (!SOURCE_KINDS.has(sourceKind)) {
    throw new DynamicMealPlannerError("Unsupported Meal Planner source kind", "MEAL_PLANNER_INVALID_SOURCE_KIND", 400, { sourceKind, index });
  }
  const includeMode = String(section.includeMode || "selected").trim();
  if (!new Set(["all", "selected"]).has(includeMode)) {
    throw new DynamicMealPlannerError("Unsupported Meal Planner include mode", "MEAL_PLANNER_INVALID_INCLUDE_MODE", 400, { includeMode, index });
  }

  const normalized = {
    key,
    sectionType,
    sourceKind,
    titleOverride,
    productContextId: stringId(section.productContextId),
    sourceGroupId: stringId(section.sourceGroupId),
    sourceCategoryId: stringId(section.sourceCategoryId),
    selectedOptionIds: uniqueIds(section.selectedOptionIds || section.optionIds),
    selectedProductIds: uniqueIds(section.selectedProductIds || section.productIds),
    includeMode,
    selectionType: String(section.selectionType || "").trim(),
    sortOrder: nonNegativeInteger(section.sortOrder, (index + 1) * 10),
    required: normalizeBoolean(section.required ?? section.isRequired, false),
    minSelections: nonNegativeInteger(section.minSelections, 0),
    maxSelections: nullableNonNegativeInteger(section.maxSelections, null),
    multiSelect: normalizeBoolean(section.multiSelect, false),
    visible: normalizeBoolean(section.visible, true),
    availableFor: ["subscription"],
    metadata: {
      ...plainObject(section.metadata),
      ...(premiumDynamic ? { premiumDynamic: true, managedBy: "premium_upgrades" } : {}),
    },
    rules: plainObject(section.rules),
  };

  if (normalized.maxSelections !== null && normalized.maxSelections < normalized.minSelections) {
    throw new DynamicMealPlannerError("maxSelections cannot be lower than minSelections", "MEAL_PLANNER_INVALID_SELECTION_RULE", 400, { index, key });
  }
  if (sectionType === "option_group" && (!normalized.productContextId || !normalized.sourceGroupId)) {
    throw new DynamicMealPlannerError("option_group sections require productContextId and sourceGroupId", "MEAL_PLANNER_SECTION_REFERENCE_REQUIRED", 400, { index, key });
  }
  if (sectionType === "product_category" && includeMode === "all" && !normalized.sourceCategoryId) {
    throw new DynamicMealPlannerError("product_category sections using includeMode=all require sourceCategoryId", "MEAL_PLANNER_SECTION_REFERENCE_REQUIRED", 400, { index, key });
  }
  return normalized;
}

function normalizeSections(sections = []) {
  if (!Array.isArray(sections)) throw new DynamicMealPlannerError("sections must be an array", "MEAL_PLANNER_INVALID_SECTIONS", 400);
  if (sections.length > MAX_SECTIONS) {
    throw new DynamicMealPlannerError(`Meal Planner supports at most ${MAX_SECTIONS} sections`, "MEAL_PLANNER_TOO_MANY_SECTIONS", 400);
  }
  const normalized = sections.map(normalizeSection).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  const seen = new Set();
  for (const section of normalized) {
    if (seen.has(section.key)) {
      throw new DynamicMealPlannerError("Meal Planner section keys must be unique", "MEAL_PLANNER_DUPLICATE_SECTION_KEY", 409, { sectionKey: section.key });
    }
    seen.add(section.key);
  }
  return normalized;
}

function sectionForHash(section) {
  return {
    key: section.key,
    sectionType: section.sectionType,
    sourceKind: section.sourceKind,
    titleOverride: localized(section.titleOverride),
    productContextId: stringId(section.productContextId),
    sourceGroupId: stringId(section.sourceGroupId),
    sourceCategoryId: stringId(section.sourceCategoryId),
    selectedOptionIds: uniqueIds(section.selectedOptionIds),
    selectedProductIds: uniqueIds(section.selectedProductIds),
    includeMode: section.includeMode || "selected",
    selectionType: section.selectionType || "",
    sortOrder: Number(section.sortOrder || 0),
    required: section.required === true,
    minSelections: Number(section.minSelections || 0),
    maxSelections: section.maxSelections === null || section.maxSelections === undefined ? null : Number(section.maxSelections),
    multiSelect: section.multiSelect === true,
    visible: section.visible !== false,
    metadata: plainObject(section.metadata),
    rules: plainObject(section.rules),
  };
}

function draftHashForSections(sections = []) {
  return stableHash({ contractVersion: CONTRACT_VERSION, sections: normalizeSections(sections).map(sectionForHash) });
}

function serializeConfig(config) {
  if (!config) return null;
  const raw = typeof config.toObject === "function" ? config.toObject() : { ...config };
  const sections = normalizeSections(raw.sections || []).map(sectionForHash);
  return {
    id: stringId(raw._id),
    status: raw.status || "draft",
    isCurrent: raw.isCurrent !== false,
    contractVersion: CONTRACT_VERSION,
    versionNumber: Number(raw.versionNumber || 0),
    basedOnPublishedVersionId: stringId(raw.basedOnPublishedVersionId),
    revisionHash: raw.revisionHash || "",
    draftHash: draftHashForSections(sections),
    source: raw.source || "dashboard",
    createdBySystem: raw.createdBySystem === true,
    bootstrapKey: raw.bootstrapKey || "",
    notes: raw.notes || "",
    publishedAt: raw.publishedAt || null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    sections,
  };
}

function subscriptionEnabled(doc = {}) {
  const channels = Array.isArray(doc.availableFor) ? doc.availableFor : [];
  if (doc.availableForSubscription === false) return false;
  return channels.length === 0 || channels.includes("subscription");
}

function eligibilityForDoc(doc, catalogItemsById = new Map(), prefix = "PRODUCT") {
  const reasons = [];
  if (!doc) return { eligible: false, reasons: [`${prefix}_NOT_FOUND`] };
  if (doc.isActive === false) reasons.push(`${prefix}_INACTIVE`);
  if (doc.isVisible === false) reasons.push(`${prefix}_HIDDEN`);
  if (doc.isAvailable === false) reasons.push(`${prefix}_UNAVAILABLE`);
  if (!doc.publishedAt) reasons.push(`${prefix}_UNPUBLISHED`);
  if (!subscriptionEnabled(doc)) reasons.push(`${prefix}_SUBSCRIPTION_DISABLED`);
  if (!isLinkedDocGloballyAvailable(doc, catalogItemsById)) reasons.push(`${prefix}_CATALOG_ITEM_UNAVAILABLE`);
  return { eligible: reasons.length === 0, reasons };
}

function relationUsable(doc) {
  return Boolean(doc) && doc.isActive !== false && doc.isVisible !== false && doc.isAvailable !== false;
}

function localizedName(value, lang) {
  return pickLang(value || {}, lang) || pickLang(value || {}, "ar") || pickLang(value || {}, "en") || "";
}

function pricingForProduct(product = {}) {
  return {
    model: product.pricingModel || "fixed",
    priceHalala: Number(product.priceHalala || 0),
    currency: product.currency || SYSTEM_CURRENCY,
    weight: {
      enabled: product.pricingModel === "per_100g",
      baseUnitGrams: Number(product.baseUnitGrams || 100),
      defaultWeightGrams: Number(product.defaultWeightGrams || 0),
      minWeightGrams: Number(product.minWeightGrams || 0),
      maxWeightGrams: Number(product.maxWeightGrams || 0),
      stepGrams: Number(product.weightStepGrams || 50),
      stepPriceHalala: product.weightStepPriceHalala === null || product.weightStepPriceHalala === undefined
        ? null
        : Number(product.weightStepPriceHalala),
    },
  };
}

function normalizePagination({ page, limit } = {}) {
  const normalizedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
  const normalizedLimit = Math.min(MAX_PICKER_LIMIT, Math.max(1, Number.parseInt(limit || "50", 10) || 50));
  return { page: normalizedPage, limit: normalizedLimit, skip: (normalizedPage - 1) * normalizedLimit };
}

function matchesSearch(row, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  return [row.key, row.name?.ar, row.name?.en, row.description?.ar, row.description?.en]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(needle));
}

module.exports = {
  stringId,
  uniqueIds,
  localized,
  plainObject,
  slugify,
  normalizeBoolean,
  canonicalize,
  stableHash,
  isPremiumDynamicSection,
  normalizeSection,
  normalizeSections,
  sectionForHash,
  draftHashForSections,
  serializeConfig,
  subscriptionEnabled,
  eligibilityForDoc,
  relationUsable,
  localizedName,
  pricingForProduct,
  normalizePagination,
  matchesSearch,
};
